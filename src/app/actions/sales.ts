"use server";

import { type ActionResult, ActionError, runOperation } from "@/lib/action-result";
import { maskVehicleFinancials } from "@/lib/auth/masking";
import type {
  DealCancelledContract,
  DealComparisonContract,
  DealPricingContract,
  DealRatePolicyContract,
  DealStructureContract,
  PaymentBudgetOptionContract,
  PaymentBudgetResultContract,
  SaleCompletedContract,
  TargetPaymentOptionContract,
  TargetPaymentResultContract,
} from "@/lib/boundary/contracts";
import {
  type DealPaymentMode,
  type DealStructure,
  DEAL_PAYMENT_MODES,
  compareDealStructures,
  computeRecommendedPricing,
} from "@/lib/deal-structuring";
import { type PaymentFrequency, PAYMENT_FREQUENCIES } from "@/lib/finance-engine";
import {
  enumField,
  optionalFormCents,
  optionalFormDate,
  optionalFormInt,
  optionalFormString,
  requireFormCents,
  requireFormString,
} from "@/lib/forms";
import { type BasisPoints, type Cents, parseMoneyToCents } from "@/lib/money";
import {
  CONTACT_METHODS,
  FINANCE_TYPES,
  type VehicleInventoryView,
  cancelDeal,
  completeVehicleSale,
  getVehicleDetail,
} from "@/lib/operations";
import type { CompleteSaleInput, OperationContext } from "@/lib/operations";
import { FINANCED_PAYMENT_MODES, fitPaymentBudget, solveTargetPayment } from "@/lib/payment-solver";
import { FINANCE_RATE_POLICIES, type FinanceRatePolicy } from "@/lib/rate-policy";
import { getDealerSettings } from "@/lib/settings";
import { operationContext } from "@/lib/operations/runtime";
import type { UserRole } from "@/generated/prisma";

/**
 * SALES — completing, unwinding and STRUCTURING a deal.
 *
 * `completeVehicleSale` is the single most consequential operation in the
 * product, and this boundary adds nothing to it: no price validation, no profit
 * calculation, no state juggling. It reports the economics the operation
 * computed, already masked for the acting role (a salesperson receives `null`
 * for cost and profit).
 *
 * PHASE 9B adds one read-only analysis entry point, `evaluateDealStructures`.
 * It does no arithmetic of its own either: it hands the operator's inputs to
 * the canonical engine and returns what the engine said.
 */

/* -------------------------------------------------------------------------- */
/* Form helpers specific to structured terms                                   */
/* -------------------------------------------------------------------------- */

/**
 * A percentage an operator typed ("8.99") -> basis points (899).
 *
 * `parseMoneyToCents` is exactly a "decimal x 100" parser, which is what a
 * percentage needs; it is used here so rates go through the same canonical
 * parser as money instead of a second float conversion.
 *
 * `maxBasisPoints` mirrors the database CHECK constraints (`deals_apr_sane`
 * allows 60.00%), so an impossible rate is refused with a field error instead
 * of reaching the database and failing as a raw constraint violation.
 */
function optionalFormBasisPoints(
  data: FormData,
  key: string,
  label: string,
  maxBasisPoints: number,
): number | undefined {
  const raw = data.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const basisPoints = parseMoneyToCents(raw);
  if (basisPoints === null) {
    const message = `${label} must be a percentage, for example 8.99.`;
    throw new ActionError(message, { [key]: [message] });
  }
  if (basisPoints < 0) {
    const message = `${label} cannot be negative.`;
    throw new ActionError(message, { [key]: [message] });
  }
  if (basisPoints > maxBasisPoints) {
    const message = `${label} cannot exceed ${(maxBasisPoints / 100).toFixed(2)}%.`;
    throw new ActionError(message, { [key]: [message] });
  }
  return basisPoints;
}

/** The highest rate the database accepts on a deal (`deals_apr_sane`). */
const MAX_DEAL_APR_BASIS_POINTS = 6_000;
/** The highest sales tax rate the operation accepts. */
const MAX_SALES_TAX_BASIS_POINTS = 2_000;

/**
 * Builds the structured terms from a form.
 *
 * Returns `undefined` when the operator supplied no terms at all, which keeps a
 * plain cash sale behaving exactly as it did before Phase 9B: no invented rate,
 * no invented term, no invented payment.
 */
function dealTermsFromForm(formData: FormData): CompleteSaleInput["terms"] {
  const residualValueCents = optionalFormCents(formData, "residualValue", "Residual value");
  const lease =
    residualValueCents === undefined
      ? undefined
      : {
          residualValueCents,
          capCostReductionCents: optionalFormCents(formData, "capCostReduction", "Cap cost reduction"),
          moneyFactorAprBasisPoints: optionalFormBasisPoints(formData, "moneyFactorAprPercent", "Money factor rate", MAX_DEAL_APR_BASIS_POINTS),
          purchaseOptionCents: optionalFormCents(formData, "purchaseOption", "Purchase option"),
        };

  const terms = {
    lenderName: optionalFormString(formData, "lenderName"),
    aprBasisPoints: optionalFormBasisPoints(formData, "aprPercent", "APR", MAX_DEAL_APR_BASIS_POINTS),
    termMonths: optionalFormInt(formData, "termMonths", "Term"),
    paymentFrequency:
      optionalFormString(formData, "paymentFrequency") === undefined
        ? undefined
        : enumField(formData, "paymentFrequency", PAYMENT_FREQUENCIES, "MONTHLY", "Payment frequency"),
    firstPaymentDate: optionalFormDate(formData, "firstPaymentDate", "First payment date"),
    downPaymentCents: optionalFormCents(formData, "downPayment", "Down payment"),
    salesTaxBasisPoints: optionalFormBasisPoints(formData, "salesTaxPercent", "Sales tax", MAX_SALES_TAX_BASIS_POINTS),
    tradeInAllowanceCents: optionalFormCents(formData, "tradeInAllowance", "Trade-in allowance"),
    tradeInPayoffCents: optionalFormCents(formData, "tradeInPayoff", "Trade-in payoff"),
    ratePolicyJurisdiction: optionalFormString(formData, "ratePolicyJurisdiction"),
    lease,
  };

  // Nothing supplied: let the operation record the sale without a structure.
  const supplied = Object.values(terms).some((value) => value !== undefined);
  return supplied ? terms : undefined;
}

/* -------------------------------------------------------------------------- */
/* Completing a sale                                                           */
/* -------------------------------------------------------------------------- */

/** Capability: `deals:write`. */
export async function completeVehicleSaleAction(
  formData: FormData,
): Promise<ActionResult<SaleCompletedContract>> {
  return runOperation("sales.completeVehicleSale", async () => {
    const ctx = await operationContext("deals:write");
    const customerId = optionalFormString(formData, "customerId");

    const terms = dealTermsFromForm(formData);
    if (terms !== undefined && terms.ratePolicyJurisdiction === undefined) {
      // The configured-policy guardrail must not be bypassable by leaving the
      // jurisdiction field blank, so it defaults to the dealership's own state.
      const settings = await getDealerSettings(ctx.db);
      const state = settings.state?.trim();
      if (state !== undefined && state !== "") terms.ratePolicyJurisdiction = state;
    }

    const sale = await completeVehicleSale(ctx, {
      vehicleId: requireFormString(formData, "vehicleId", "Vehicle"),
      customerId,
      customer: customerId
        ? undefined
        : {
            firstName: requireFormString(formData, "firstName", "First name"),
            lastName: optionalFormString(formData, "lastName"),
            email: optionalFormString(formData, "email"),
            phone: optionalFormString(formData, "phone"),
            preferredContact: enumField(formData, "preferredContact", CONTACT_METHODS, "ANY", "Preferred contact"),
          },
      leadId: optionalFormString(formData, "leadId"),
      salePriceCents: requireFormCents(formData, "salePrice", "Sale price"),
      dealerFeesCents: optionalFormCents(formData, "dealerFees", "Dealer fees"),
      financeType: enumField(formData, "financeType", FINANCE_TYPES, "UNDECIDED", "Finance type"),
      saleDate: optionalFormDate(formData, "saleDate", "Sale date"),
      notes: optionalFormString(formData, "notes"),
      terms,
    });

    return {
      dealId: sale.dealId,
      vehicleId: sale.vehicleId,
      customerId: sale.customerId,
      dealStatus: sale.dealStatus,
      vehicleStatus: sale.vehicleStatus,
      finalSalePriceCents: sale.finalSalePriceCents,
      // Dates cross the boundary as ISO strings, never as Date objects.
      saleDateIso: sale.saleDate.toISOString(),
      daysInInventory: sale.daysInInventory,
      landedCostCents: sale.landedCostCents,
      actualGrossProfitCents: sale.actualGrossProfitCents,
      actualRoiBasisPoints: sale.actualRoiBasisPoints,
      financeType: sale.financeType,
      paymentFrequency: sale.paymentFrequency,
      numberOfPayments: sale.numberOfPayments,
      paymentAmountCents: sale.paymentAmountCents,
      finalPaymentCents: sale.finalPaymentCents,
      firstPaymentDateIso: sale.firstPaymentDateIso,
      amountFinancedCents: sale.amountFinancedCents,
      downPaymentCents: sale.downPaymentCents,
      salesTaxCents: sale.salesTaxCents,
      financeChargeCents: sale.financeChargeCents,
      totalOfPaymentsCents: sale.totalOfPaymentsCents,
      aprBasisPoints: sale.aprBasisPoints,
      termMonths: sale.termMonths,
      vehicleGrossCents: sale.vehicleGrossCents,
      dealerCapitalStillExposedCents: sale.dealerCapitalStillExposedCents,
      projectedFinanceIncomeCents: sale.projectedFinanceIncomeCents,
      combinedExpectedEconomicsCents: sale.combinedExpectedEconomicsCents,
      ratePolicyId: sale.ratePolicyId,
      ratePolicyCeilingBasisPoints: sale.ratePolicyCeilingBasisPoints,
      ratePolicyStatement: sale.ratePolicyStatement,
      riskFlags: sale.riskFlags,
    };
  });
}

/**
 * Cancels a live deal and releases the vehicle. Capability: `deals:write`.
 *
 * This is the sanctioned way to unwind a sale; the inventory operations refuse
 * to republish a vehicle that still carries a recorded sale.
 */
export async function cancelDealAction(
  formData: FormData,
): Promise<ActionResult<DealCancelledContract>> {
  return runOperation("sales.cancelDeal", async () => {
    const ctx = await operationContext("deals:write");
    const cancelled = await cancelDeal(ctx, {
      dealId: requireFormString(formData, "dealId", "Deal"),
      reason: optionalFormString(formData, "reason"),
    });
    return {
      dealId: cancelled.dealId,
      status: cancelled.status,
      vehicleId: cancelled.vehicleId,
      vehicleStatus: cancelled.vehicleStatus,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* PHASE 9B — the Deal Desk analysis                                           */
/* -------------------------------------------------------------------------- */

/**
 * Flattens an engine structure into the boundary contract.
 *
 * FLAT ON PURPOSE: role masking nulls top-level keys, so the dealer-economics
 * fields (`vehicleGrossCents`, `combinedExpectedEconomicsCents`, `score`) must
 * sit at the top level to be maskable at all. Nesting them would smuggle the
 * cost basis past `maskVehicleFinancials()`.
 */
function structureContract(structure: DealStructure): DealStructureContract {
  const ratePolicy: DealRatePolicyContract = {
    status: structure.ratePolicy.status,
    aprBasisPoints: structure.ratePolicy.aprBasisPoints,
    withinConfiguredRatePolicy: structure.ratePolicy.withinConfiguredRatePolicy,
    policyId: structure.ratePolicy.policyId,
    policyJurisdiction: structure.ratePolicy.policyJurisdiction,
    policyCeilingBasisPoints: structure.ratePolicy.policyCeilingBasisPoints,
    policySourceReference: structure.ratePolicy.policySourceReference,
    statement: structure.ratePolicy.statement,
    disclaimer: structure.ratePolicy.disclaimer,
  };

  return {
    mode: structure.mode,
    label: structure.label,
    financeType: structure.financeType,
    feasible: structure.feasible,
    unavailableReason: structure.unavailableReason,
    contractGeneration: structure.contractGeneration,
    contractBlockedReason: structure.contractBlockedReason,

    sellingPriceCents: structure.amounts.sellingPriceCents,
    dealerFeesCents: structure.amounts.dealerFeesCents,
    salesTaxCents: structure.amounts.salesTaxCents,
    tradeInAllowanceCents: structure.amounts.tradeInAllowanceCents,
    tradeInPayoffCents: structure.amounts.tradeInPayoffCents,
    amountDueCents: structure.amounts.amountDueCents,
    tradeEquityCents: structure.amounts.tradeEquityCents,
    downPaymentCents: structure.amounts.downPaymentCents,
    amountFinancedCents: structure.amounts.amountFinancedCents,

    aprBasisPoints: structure.aprBasisPoints,
    termMonths: structure.termMonths,
    paymentFrequency: structure.paymentFrequency,
    numberOfPayments: structure.numberOfPayments,
    paymentAmountCents: structure.paymentAmountCents,
    finalPaymentCents: structure.finalPaymentCents,
    financeChargeCents: structure.financeChargeCents,
    totalOfPaymentsCents: structure.totalOfPaymentsCents,
    totalCustomerOutlayCents: structure.totalCustomerOutlayCents,
    totalCustomerOutlayWithOptionCents: structure.totalCustomerOutlayWithOptionCents,
    paymentQuoted: structure.paymentQuoted,
    firstPaymentDateIso: structure.firstPaymentDate,

    vehicleGrossCents: structure.vehicleGrossCents,
    vehicleGrossRealizedAtClosing: structure.vehicleGrossRealizedAtClosing,
    dealerCashReceivedAtClosingCents: structure.dealerCashReceivedAtClosingCents,
    dealerCapitalStillExposedCents: structure.dealerCapitalStillExposedCents,
    projectedFinanceIncomeCents: structure.projectedFinanceIncomeCents,
    combinedExpectedEconomicsCents: structure.combinedExpectedEconomicsCents,

    lease: structure.lease,
    ratePolicy,
    riskFlags: structure.riskFlags,
    riskLabels: structure.riskLabels,
    reasons: structure.reasons,
    score: structure.score,
  };
}

/* -------------------------------------------------------------------------- */
/* PHASE 9D — shared setup for every read-only deal analysis                   */
/* -------------------------------------------------------------------------- */

interface DealSetup {
  vehicle: VehicleInventoryView;
  sellingPriceCents: Cents;
  asOf: Date;
  jurisdiction: string | null;
  pricing: DealPricingContract | null;
  /** The engine inputs that do not depend on the payment mode. */
  base: {
    sellingPriceCents: Cents;
    landedCostCents: Cents | null;
    dealerFeesCents: Cents;
    salesTaxBasisPoints: BasisPoints;
    tradeInAllowanceCents: Cents;
    tradeInPayoffCents: Cents;
    downPaymentCents: Cents;
    aprBasisPoints: BasisPoints;
    termMonths: number;
    paymentFrequency: PaymentFrequency;
    firstPaymentDate: string | null;
    lease: {
      residualValueCents: Cents;
      capCostReductionCents?: Cents;
      moneyFactorAprBasisPoints?: BasisPoints;
      purchaseOptionCents?: Cents;
    } | null;
    ratePolicy: {
      policies: readonly FinanceRatePolicy[];
      jurisdiction: string;
      asOf: Date;
      vehicleModelYear: number;
    };
  };
}

/**
 * Reads one deal-analysis form ONCE, for all three calculator modes.
 *
 * WHAT THE OPERATOR DOES NOT HAVE TO TYPE. The brief for Phase 9D is "the
 * system already knows it": the selling price falls back to the vehicle's asking
 * price, and the rate, term and down payment fall back to the dealership's own
 * configured defaults. Every one of those remains overridable in the form — the
 * fallback is a convenience, never a silent substitution for an answer the
 * operator gave.
 *
 * A jurisdiction is consulted only when one is named (or configured on the
 * dealership); the software never assumes which jurisdiction governs a deal.
 */
async function readDealSetup(ctx: OperationContext, formData: FormData): Promise<DealSetup> {
  const vehicleId = requireFormString(formData, "vehicleId", "Vehicle");
  const detail = await getVehicleDetail(ctx, vehicleId);
  const vehicle = detail.vehicle;

  const settings = await getDealerSettings(ctx.db);
  const jurisdiction = optionalFormString(formData, "ratePolicyJurisdiction") ?? settings.state ?? undefined;

  const sellingPriceCents =
    optionalFormCents(formData, "sellingPrice", "Selling price") ??
    vehicle.askingPriceCents ??
    vehicle.targetRetailPriceCents ??
    0;
  if (sellingPriceCents <= 0) {
    throw new ActionError("Enter the price this vehicle is being sold for.", {
      sellingPrice: ["A selling price is required to structure the deal."],
    });
  }

  const asOf = new Date();
  const residualValueCents = optionalFormCents(formData, "residualValue", "Residual value");

  const base: DealSetup["base"] = {
    sellingPriceCents,
    // Already masked by the operation for a role without `finance:read`: the
    // engine reads null as "unknown cost" and refuses to invent a gross.
    landedCostCents: vehicle.landedCostCents,
    dealerFeesCents: optionalFormCents(formData, "dealerFees", "Dealer fees") ?? 0,
    salesTaxBasisPoints:
      optionalFormBasisPoints(formData, "salesTaxPercent", "Sales tax", MAX_SALES_TAX_BASIS_POINTS) ?? 0,
    tradeInAllowanceCents: optionalFormCents(formData, "tradeInAllowance", "Trade-in allowance") ?? 0,
    tradeInPayoffCents: optionalFormCents(formData, "tradeInPayoff", "Trade-in payoff") ?? 0,
    downPaymentCents:
      optionalFormCents(formData, "downPayment", "Down payment") ?? settings.defaultDownPaymentCents,
    aprBasisPoints:
      optionalFormBasisPoints(formData, "aprPercent", "APR", MAX_DEAL_APR_BASIS_POINTS) ??
      settings.defaultAprBasisPoints,
    termMonths: optionalFormInt(formData, "termMonths", "Term") ?? settings.defaultTermMonths,
    paymentFrequency: enumField(formData, "paymentFrequency", PAYMENT_FREQUENCIES, "MONTHLY", "Payment frequency"),
    firstPaymentDate: optionalFormDate(formData, "firstPaymentDate", "First payment date")?.toISOString() ?? null,
    lease:
      residualValueCents === undefined
        ? null
        : {
            residualValueCents,
            capCostReductionCents: optionalFormCents(formData, "capCostReduction", "Cap cost reduction"),
            moneyFactorAprBasisPoints: optionalFormBasisPoints(
              formData,
              "moneyFactorAprPercent",
              "Money factor rate",
              MAX_DEAL_APR_BASIS_POINTS,
            ),
            purchaseOptionCents: optionalFormCents(formData, "purchaseOption", "Purchase option"),
          },
    ratePolicy: {
      policies: jurisdiction ? FINANCE_RATE_POLICIES : [],
      jurisdiction: jurisdiction ?? "",
      asOf,
      vehicleModelYear: vehicle.year,
    },
  };

  // The recommended asking-price ladder, only when the cost basis is visible.
  let pricing: DealPricingContract | null = null;
  if (vehicle.landedCostCents !== null) {
    const ladder = computeRecommendedPricing({
      landedCostCents: vehicle.landedCostCents,
      policy: {
        minGrossProfitCents: settings.minGrossProfitCents,
        minRoiBasisPoints: settings.minRoiBasisPoints,
        // The vehicle's target retail price is the market reference the
        // dealership already recorded; it caps the recommendation.
        marketTargetCents: vehicle.targetRetailPriceCents,
      },
      daysInInventory: vehicle.daysInInventory,
    });
    pricing = {
      landedCostCents: ladder.landedCostCents,
      askingPriceCents: ladder.asking.priceCents,
      targetSellingPriceCents: ladder.target.priceCents,
      minimumApprovedPriceCents: ladder.minimumApproved.priceCents,
      minimumApprovedGrossCents: ladder.minimumApproved.grossProfitCents,
      minimumApprovedRoiBasisPoints: ladder.minimumApproved.roiBasisPoints,
      targetGrossCents: ladder.target.grossProfitCents,
      targetRoiBasisPoints: ladder.target.roiBasisPoints,
      askingGrossCents: ladder.asking.grossProfitCents,
      askingRoiBasisPoints: ladder.asking.roiBasisPoints,
      bindingConstraint: ladder.bindingConstraint,
      negotiationAllowanceCents: ladder.negotiationAllowanceCents,
      agingDiscountCents: ladder.agingDiscountCents,
      marketTargetApplied: ladder.marketTargetApplied,
      belowMarketTarget: ladder.belowMarketTarget,
      reasons: ladder.reasons,
      warnings: ladder.warnings,
    };
  }

  return {
    vehicle,
    sellingPriceCents,
    asOf,
    jurisdiction: jurisdiction ?? null,
    pricing,
    base,
  };
}

/** The vehicle title used in every analysis echo. */
function setupTitle(vehicle: VehicleInventoryView): string {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`;
}

/** One masking pass over an object that carries cost-derived keys. */
function masked<T>(value: unknown, actor: { role: UserRole }): T {
  return maskVehicleFinancials(value as Record<string, unknown>, actor) as unknown as T;
}

/**
 * Scores every payment mode for one vehicle and one set of terms — the Deal
 * Desk's comparison, computed entirely on the server.
 *
 * READ-ONLY: nothing is persisted, and the caller needs only `deals:read`.
 * The landed cost comes from `getVehicleDetail`, which has ALREADY masked it for
 * a role without `finance:read`; the engine treats that null as "unknown" and
 * returns no gross, no score and no ranking rather than a fabricated margin.
 *
 * Capability: `deals:read`.
 */
export async function evaluateDealStructuresAction(
  formData: FormData,
): Promise<ActionResult<DealComparisonContract>> {
  return runOperation("sales.evaluateDealStructures", async () => {
    const ctx = await operationContext("deals:read");
    const setup = await readDealSetup(ctx, formData);

    const comparison = compareDealStructures(
      DEAL_PAYMENT_MODES.map((mode: DealPaymentMode) => ({
        mode,
        ...setup.base,
      })),
    );

    // MASK EVERY STRUCTURE INDIVIDUALLY. Role masking nulls top-level keys, so
    // masking the envelope would leave the cost fields inside each structure
    // untouched. The operations already withheld the landed cost (which makes
    // the engine return null gross and no score); this pass is the second lock.
    const structures = comparison.structures.map((structure) =>
      masked<DealStructureContract>(structureContract(structure), ctx.actor),
    );

    const contract: DealComparisonContract = {
      headline: comparison.headline,
      recommendedMode: comparison.recommended?.mode ?? null,
      reasons: comparison.reasons,
      structures,
      unavailable: comparison.unavailable.map((entry) => ({ mode: entry.mode, reason: entry.reason })),
      pricing: setup.pricing === null ? null : masked<DealPricingContract>(setup.pricing, ctx.actor),
      echo: {
        vehicleId: setup.vehicle.id,
        vehicleTitle: setupTitle(setup.vehicle),
        sellingPriceCents: setup.sellingPriceCents,
        landedCostVisible: setup.vehicle.landedCostCents !== null,
        asOfIso: setup.asOf.toISOString(),
        jurisdiction: setup.jurisdiction,
      },
    };

    return contract;
  });
}

/**
 * TARGET MONTHLY PAYMENT — "I want this deal around $450 a month."
 *
 * The inverse solver runs entirely on the server, over the canonical forward
 * engine (a bisection, so no second amortisation implementation exists). It
 * returns every candidate term with the payment at the available down payment,
 * the principal that WOULD meet the target, and the down payment that would get
 * there — plus a recommendation, or an honest "no feasible term".
 *
 * Capability: `deals:read`.
 */
export async function solveTargetPaymentAction(
  formData: FormData,
): Promise<ActionResult<TargetPaymentResultContract>> {
  return runOperation("sales.solveTargetPayment", async () => {
    const ctx = await operationContext("deals:read");
    const setup = await readDealSetup(ctx, formData);
    const mode = enumField(formData, "mode", FINANCED_PAYMENT_MODES, "EXTERNAL_FINANCE", "Payment mode");
    const targetPaymentCents = requireFormCents(formData, "targetPayment", "Target payment");
    if (targetPaymentCents <= 0) {
      throw new ActionError("Enter the monthly payment the customer is aiming for.", {
        targetPayment: ["A target payment above zero is required."],
      });
    }

    const result = solveTargetPayment({
      ...setup.base,
      mode,
      targetPaymentCents,
      termCandidatesMonths: optionalTermCandidates(formData),
    });

    const options = result.options.map((option) => {
      const structure = masked<DealStructureContract>(structureContract(option.structure), ctx.actor);
      return masked<TargetPaymentOptionContract>({ ...option, structure }, ctx.actor);
    });
    const feasible = options.filter((option) => option.fits);

    return {
      mode: result.mode,
      modeLabel: result.modeLabel,
      targetPaymentCents: result.targetPaymentCents,
      downPaymentCents: result.downPaymentCents,
      aprBasisPoints: result.aprBasisPoints,
      paymentFrequency: result.paymentFrequency,
      options,
      feasible,
      shortestFeasibleTermMonths: result.shortestFeasibleTermMonths,
      recommendedTermMonths: result.recommended?.termMonths ?? null,
      headline: result.headline,
      reasons: result.reasons,
      warnings: result.warnings,
      pricing: setup.pricing === null ? null : masked<DealPricingContract>(setup.pricing, ctx.actor),
      echo: {
        vehicleId: setup.vehicle.id,
        vehicleTitle: setupTitle(setup.vehicle),
        landedCostVisible: setup.vehicle.landedCostCents !== null,
        asOfIso: setup.asOf.toISOString(),
        jurisdiction: setup.jurisdiction,
      },
    };
  });
}

/** The modes a payment-budget request may consider, from the form's checkboxes. */
function budgetModesFromForm(formData: FormData): DealPaymentMode[] {
  const requested = formData
    .getAll("modes")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => (FINANCED_PAYMENT_MODES as readonly string[]).includes(value));
  const unique = [...new Set(requested)] as DealPaymentMode[];
  return unique.length > 0 ? unique : [...FINANCED_PAYMENT_MODES];
}

/** An optional explicit term list, for a caller that wants its own candidates. */
function optionalTermCandidates(formData: FormData): readonly number[] | undefined {
  const raw = formData.get("termCandidatesMonths");
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const parsed = raw
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 180);
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * FIT A PAYMENT BUDGET — "the customer can put $2,000 down and pay $375 a month;
 * what actually fits?"
 *
 * NOT underwriting and NOT lender approval. It answers one mathematical question
 * across the modes and terms the operator allows, ranks the survivors with the
 * same engine the Deal Desk uses, and says plainly when nothing fits.
 *
 * Capability: `deals:read`.
 */
export async function fitPaymentBudgetAction(
  formData: FormData,
): Promise<ActionResult<PaymentBudgetResultContract>> {
  return runOperation("sales.fitPaymentBudget", async () => {
    const ctx = await operationContext("deals:read");
    const setup = await readDealSetup(ctx, formData);
    const maxPaymentCents = requireFormCents(formData, "maxPayment", "Maximum payment");
    if (maxPaymentCents <= 0) {
      throw new ActionError("Enter the most the customer can pay per period.", {
        maxPayment: ["A maximum payment above zero is required."],
      });
    }

    const modes = budgetModesFromForm(formData);
    // One rate for every mode the operator allowed: the form's own APR (or the
    // dealership default). A lender's rate can differ per mode later; today the
    // operator states the rate they are quoting.
    const aprByMode = Object.fromEntries(modes.map((mode) => [mode, setup.base.aprBasisPoints]));

    const result = fitPaymentBudget({
      ...setup.base,
      modes,
      maxPaymentCents,
      aprBasisPointsByMode: aprByMode,
      termCandidatesMonths: optionalTermCandidates(formData),
    });

    const mapOption = (option: (typeof result.allOptions)[number]): PaymentBudgetOptionContract => {
      const structure = masked<DealStructureContract>(structureContract(option.structure), ctx.actor);
      return masked<PaymentBudgetOptionContract>({ ...option, structure }, ctx.actor);
    };
    const options = result.options.map(mapOption);

    return {
      maxPaymentCents: result.maxPaymentCents,
      downPaymentCents: result.downPaymentCents,
      paymentFrequency: result.paymentFrequency,
      options,
      optionCountBuilt: result.allOptions.length,
      shortestFeasibleTermMonths: result.shortestFeasibleTermMonths,
      recommended: result.recommended === null ? null : mapOption(result.recommended),
      headline: result.headline,
      reasons: result.reasons,
      warnings: result.warnings,
      unavailable: result.unavailable.map((entry) => ({ mode: entry.mode, reason: entry.reason })),
      pricing: setup.pricing === null ? null : masked<DealPricingContract>(setup.pricing, ctx.actor),
      echo: {
        vehicleId: setup.vehicle.id,
        vehicleTitle: setupTitle(setup.vehicle),
        landedCostVisible: setup.vehicle.landedCostCents !== null,
        asOfIso: setup.asOf.toISOString(),
        jurisdiction: setup.jurisdiction,
      },
    };
  });
}
