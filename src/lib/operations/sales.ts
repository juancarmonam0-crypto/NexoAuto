import { z } from "zod";
import type { BasisPoints, Cents } from "@/lib/money";
import type { DealStatus, FinanceType, Prisma } from "@/generated/prisma";
import { ActionError } from "@/lib/action-result";
import { maskVehicleFinancials } from "@/lib/auth/masking";
import { ConflictError, NotFoundError } from "@/lib/domain-errors";
import type { LandedCostBreakdown } from "@/lib/economics";
import { computeVehicleEconomics } from "@/lib/economics";
import { toCents } from "@/lib/money";
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
 * Actual profit is never recomputed here — it comes from
 * `computeVehicleEconomics()`, the same engine the sourcing screen uses.
 */

export const FINANCE_TYPES = [
  "CASH",
  "FINANCE",
  "LEASE",
  "BUY_HERE_PAY_HERE",
  "UNDECIDED",
] as const satisfies readonly FinanceType[];

/** Deal states that release a vehicle: they no longer hold it. */
export const DEAD_DEAL_STATUSES = ["CANCELLED", "LOST"] as const satisfies readonly DealStatus[];

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
});

export type CompleteSaleInput = z.input<typeof completeSaleSchema>;

/**
 * The internal result of a completed sale.
 *
 * Cost-derived fields are nullable because a role without `finance:read`
 * receives `null`: a salesperson may complete a sale without being handed the
 * dealership's cost basis. The field names are chosen so
 * `maskVehicleFinancials()` strips them automatically.
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

      const dealData = {
        salePriceCents: input.salePriceCents,
        status: "CONTRACTED" as const,
        saleDate,
        salespersonId: liveDeal?.salespersonId ?? ctx.actor.id,
        dealerFeesCents: input.dealerFeesCents ?? liveDeal?.dealerFeesCents ?? 0,
        financeType: input.financeType ?? liveDeal?.financeType ?? ("UNDECIDED" as const),
        leadId: input.leadId ?? liveDeal?.leadId ?? null,
        notes: input.notes ?? liveDeal?.notes ?? null,
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
