import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AcquisitionSource, TitleStatus, Vehicle } from "@/generated/prisma";
import { ConflictError, NotFoundError } from "@/lib/domain-errors";
import type { LandedCostBreakdown } from "@/lib/economics";
import { computeLandedCost } from "@/lib/economics";
import { deriveListingStatus } from "@/lib/vehicle-status";
import { assertCapability, type OperationContext } from "./context";
import { rethrowUniqueViolation } from "./db-errors";
import { centsSchema, positiveCentsSchema, recordIdSchema, requiredText, vinSchema } from "./schemas";
import { assertCandidateApprovable } from "./sourcing";

/**
 * ACQUISITION — turning an approved opportunity into owned inventory.
 *
 * The critical property is atomicity. Creating the vehicle, marking the
 * candidate purchased and writing the first lifecycle event are three writes
 * that only make sense together: a vehicle with no candidate link is a car with
 * no provenance, and a candidate marked purchased with no vehicle is a lost
 * record of money spent. They happen in one transaction or not at all.
 *
 * VIN and stock-number uniqueness are NOT pre-checked with a read: the database
 * unique indexes are the arbiter, and their violation is translated into a
 * stable `ConflictError`.
 */

export const ACQUISITION_SOURCES = [
  "AUCTION",
  "DEALER_TRADE",
  "PRIVATE_PARTY",
  "WHOLESALE",
  "CONSIGNMENT",
  "CUSTOMER_TRADE_IN",
  "OTHER",
] as const satisfies readonly AcquisitionSource[];

export const TITLE_STATUSES = [
  "UNKNOWN",
  "CLEAN",
  "SALVAGE",
  "REBUILT",
  "FLOOD",
  "LEMON",
  "BONDED",
  "PARTS_ONLY",
] as const satisfies readonly TitleStatus[];

/** `SN-XXXXXXXX`. The unique index is the real guarantee; this only seeds it. */
export function generateStockNumber(): string {
  return `SN-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export const acquisitionSchema = z.object({
  candidateId: recordIdSchema,

  vehicle: z.object({
    vin: vinSchema,
    year: z.number().int().min(1900).max(2100),
    make: requiredText(80),
    model: requiredText(80),
    trim: requiredText(80).optional(),
    mileage: z.number().int().min(0).max(2_000_000),
    /** Omit to have one generated. */
    stockNumber: requiredText(40).optional(),
    exteriorColor: requiredText(40).optional(),
    interiorColor: requiredText(40).optional(),
    transmission: requiredText(60).optional(),
    drivetrain: requiredText(60).optional(),
    engine: requiredText(120).optional(),
    fuelType: requiredText(40).optional(),
    bodyType: requiredText(60).optional(),
    doors: z.number().int().min(0).max(20).optional(),
    seats: z.number().int().min(0).max(60).optional(),
    titleStatus: z.enum(TITLE_STATUSES).optional(),
    location: requiredText(120).optional(),
    notes: z.string().trim().max(5_000).optional(),
  }),

  /**
   * The acquisition cost block. These five amounts are the ONLY home for
   * purchase-related cost; `Expense` deliberately cannot represent them.
   */
  acquisition: z.object({
    source: z.enum(ACQUISITION_SOURCES),
    date: z.coerce.date().nullable().optional(),
    purchasePriceCents: centsSchema,
    auctionFeesCents: centsSchema.optional(),
    transportationCents: centsSchema.optional(),
    inspectionCents: centsSchema.optional(),
    otherCents: centsSchema.optional(),
  }),

  /** Optional pricing captured at purchase time (the car is not listed yet). */
  pricing: z
    .object({
      targetRetailPriceCents: centsSchema.nullable().optional(),
      askingPriceCents: positiveCentsSchema.nullable().optional(),
      minimumApprovedCents: centsSchema.nullable().optional(),
    })
    .optional(),
});

export type AcquireVehicleInput = z.input<typeof acquisitionSchema>;
export type AcquireVehicleParsed = z.output<typeof acquisitionSchema>;

export interface AcquireVehicleResult {
  vehicle: Vehicle;
  candidateId: string;
  landedCost: LandedCostBreakdown;
}

/**
 * Creates the canonical Vehicle from an approved sourcing candidate.
 *
 * Lifecycle starts at PURCHASED — the car is owned but not yet inspected,
 * reconditioned or listed — and that first transition is recorded as a
 * `VehicleStatusEvent` with no previous status.
 *
 * Capability: `sourcing:write` (OWNER, MANAGER). Deliberately NOT
 * `inventory:write`: a recon technician may adjust inventory, but committing
 * capital is a manager decision.
 */
export async function acquireVehicleFromCandidate(
  ctx: OperationContext,
  rawInput: AcquireVehicleInput,
): Promise<AcquireVehicleResult> {
  assertCapability(ctx, "sourcing:write");

  const input = acquisitionSchema.parse(rawInput);
  const askingPriceCents = input.pricing?.askingPriceCents ?? null;
  const minimumApprovedCents = input.pricing?.minimumApprovedCents ?? null;

  // Mirrors the `vehicles_asking_above_minimum` constraint with a message an
  // operator can act on, instead of a raw CHECK violation.
  if (askingPriceCents !== null && minimumApprovedCents !== null && askingPriceCents < minimumApprovedCents) {
    throw new ConflictError("The asking price cannot be below the minimum approved price.");
  }

  try {
    return await ctx.db.$transaction(async (tx) => {
      const candidate = await tx.sourcingCandidate.findUnique({ where: { id: input.candidateId } });
      if (!candidate) throw new NotFoundError("That sourcing candidate no longer exists.");
      assertCandidateApprovable(candidate);

      const vehicle = await tx.vehicle.create({
        data: {
          vin: input.vehicle.vin,
          stockNumber: input.vehicle.stockNumber ?? generateStockNumber(),
          year: input.vehicle.year,
          make: input.vehicle.make,
          model: input.vehicle.model,
          trim: input.vehicle.trim ?? null,
          mileage: input.vehicle.mileage,
          exteriorColor: input.vehicle.exteriorColor ?? null,
          interiorColor: input.vehicle.interiorColor ?? null,
          transmission: input.vehicle.transmission ?? null,
          drivetrain: input.vehicle.drivetrain ?? null,
          engine: input.vehicle.engine ?? null,
          fuelType: input.vehicle.fuelType ?? null,
          bodyType: input.vehicle.bodyType ?? null,
          doors: input.vehicle.doors ?? null,
          seats: input.vehicle.seats ?? null,
          titleStatus: input.vehicle.titleStatus ?? "UNKNOWN",
          location: input.vehicle.location ?? null,
          notes: input.vehicle.notes ?? null,

          status: "PURCHASED",
          listingStatus: deriveListingStatus("PURCHASED"),
          dataOrigin: "REAL",

          acquisitionSource: input.acquisition.source,
          acquisitionDate: input.acquisition.date ?? new Date(),
          acquisitionPriceCents: input.acquisition.purchasePriceCents,
          auctionFeesCents: input.acquisition.auctionFeesCents ?? 0,
          transportationCents: input.acquisition.transportationCents ?? 0,
          inspectionCents: input.acquisition.inspectionCents ?? 0,
          otherAcquisitionCents: input.acquisition.otherCents ?? 0,

          targetRetailPriceCents: input.pricing?.targetRetailPriceCents ?? null,
          askingPriceCents,
          minimumApprovedCents,
        },
      });

      await tx.sourcingCandidate.update({
        where: { id: candidate.id },
        data: {
          status: "PURCHASED",
          purchasedVehicleId: vehicle.id,
          decidedById: ctx.actor.id,
          decidedAt: new Date(),
        },
      });

      await tx.vehicleStatusEvent.create({
        data: {
          vehicleId: vehicle.id,
          fromStatus: null,
          toStatus: "PURCHASED",
          note: `Acquired from sourcing candidate ${candidate.id}.`,
          changedById: ctx.actor.id,
        },
      });

      return {
        vehicle,
        candidateId: candidate.id,
        landedCost: computeLandedCost({
          acquisition: {
            acquisitionPriceCents: vehicle.acquisitionPriceCents,
            auctionFeesCents: vehicle.auctionFeesCents,
            transportationCents: vehicle.transportationCents,
            inspectionCents: vehicle.inspectionCents,
            otherAcquisitionCents: vehicle.otherAcquisitionCents,
          },
        }),
      };
    });
  } catch (error) {
    return rethrowUniqueViolation(
      error,
      {
        vin: "A vehicle with that VIN already exists.",
        stockNumber: "That stock number is already in use.",
        stock_number: "That stock number is already in use.",
      },
      "That vehicle conflicts with an existing record.",
    );
  }
}
