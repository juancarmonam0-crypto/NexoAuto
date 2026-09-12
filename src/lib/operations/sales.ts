import { z } from "zod";
import type { BasisPoints, Cents } from "@/lib/money";
import type { DealStatus, FinanceType, PaymentFrequency as PrismaPaymentFrequency, Prisma } from "@/generated/prisma";
import { ActionError } from "@/lib/action-result";
import { maskVehicleFinancials } from "@/lib/auth/masking";
import {
  type DealPaymentMode,
  type DealStructure,
  type DealFinanceType,
  structureDeal,
} from "@/lib/deal-structuring";
import { ConflictError, NotFoundError } from "@/lib/domain-errors";
import type { LandedCostBreakdown } from "@/lib/economics";
import { computeVehicleEconomics } from "@/lib/economics";
import { PAYMENT_FREQUENCIES } from "@/lib/finance-engine";
import { toCents } from "@/lib/money";
import { FINANCE_RATE_POLICIES } from "@/lib/rate-policy";
import { assertTransition, deriveListingStatus } from "@/lib/vehicle-status";
import { assertCapability, type OperationContext } from "./context";
import { rethrowUniqueViolation } from "./db-errors";
import { newCustomerSchema } from "./leads";
import { centsSchema, positiveCentsSchema, recordIdSchema } from "./schemas";

/**
 * SALES — completing a vehicle sale.
 *
 * This is the operation the whole product exists to reach, and it is the one
 * that must never half-happen. Recording the sale price, contracting the deal,
 * moving the vehicle to SOLD, stamping the sale date and writing the lifecycle
 * event all occur in ONE transaction: a vehicle marked SOLD with no recorded
 * price would be a permanent hole in the dealership's books.
 *
 * PHASE 9B: when the caller supplies financing terms, the persisted payment,
 * finance charge, total of payments and exposure are produced by
 * `structureDeal()` — the canonical engine. This file never does amortisation
 * arithmetic of its own, so the number stored on the contract and the number
 * the Deal Desk displays cannot diverge.
 *
 * Actual profit is never recomputed here — it comes from
 * `computeVehicleEconomics()`, the same engine the sourcing screen uses.
 */

export const FINANCE_TYPES = [
  "CASH",
  "FINANCE",
  "LEASE",
  "BUY_HERE_PAY_HERE",
  "LEASE_TO_OWN",
  "UNDECIDED",
] as const satisfies readonly FinanceType[];

/** The FinanceType values that map onto a payment mode the engine can build. */
export const MODE_BY_FINANCE_TYPE: Partial<Record<FinanceType, DealPaymentMode>> = {
  CASH: "CASH",
  FINANCE: "EXTERNAL_FINANCE",
  BUY_HERE_PAY_HERE: "BUY_HERE_PAY_HERE",
  LEASE: "LEASE",
  LEASE_TO_OWN: "LEASE_TO_OWN",
};

/**
 * Compile-time proof that the engine's local finance-type union is a SUBSET of
 * the generated Prisma enum. If the schema ever drops a value the engine can
 * emit, this stops compiling instead of failing at runtime.
 */
type AssertAssignable<T extends U, U> = true;
type _FinanceTypeMirrorIsSound = AssertAssignable<DealFinanceType, FinanceType>;

/** Deal states that release a vehicle: they no longer hold it. */
export const DEAD_DEAL_STATUSES = ["CANCELLED", "LOST"] as const satisfies readonly DealStatus[];

/** Structured terms accepted alongside a sale. All optional: a cash deal needs none. */
export const dealTermsSchema = z.object({
  lenderName: z.string().trim().max(200).optional(),
  /** 60.00% is the ceiling the database enforces (`deals_apr_sane`). */
  aprBasisPoints: z.number().int().min(0).max(6_000).optional(),
  /** 180 months is the ceiling the database enforces (`deals_term_sane`). */
  termMonths: z.number().int().min(1).max(180).optional(),
  paymentFrequency: z.enum(PAYMENT_FREQUENCIES).optional(),
  firstPaymentDate: z.coerce.date().optional(),
  downPaymentCents: centsSchema.optional(),
  salesTaxBasisPoints: z.number().int().min(0).max(2_000).optional(),
  tradeInAllowanceCents: centsSchema.optional(),
  tradeInPayoffCents: centsSchema.optional(),
  /** The jurisdiction whose configured rate policy governs this deal. */
  ratePolicyJurisdiction: z.string().trim().min(2).max(8).optional(),
  lease: z
    .object({
      residualValueCents: centsSchema,
      capCostReductionCents: centsSchema.optional(),
      moneyFactorAprBasisPoints: z.number().int().min(0).max(6_000).optional(),
      purchaseOptionCents: centsSchema.optional(),
    })
    .optional(),
});

export const completeSaleSchema = z.object({
  vehicleId: recordIdSchema,
  /** Sell to an existing customer… */
  customerId: recordIdSchema.optional(),
  /** …or to a new one. Exactly one of the two. */
  customer: newCustomerSchema.optional(),
  leadId: recordIdSchema.optional(),
  /** The price the car actually sold for. Required: a sale has a number. */
  salePriceCents: positiveCentsSchema,
  dealerFeesCents: centsSchema.optional(),
  financeType: z.enum(FINANCE_TYPES).optional(),
  saleDate: z.coerce.date().optional(),
  notes: z.string().trim().max(5_000).optional(),
  terms: dealTermsSchema.optional(),
});

export type CompleteSaleInput = z.input<typeof completeSaleSchema>;

/**
 * The internal result of a completed sale.
 *
 * Cost-derived fields are nullable because a role without `finance:read`
 * receives `null`: a salesperson may complete a sale without being handed the
 * dealership's cost basis. The field names are chosen so
 * `maskVehicleFinancials()` strips them automatically — including the Phase 9B
 * dealer economics added here.
 */
export type SaleResult = {
  dealId: string;
  vehicleId: string;
  customerId: string;
  dealStatus: "CONTRACTED";
  vehicleStatus: "SOLD";
  finalSalePriceCents: Cents;
  saleDate: Date;
  daysInInventory: number | null;
  landedCostCents: Cents | null;
  actualGrossProfitCents: Cents | null;
  actualRoiBasisPoints: BasisPoints | null;
  landedCost: LandedCostBreakdown | null;

  // ---- Phase 9B: the customer's contract terms (safe to show the salesperson)
  financeType: FinanceType;
  paymentFrequency: PrismaPaymentFrequency;
  numberOfPayments: number | null;
  paymentAmountCents: Cents | null;
  finalPaymentCents: Cents | null;
  firstPaymentDateIso: string | null;
  amountFinancedCents: Cents | null;
  downPaymentCents: Cents | null;
  salesTaxCents: Cents | null;
  financeChargeCents: Cents | null;
  totalOfPaymentsCents: Cents | null;
  aprBasisPoints: BasisPoints | null;
  termMonths: number | null;

  // ---- Phase 9B: dealership economics (stripped for roles without finance:read)
  vehicleGrossCents: Cents | null;
  dealerCapitalStillExposedCents: Cents | null;
  projectedFinanceIncomeCents: Cents | null;
  combinedExpectedEconomicsCents: Cents | null;

  /** The configured-policy check that was recorded, if a policy applied. */
  ratePolicyId: string | null;
  ratePolicyCeilingBasisPoints: BasisPoints | null;
  ratePolicyStatement: string | null;
  riskFlags: string[];
};


function assertContactable(customer: { phone?: string | null; email?: string | null }): void {
  const hasPhone = typeof customer.phone === "string" && customer.phone.trim() !== "";
  const hasEmail = typeof customer.email === "string" && customer.email.trim() !== "";
  if (!hasPhone && !hasEmail) {
    throw new ActionError("A customer needs a phone number or an email address.", {
      phone: ["Enter a phone number or an email address."],
    });
  }
}

/**
 * Completes a sale: deal contracted, vehicle SOLD, actual economics returned.
 *
 * RULES ENFORCED (from the existing domain, not re-invented here):
 *   - `assertTransition()` must allow the move to SOLD
 *   - `deals_contracted_requires_sale_price` — a contracted deal states its price
 *   - `vehicles_sold_requires_final_price` — a sold vehicle records what it sold for
 *   - `deals_one_live_per_vehicle` — the partial unique index arbitrates two
 *     concurrent sales; the loser gets a ConflictError, not a corrupted record
 *
 * Capability: `deals:write` (OWNER, MANAGER, SALES).
 */
export async function completeVehicleSale(
  ctx: OperationContext,
  rawInput: CompleteSaleInput,
): Promise<SaleResult> {
  assertCapability(ctx, "deals:write");

  const input = completeSaleSchema.parse(rawInput);
  if (input.customerId && input.customer) {
    throw new ActionError("Provide either an existing customer or new customer details, not both.");
  }
  if (!input.customerId && !input.customer) {
    throw new ActionError("Provide an existing customer or the new customer's details.");
  }
  if (input.customer) assertContactable(input.customer);

  try {
    return await ctx.db.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUnique({ where: { id: input.vehicleId } });
      if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");
      if (vehicle.status === "SOLD" || vehicle.status === "DELIVERED") {
        throw new ConflictError("That vehicle is already sold.");
      }

      // The lifecycle state machine decides, not this operation.
      assertTransition(vehicle.status, "SOLD");

      const customerId = await resolveCustomerId(tx, input);
      if (input.leadId) {
        const lead = await tx.lead.findUnique({ where: { id: input.leadId }, select: { id: true } });
        if (!lead) throw new NotFoundError("That lead no longer exists.");
      }

      const saleDate = input.saleDate ?? new Date();

      // One live deal per vehicle: reuse the existing one when it belongs to the
      // same buyer, refuse when the car is already promised to somebody else.
      const liveDeal = await tx.deal.findFirst({
        where: { vehicleId: vehicle.id, status: { notIn: ["CANCELLED", "LOST"] } },
      });
      if (liveDeal && liveDeal.customerId !== customerId) {
        throw new ConflictError(
          "This vehicle already has a live deal for another customer. Cancel that deal first.",
        );
      }

      // The cost basis is computed FIRST, because the deal's payment schedule is
      // derived from it and has to be written in the same transaction.
      const [reconItems, expenses] = await Promise.all([
        tx.vehicleReconItem.findMany({
          where: { vehicleId: vehicle.id },
          select: { estimateCents: true, actualCostCents: true },
        }),
        tx.expense.findMany({ where: { vehicleId: vehicle.id }, select: { amountCents: true } }),
      ]);

      const economics = computeVehicleEconomics({
        acquisition: {
          acquisitionPriceCents: vehicle.acquisitionPriceCents,
          auctionFeesCents: vehicle.auctionFeesCents,
          transportationCents: vehicle.transportationCents,
          inspectionCents: vehicle.inspectionCents,
          otherAcquisitionCents: vehicle.otherAcquisitionCents,
        },
        reconItems,
        reconOverrideCents: vehicle.reconOverrideCents,
        additionalExpenseCents: expenses.reduce((total, row) => total + toCents(row.amountCents), 0),
        targetRetailPriceCents: vehicle.targetRetailPriceCents,
        askingPriceCents: vehicle.askingPriceCents,
        minimumApprovedCents: vehicle.minimumApprovedCents,
        acquisitionDate: vehicle.acquisitionDate,
        dateSold: saleDate,
        finalSalePriceCents: input.salePriceCents,
      });

      const financeType = input.financeType ?? liveDeal?.financeType ?? ("UNDECIDED" as const);
      const dealerFeesCents = input.dealerFeesCents ?? liveDeal?.dealerFeesCents ?? 0;

      // The canonical engine builds the contract; this operation only persists
      // what it returns. A rate that breaches a CONFIGURED policy stops here.
      const structure = structureForSale({
        financeType,
        input,
        vehicleModelYear: vehicle.year,
        landedCostCents: economics.landedCost.landedCostCents,
        dealerFeesCents,
        saleDate,
      });

      const dealData = {
        salePriceCents: input.salePriceCents,
        status: "CONTRACTED" as const,
        saleDate,
        salespersonId: liveDeal?.salespersonId ?? ctx.actor.id,
        dealerFeesCents,
        financeType,
        leadId: input.leadId ?? liveDeal?.leadId ?? null,
        notes: input.notes ?? liveDeal?.notes ?? null,
        ...(structure === null ? {} : structureColumns(structure, input)),
      };

      const deal = liveDeal
        ? await tx.deal.update({ where: { id: liveDeal.id }, data: dealData })
        : await tx.deal.create({
            data: {
              vehicleId: vehicle.id,
              customerId,
              askingPriceCents: vehicle.askingPriceCents ?? 0,
              ...dealData,
            },
          });

      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          status: "SOLD",
          listingStatus: deriveListingStatus("SOLD"),
          finalSalePriceCents: input.salePriceCents,
          dateSold: saleDate,
        },
      });

      await tx.vehicleStatusEvent.create({
        data: {
          vehicleId: vehicle.id,
          fromStatus: vehicle.status,
          toStatus: "SOLD",
          note: `Sold for ${input.salePriceCents} cents.`,
          changedById: ctx.actor.id,
        },
      });

      const result: SaleResult = {
        dealId: deal.id,
        vehicleId: vehicle.id,
        customerId,
        dealStatus: "CONTRACTED",
        vehicleStatus: "SOLD",
        finalSalePriceCents: input.salePriceCents,
        saleDate,
        daysInInventory: economics.daysInInventory,
        landedCostCents: economics.landedCost.landedCostCents,
        actualGrossProfitCents: economics.actualGrossProfitCents,
        actualRoiBasisPoints: economics.actualRoiBasisPoints,
        landedCost: economics.landedCost,
        ...saleStructureFields(financeType, structure),
      };

      return maskVehicleFinancials(result, ctx.actor);
    });
  } catch (error) {
    return rethrowUniqueViolation(
      error,
      {
        deals_one_live_per_vehicle: "This vehicle already has a live deal. Cancel it before selling again.",
      },
      "That sale conflicts with an existing record.",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* PHASE 9B — persisting a structured deal                                     */
/* -------------------------------------------------------------------------- */

/**
 * Builds the deal's payment structure through the canonical engine.
 *
 * Returns `null` — meaning "this sale carries no structured terms yet" — in two
 * cases only:
 *   - the finance type is UNDECIDED, or
 *   - a financed deal was recorded without the terms needed to schedule it.
 * Both keep the pre-Phase-9B behaviour exactly: the sale is recorded, and the
 * payment fields stay NULL rather than being filled with invented terms.
 *
 * A rate that breaches a CONFIGURED rate policy stops the sale with a precise
 * error. It never silently rewrites the rate.
 */
function structureForSale(params: {
  financeType: FinanceType;
  input: z.output<typeof completeSaleSchema>;
  vehicleModelYear: number;
  landedCostCents: Cents;
  dealerFeesCents: Cents;
  saleDate: Date;
}): DealStructure | null {
  const mode = MODE_BY_FINANCE_TYPE[params.financeType];
  if (!mode) return null;

  const terms = params.input.terms;
  const isLeaseMode = mode === "LEASE" || mode === "LEASE_TO_OWN";

  if (mode !== "CASH") {
    const hasTerm = terms?.termMonths !== undefined;
    const hasRate =
      terms?.aprBasisPoints !== undefined ||
      (isLeaseMode && terms?.lease?.moneyFactorAprBasisPoints !== undefined);
    if (!hasTerm || !hasRate) return null;
    if (isLeaseMode && terms?.lease === undefined) return null;
  }

  // A jurisdiction is only consulted when the caller NAMES one: the software
  // never assumes which jurisdiction's policy governs a deal.
  const jurisdiction = terms?.ratePolicyJurisdiction;

  const structure = structureDeal({
    mode,
    sellingPriceCents: params.input.salePriceCents,
    landedCostCents: params.landedCostCents,
    dealerFeesCents: params.dealerFeesCents,
    salesTaxBasisPoints: terms?.salesTaxBasisPoints,
    tradeInAllowanceCents: terms?.tradeInAllowanceCents,
    tradeInPayoffCents: terms?.tradeInPayoffCents,
    downPaymentCents: terms?.downPaymentCents,
    aprBasisPoints: terms?.aprBasisPoints,
    termMonths: terms?.termMonths,
    paymentFrequency: terms?.paymentFrequency,
    firstPaymentDate: terms?.firstPaymentDate?.toISOString() ?? null,
    lease: terms?.lease
      ? {
          residualValueCents: terms.lease.residualValueCents,
          capCostReductionCents: terms.lease.capCostReductionCents,
          moneyFactorAprBasisPoints: terms.lease.moneyFactorAprBasisPoints,
          purchaseOptionCents: terms.lease.purchaseOptionCents,
        }
      : null,
    ratePolicy: {
      policies: jurisdiction === undefined ? [] : FINANCE_RATE_POLICIES,
      jurisdiction: jurisdiction ?? "",
      asOf: params.saleDate,
      vehicleModelYear: params.vehicleModelYear,
    },
  });

  if (structure.ratePolicy.withinConfiguredRatePolicy === false) {
    throw new ActionError(`${structure.ratePolicy.statement} ${structure.ratePolicy.disclaimer}`, {
      aprBasisPoints: ["Lower the rate, or update the configured rate policy."],
    });
  }

  // A residual above the capitalised cost is not a lease, it is a typo, and the
  // database constraint deals_lease_structure_sane would reject it. Refuse it
  // here with a field error the operator can act on instead of a raw DB error.
  if (
    structure.lease !== null &&
    structure.lease.residualValueCents > structure.lease.grossCapCostCents
  ) {
    throw new ActionError(
      "The residual value cannot exceed the capitalized cost of the lease.",
      { residualValue: ["The residual value must be at or below the capitalized cost."] },
    );
  }

  return structure;
}

/**
 * The customer's remaining obligation at contract time.
 *
 * An instalment contract leaves the financed principal outstanding; a lease
 * leaves its scheduled payments outstanding; a deal whose receivable belongs to
 * a lender or was settled in cash leaves nothing outstanding for the dealer to
 * collect. Nothing in this phase collects money — a later servicing phase
 * maintains this figure.
 */
function remainingBalanceCentsFor(structure: DealStructure): Cents {
  switch (structure.mode) {
    case "BUY_HERE_PAY_HERE":
    case "LEASE_TO_OWN":
    case "LEASE":
      return structure.mode === "LEASE" ? structure.totalOfPaymentsCents : structure.amounts.amountFinancedCents;
    case "CASH":
    case "EXTERNAL_FINANCE":
      return 0;
  }
}

/** The Prisma column values a structured deal persists. */
function structureColumns(
  structure: DealStructure,
  input: z.output<typeof completeSaleSchema>,
): {
  paymentFrequency: PrismaPaymentFrequency;
  paymentAmountCents: number;
  finalPaymentCents: number;
  /** Null when there is no schedule (a cash deal), never 0. */
  numberOfPayments: number | null;
  firstPaymentDate: Date | null;
  salesTaxCents: number;
  financeChargeCents: number;
  totalOfPaymentsCents: number;
  remainingBalanceCents: number;
  aprBasisPoints: number;
  termMonths: number | null;
  downPaymentCents: number;
  amountFinancedCents: number;
  tradeInAllowanceCents: number;
  tradeInPayoffCents: number;
  lenderName: string | null;
  capitalizedCostCents: number | null;
  capCostReductionCents: number | null;
  residualValueCents: number | null;
  moneyFactorAprBasisPoints: number | null;
  purchaseOptionCents: number | null;
  ratePolicyId: string | null;
  ratePolicyCeilingBasisPoints: number | null;
  ratePolicyEvaluatedAt: Date | null;
} {
  return {
    paymentFrequency: structure.paymentFrequency as PrismaPaymentFrequency,
    paymentAmountCents: structure.paymentAmountCents,
    finalPaymentCents: structure.finalPaymentCents,
    // A structure with no scheduled payments (a cash deal, or a financed deal
    // whose balance is zero) records NULL, not 0: "no schedule" and "a schedule
    // of zero payments" are different facts, and the constraint
    // deals_payment_schedule_sane requires a positive count when one is stored.
    numberOfPayments: structure.numberOfPayments === 0 ? null : structure.numberOfPayments,
    firstPaymentDate: input.terms?.firstPaymentDate ?? null,
    salesTaxCents: structure.amounts.salesTaxCents,
    financeChargeCents: structure.financeChargeCents,
    totalOfPaymentsCents: structure.totalOfPaymentsCents,
    remainingBalanceCents: remainingBalanceCentsFor(structure),
    aprBasisPoints: structure.aprBasisPoints,
    // A cash deal has no term. Zero is not a term (the database constraint
    // deals_term_sane requires a positive value), so "no term" is NULL.
    termMonths: structure.termMonths === 0 ? null : structure.termMonths,
    downPaymentCents: structure.amounts.downPaymentCents,
    amountFinancedCents: structure.amounts.amountFinancedCents,
    tradeInAllowanceCents: structure.amounts.tradeInAllowanceCents,
    tradeInPayoffCents: structure.amounts.tradeInPayoffCents,
    lenderName: input.terms?.lenderName ?? null,
    capitalizedCostCents: structure.lease?.grossCapCostCents ?? null,
    capCostReductionCents: structure.lease?.capCostReductionCents ?? null,
    residualValueCents: structure.lease?.residualValueCents ?? null,
    moneyFactorAprBasisPoints:
      structure.mode === "LEASE" || structure.mode === "LEASE_TO_OWN" ? structure.aprBasisPoints : null,
    purchaseOptionCents: structure.lease?.purchaseOptionCents ?? null,
    // A cash deal has no rate, so recording "which rate policy was checked"
    // would be meaningless. The snapshot is only written when a rate exists.
    ratePolicyId: structure.mode === "CASH" ? null : structure.ratePolicy.policyId,
    ratePolicyCeilingBasisPoints:
      structure.mode === "CASH" ? null : structure.ratePolicy.policyCeilingBasisPoints,
    ratePolicyEvaluatedAt:
      structure.mode === "CASH" || structure.ratePolicy.policyId === null ? null : new Date(),
  };
}

type SaleStructureFields = Pick<
  SaleResult,
  | "financeType"
  | "paymentFrequency"
  | "numberOfPayments"
  | "paymentAmountCents"
  | "finalPaymentCents"
  | "firstPaymentDateIso"
  | "amountFinancedCents"
  | "downPaymentCents"
  | "salesTaxCents"
  | "financeChargeCents"
  | "totalOfPaymentsCents"
  | "aprBasisPoints"
  | "termMonths"
  | "vehicleGrossCents"
  | "dealerCapitalStillExposedCents"
  | "projectedFinanceIncomeCents"
  | "combinedExpectedEconomicsCents"
  | "ratePolicyId"
  | "ratePolicyCeilingBasisPoints"
  | "ratePolicyStatement"
  | "riskFlags"
>;

/**
 * Flat projection of the structure onto the sale result.
 *
 * Deliberately FLAT: role masking nulls top-level keys only, so nesting the
 * dealer economics inside a `structure` object would smuggle cost data past
 * `maskVehicleFinancials()`. The dealer-only keys added here are also listed in
 * that mask.
 */
function saleStructureFields(financeType: FinanceType, structure: DealStructure | null): SaleStructureFields {
  if (structure === null) {
    // No structured terms: the dealer-economics fields stay null and
    // `actualGrossProfitCents` remains the authoritative gross for this sale.
    return {
      financeType,
      paymentFrequency: "MONTHLY",
      numberOfPayments: null,
      paymentAmountCents: null,
      finalPaymentCents: null,
      firstPaymentDateIso: null,
      amountFinancedCents: null,
      downPaymentCents: null,
      salesTaxCents: null,
      financeChargeCents: null,
      totalOfPaymentsCents: null,
      aprBasisPoints: null,
      termMonths: null,
      vehicleGrossCents: null,
      dealerCapitalStillExposedCents: null,
      projectedFinanceIncomeCents: null,
      combinedExpectedEconomicsCents: null,
      ratePolicyId: null,
      ratePolicyCeilingBasisPoints: null,
      ratePolicyStatement: null,
      riskFlags: [],
    };
  }

  return {
    financeType,
    paymentFrequency: structure.paymentFrequency as PrismaPaymentFrequency,
    numberOfPayments: structure.numberOfPayments,
    paymentAmountCents: structure.paymentAmountCents,
    finalPaymentCents: structure.finalPaymentCents,
    firstPaymentDateIso: structure.firstPaymentDate,
    amountFinancedCents: structure.amounts.amountFinancedCents,
    downPaymentCents: structure.amounts.downPaymentCents,
    salesTaxCents: structure.amounts.salesTaxCents,
    financeChargeCents: structure.financeChargeCents,
    totalOfPaymentsCents: structure.totalOfPaymentsCents,
    aprBasisPoints: structure.aprBasisPoints,
    termMonths: structure.termMonths,
    vehicleGrossCents: structure.vehicleGrossCents,
    dealerCapitalStillExposedCents: structure.dealerCapitalStillExposedCents,
    projectedFinanceIncomeCents: structure.projectedFinanceIncomeCents,
    combinedExpectedEconomicsCents: structure.combinedExpectedEconomicsCents,
    ratePolicyId: structure.ratePolicy.policyId,
    ratePolicyCeilingBasisPoints: structure.ratePolicy.policyCeilingBasisPoints,
    ratePolicyStatement: structure.ratePolicy.withinConfiguredRatePolicy === null ? null : structure.ratePolicy.statement,
    riskFlags: structure.riskFlags,
  };
}

/** Resolves the buyer, creating the customer when new details were supplied. */
async function resolveCustomerId(
  tx: Prisma.TransactionClient,
  input: { customerId?: string; customer?: z.output<typeof newCustomerSchema> },
): Promise<string> {
  if (input.customerId) {
    const existing = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
    if (!existing) throw new NotFoundError("That customer no longer exists.");
    return existing.id;
  }

  const created = await tx.customer.create({
    data: {
      firstName: input.customer?.firstName ?? "",
      lastName: input.customer?.lastName ?? null,
      email: input.customer?.email ?? null,
      phone: input.customer?.phone ?? null,
      preferredContact: input.customer?.preferredContact ?? "ANY",
      addressLine1: input.customer?.addressLine1 ?? null,
      city: input.customer?.city ?? null,
      state: input.customer?.state ?? null,
      postalCode: input.customer?.postalCode ?? null,
      notes: input.customer?.notes ?? null,
    },
    select: { id: true },
  });
  return created.id;
}

export const cancelDealSchema = z.object({
  dealId: recordIdSchema,
  reason: z.string().trim().max(1_000).optional(),
});

export type CancelDealInput = z.input<typeof cancelDealSchema>;

/**
 * Cancels a live deal and, when the vehicle had been sold on it, returns the
 * car to the retail catalog.
 *
 * WHY THIS IS PART OF PHASE 4
 * `deals_one_live_per_vehicle` means an abandoned deal permanently blocks its
 * vehicle unless there is a way to release it. A deal falling through is the
 * most common event in a dealership, not an edge case.
 *
 * Reopening clears `finalSalePriceCents` and `dateSold`, because the economics
 * engine treats a recorded final price as "sold" — leaving them behind would
 * report a car on the lot as sold.
 *
 * Capability: `deals:write`.
 */
export async function cancelDeal(
  ctx: OperationContext,
  rawInput: CancelDealInput,
): Promise<{ dealId: string; status: "CANCELLED"; vehicleId: string; vehicleStatus: string }> {
  assertCapability(ctx, "deals:write");

  const input = cancelDealSchema.parse(rawInput);
  const deal = await ctx.db.deal.findUnique({ where: { id: input.dealId } });
  if (!deal) throw new NotFoundError("That deal no longer exists.");
  if (deal.status === "CANCELLED") throw new ConflictError("That deal is already cancelled.");

  const vehicle = await ctx.db.vehicle.findUnique({ where: { id: deal.vehicleId } });
  if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");

  const reopensVehicle = vehicle.status === "SOLD" || vehicle.status === "DELIVERED";
  if (reopensVehicle) {
    if (vehicle.askingPriceCents === null || vehicle.askingPriceCents <= 0) {
      throw new ConflictError("Set an asking price before returning this vehicle to the catalog.");
    }
    // Only SOLD/DELIVERED -> LISTED is legal; the state machine decides.
    assertTransition(vehicle.status, "LISTED");
  }

  return ctx.db.$transaction(async (tx) => {
    await tx.deal.update({
      where: { id: deal.id },
      data: {
        status: "CANCELLED",
        notes: input.reason ? `${deal.notes ? `${deal.notes}\n` : ""}Cancelled: ${input.reason}` : deal.notes,
      },
    });

    let vehicleStatus = vehicle.status;
    if (reopensVehicle) {
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          status: "LISTED",
          listingStatus: deriveListingStatus("LISTED"),
          finalSalePriceCents: null,
          dateSold: null,
        },
      });
      await tx.vehicleStatusEvent.create({
        data: {
          vehicleId: vehicle.id,
          fromStatus: vehicle.status,
          toStatus: "LISTED",
          note: input.reason ? `Sale cancelled: ${input.reason}` : "Sale cancelled; vehicle returned to inventory.",
          changedById: ctx.actor.id,
        },
      });
      vehicleStatus = "LISTED";
    }

    return { dealId: deal.id, status: "CANCELLED" as const, vehicleId: vehicle.id, vehicleStatus };
  });
}

/** Vehicles with a live deal cannot be deleted; this lists them for the UI. */
export async function liveDealForVehicle(
  ctx: OperationContext,
  vehicleId: string,
): Promise<{ id: string; status: string; customerId: string } | null> {
  assertCapability(ctx, "deals:read");

  const id = recordIdSchema.parse(vehicleId);
  return ctx.db.deal.findFirst({
    where: { vehicleId: id, status: { notIn: ["CANCELLED", "LOST"] } },
    select: { id: true, status: true, customerId: true },
  });
}

/**
 * The full terms of the live deal on a vehicle — Phase 9B.
 *
 * WHY THIS EXISTS
 * Phase 9A could not show a deal's terms because no operation returned them,
 * and Phase 9B persists a structured deal that would otherwise be write-only.
 * This is the read that makes the structured deal visible and auditable.
 *
 * Every field here is a CONTRACT term the buyer is entitled to see (price,
 * down payment, amount financed, rate, term, payment, finance charge, trade-in,
 * official workflow status) or a record of which configured rate policy was
 * checked. None of it is dealership cost, so no field-level masking applies;
 * the caller still holds `deals:read`.
 *
 * Nested objects are avoided on purpose: role masking nulls top-level keys, so
 * a nested payload could smuggle data past it.
 *
 * Capability: `deals:read`.
 */
export interface DealTermsView {
  dealId: string;
  /**
   * The vehicle this deal belongs to. Carried so a BATCH read can be keyed by
   * vehicle without a second lookup (the Phase-perf fix for the /sales N+1).
   */
  vehicleId: string;
  status: DealStatus;
  customerId: string;
  customerName: string;
  leadId: string | null;
  salespersonId: string | null;

  financeType: FinanceType;
  lenderName: string | null;

  askingPriceCents: Cents;
  negotiatedPriceCents: Cents | null;
  salePriceCents: Cents | null;
  dealerFeesCents: Cents;
  salesTaxCents: Cents | null;

  tradeInAllowanceCents: Cents | null;
  tradeInPayoffCents: Cents | null;

  downPaymentCents: Cents | null;
  amountFinancedCents: Cents | null;
  aprBasisPoints: BasisPoints | null;
  termMonths: number | null;
  paymentFrequency: PrismaPaymentFrequency;
  numberOfPayments: number | null;
  paymentAmountCents: Cents | null;
  finalPaymentCents: Cents | null;
  firstPaymentDateIso: string | null;
  financeChargeCents: Cents | null;
  totalOfPaymentsCents: Cents | null;
  remainingBalanceCents: Cents | null;

  capitalizedCostCents: Cents | null;
  capCostReductionCents: Cents | null;
  residualValueCents: Cents | null;
  moneyFactorAprBasisPoints: BasisPoints | null;
  purchaseOptionCents: Cents | null;

  ratePolicyId: string | null;
  ratePolicyCeilingBasisPoints: BasisPoints | null;
  ratePolicyEvaluatedAtIso: string | null;

  titleWorkStatus: string;
  registrationStatus: string;
  officialNotes: string | null;

  saleDateIso: string | null;
  deliveryDateIso: string | null;
  notes: string | null;
  createdAtIso: string;
}

export async function getLiveDealForVehicle(
  ctx: OperationContext,
  vehicleId: string,
): Promise<DealTermsView | null> {
  assertCapability(ctx, "deals:read");

  const id = recordIdSchema.parse(vehicleId);
  const deal = await ctx.db.deal.findFirst({
    where: { vehicleId: id, status: { notIn: ["CANCELLED", "LOST"] } },
    include: { customer: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!deal) return null;

  return toDealTermsView(deal);
}

/** The row shape both deal reads load. */
type DealRowWithCustomer = Prisma.DealGetPayload<{
  include: { customer: { select: { firstName: true; lastName: true } } };
}>;

/**
 * The ONE row -> view mapping, shared by the single and the batch read so the two
 * can never disagree about what a deal's terms are.
 */
function toDealTermsView(deal: DealRowWithCustomer): DealTermsView {
  return {
    dealId: deal.id,
    vehicleId: deal.vehicleId,
    status: deal.status,
    customerId: deal.customerId,
    customerName: `${deal.customer.firstName} ${deal.customer.lastName ?? ""}`.trim(),
    leadId: deal.leadId,
    salespersonId: deal.salespersonId,
    financeType: deal.financeType,
    lenderName: deal.lenderName,
    askingPriceCents: deal.askingPriceCents,
    negotiatedPriceCents: deal.negotiatedPriceCents,
    salePriceCents: deal.salePriceCents,
    dealerFeesCents: deal.dealerFeesCents,
    salesTaxCents: deal.salesTaxCents,
    tradeInAllowanceCents: deal.tradeInAllowanceCents,
    tradeInPayoffCents: deal.tradeInPayoffCents,
    downPaymentCents: deal.downPaymentCents,
    amountFinancedCents: deal.amountFinancedCents,
    aprBasisPoints: deal.aprBasisPoints,
    termMonths: deal.termMonths,
    paymentFrequency: deal.paymentFrequency,
    numberOfPayments: deal.numberOfPayments,
    paymentAmountCents: deal.paymentAmountCents,
    finalPaymentCents: deal.finalPaymentCents,
    firstPaymentDateIso: deal.firstPaymentDate?.toISOString() ?? null,
    financeChargeCents: deal.financeChargeCents,
    totalOfPaymentsCents: deal.totalOfPaymentsCents,
    remainingBalanceCents: deal.remainingBalanceCents,
    capitalizedCostCents: deal.capitalizedCostCents,
    capCostReductionCents: deal.capCostReductionCents,
    residualValueCents: deal.residualValueCents,
    moneyFactorAprBasisPoints: deal.moneyFactorAprBasisPoints,
    purchaseOptionCents: deal.purchaseOptionCents,
    ratePolicyId: deal.ratePolicyId,
    ratePolicyCeilingBasisPoints: deal.ratePolicyCeilingBasisPoints,
    ratePolicyEvaluatedAtIso: deal.ratePolicyEvaluatedAt?.toISOString() ?? null,
    titleWorkStatus: deal.titleWorkStatus,
    registrationStatus: deal.registrationStatus,
    officialNotes: deal.officialNotes,
    saleDateIso: deal.saleDate?.toISOString() ?? null,
    deliveryDateIso: deal.deliveryDate?.toISOString() ?? null,
    notes: deal.notes,
    createdAtIso: deal.createdAt.toISOString(),
  };
}

/** Upper bound on one batch deal read, so a caller cannot ask for the world. */
export const MAX_BATCH_DEAL_VEHICLES = 200;

/**
 * The LIVE deals for MANY vehicles in ONE query.
 *
 * WHY THIS EXISTS (performance hardening)
 * The SALES workspace used to call `getLiveDealForVehicle()` once per vehicle,
 * which is a textbook N+1: a 100-car inventory meant 100 round trips to render
 * one page. This reads them all with a single bounded `findMany` and returns the
 * SAME `DealTermsView` objects, through the SAME mapping, so nothing about the
 * deal semantics changes — only the number of queries.
 *
 * `deals_one_live_per_vehicle` (a partial unique index) guarantees at most one
 * live deal per vehicle; should history ever hold more than one non-dead row for
 * a vehicle, the newest wins, which is exactly what the single-vehicle read
 * returns too.
 *
 * Capability: `deals:read`.
 */
export async function getLiveDealsForVehicles(
  ctx: OperationContext,
  vehicleIds: readonly string[],
): Promise<DealTermsView[]> {
  assertCapability(ctx, "deals:read");

  const unique = [
    ...new Set(
      vehicleIds
        .map((id) => recordIdSchema.safeParse(id))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data),
    ),
  ].slice(0, MAX_BATCH_DEAL_VEHICLES);
  if (unique.length === 0) return [];

  const deals = await ctx.db.deal.findMany({
    where: { vehicleId: { in: unique }, status: { notIn: ["CANCELLED", "LOST"] } },
    include: { customer: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });

  const byVehicle = new Map<string, DealTermsView>();
  for (const deal of deals) {
    if (!byVehicle.has(deal.vehicleId)) byVehicle.set(deal.vehicleId, toDealTermsView(deal));
  }
  return [...byVehicle.values()];
}
