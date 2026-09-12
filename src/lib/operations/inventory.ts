import { z } from "zod";
import type {
  Expense,
  ExpenseCategory,
  ListingStatus,
  Prisma,
  ReconStatus,
  Vehicle,
  VehiclePhoto,
  VehicleReconItem,
  VehicleStatus,
} from "@/generated/prisma";
import { ActionError } from "@/lib/action-result";
import { ConflictError, NotFoundError } from "@/lib/domain-errors";
import type { BasisPoints, Cents } from "@/lib/money";
import { toCents } from "@/lib/money";
import type { LandedCostBreakdown } from "@/lib/economics";
import { computeVehicleEconomics } from "@/lib/economics";
import { buildStorageKey, saveUploadedFile, validateUpload } from "@/lib/storage";
import {
  ALL_VEHICLE_STATUSES,
  assertTransition,
  deriveListingStatus,
  isPubliclyVisible,
} from "@/lib/vehicle-status";
import { maskVehicleFinancials } from "@/lib/auth/masking";
import { actorCan, assertCapability, type OperationContext } from "./context";
import { centsSchema, positiveCentsSchema, recordIdSchema, requiredText } from "./schemas";

/**
 * CARS — inventory operations.
 *
 * Two rules run through this module:
 *
 *  1. NOTHING BYPASSES THE DATABASE. Every write here also honours the CHECK
 *     constraints and partial indexes from migrations 0002/0003; where a
 *     constraint exists, the operation either satisfies it or fails with a
 *     message the operator can act on.
 *
 *  2. COST DATA IS MASKED SERVER-SIDE. A vehicle payload is built flat, with the
 *     derived money fields named exactly as `maskVehicleFinancials()` expects,
 *     and masked before it is returned. A salesperson reading an inventory list
 *     cannot see the dealer's cost basis, the price floor or the margin.
 */

export const EXPENSE_CATEGORIES = [
  "PARTS",
  "LABOR",
  "DETAIL",
  "TIRES",
  "GLASS",
  "MECHANICAL",
  "BODY",
  "SUBLET",
  "KEYS",
  "FUEL",
  "TITLE_REGISTRATION",
  "FLOORPLAN_INTEREST",
  "ADVERTISING",
  "SOFTWARE",
  "LOT_RENT",
  "UTILITIES",
  "INSURANCE",
  "PROFESSIONAL_FEES",
  "MISC",
] as const satisfies readonly ExpenseCategory[];

export const RECON_STATUSES = [
  "ESTIMATED",
  "APPROVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const satisfies readonly ReconStatus[];

export const LISTING_STATUSES = [
  "UNLISTED",
  "ACTIVE",
  "PAUSED",
  "SOLD",
  "ARCHIVED",
] as const satisfies readonly ListingStatus[];

/**
 * Derived economics attached to a vehicle payload.
 *
 * Every money field is declared nullable because a role without `finance:read`
 * receives `null` at runtime. Typing them as non-null would let a client render
 * a cost figure that the server deliberately withheld.
 *
 * The field NAMES are load-bearing: `landedCostCents`,
 * `estimatedGrossProfitCents`, `actualGrossProfitCents`, `expectedProfitCents`
 * and `landedCost` are the keys `maskVehicleFinancials()` strips.
 */
export type VehicleEconomicsView = {
  landedCostCents: Cents | null;
  estimatedGrossProfitCents: Cents | null;
  actualGrossProfitCents: Cents | null;
  expectedProfitCents: Cents | null;
  estimatedRoiBasisPoints: BasisPoints | null;
  actualRoiBasisPoints: BasisPoints | null;
  frontEndMarginCents: Cents | null;
  negotiatingRoomCents: Cents | null;
  landedCost: LandedCostBreakdown | null;
  expectedSalePriceCents: Cents | null;
  expectedSalePriceSource: "target" | "asking" | "none";
  daysInInventory: number | null;
  isSold: boolean;
};

export type VehicleInventoryView = Vehicle & VehicleEconomicsView;

/** Everything the economics engine needs, as loaded from the database. */
export type VehicleEconomicsSource = Pick<
  Vehicle,
  | "acquisitionPriceCents"
  | "auctionFeesCents"
  | "transportationCents"
  | "inspectionCents"
  | "otherAcquisitionCents"
  | "reconOverrideCents"
  | "targetRetailPriceCents"
  | "askingPriceCents"
  | "minimumApprovedCents"
  | "acquisitionDate"
  | "dateSold"
  | "finalSalePriceCents"
> & {
  reconItems: ReadonlyArray<Pick<VehicleReconItem, "estimateCents" | "actualCostCents">>;
  expenses: ReadonlyArray<Pick<Expense, "amountCents">>;
};

/**
 * GPS/tracker fields.
 *
 * The `tracker:read` capability gates them (OWNER, MANAGER), yet the vehicle row
 * carries them on every read. Returning the row wholesale would hand the device
 * identifier and the vehicle's last known coordinates to any role that can read
 * inventory — RECON, SALES and VIEWER included — silently bypassing the
 * capability. Phase 3 already excludes these columns from the public views; this
 * closes the same hole on the internal read path.
 */
const TRACKER_FIELDS = [
  "trackerDeviceId",
  "trackerStatus",
  "trackerLastLatitude",
  "trackerLastLongitude",
  "trackerLastSeenAt",
  "trackerGeofenceState",
] as const;

function stripTrackerFields<T extends Record<string, unknown>>(payload: T): T {
  const copy: Record<string, unknown> = { ...payload };
  for (const key of TRACKER_FIELDS) {
    if (key in copy) copy[key] = null;
  }
  return copy as T;
}

/** Pure: turns a loaded vehicle into the flat, maskable payload. */
export function buildVehicleView(
  ctx: OperationContext,
  vehicle: Vehicle & { reconItems?: VehicleEconomicsSource["reconItems"]; expenses?: VehicleEconomicsSource["expenses"] },
  asOf: Date = new Date(),
): VehicleInventoryView {
  const reconItems = vehicle.reconItems ?? [];
  const expenses = vehicle.expenses ?? [];
  const additionalExpenseCents = expenses.reduce((total, row) => total + toCents(row.amountCents), 0);

  const economics = computeVehicleEconomics(
    {
      acquisition: {
        acquisitionPriceCents: vehicle.acquisitionPriceCents,
        auctionFeesCents: vehicle.auctionFeesCents,
        transportationCents: vehicle.transportationCents,
        inspectionCents: vehicle.inspectionCents,
        otherAcquisitionCents: vehicle.otherAcquisitionCents,
      },
      reconItems,
      reconOverrideCents: vehicle.reconOverrideCents,
      additionalExpenseCents,
      targetRetailPriceCents: vehicle.targetRetailPriceCents,
      askingPriceCents: vehicle.askingPriceCents,
      minimumApprovedCents: vehicle.minimumApprovedCents,
      acquisitionDate: vehicle.acquisitionDate,
      dateSold: vehicle.dateSold,
      finalSalePriceCents: vehicle.finalSalePriceCents,
    },
    asOf,
  );

  // `reconItems` / `expenses` are dropped from the payload: they carry cost
  // detail that a masked viewer must not receive, and the economics summary
  // already expresses what they add up to.
  const rest: Record<string, unknown> = { ...vehicle };
  delete rest.reconItems;
  delete rest.expenses;

  const view: VehicleInventoryView = {
    ...(rest as unknown as Vehicle),
    landedCostCents: economics.landedCost.landedCostCents,
    estimatedGrossProfitCents: economics.estimatedGrossProfitCents,
    actualGrossProfitCents: economics.actualGrossProfitCents,
    expectedProfitCents: economics.estimatedGrossProfitCents,
    estimatedRoiBasisPoints: economics.estimatedRoiBasisPoints,
    actualRoiBasisPoints: economics.actualRoiBasisPoints,
    frontEndMarginCents: economics.frontEndMarginCents,
    negotiatingRoomCents: economics.negotiatingRoomCents,
    landedCost: economics.landedCost,
    expectedSalePriceCents: economics.expectedSalePriceCents,
    expectedSalePriceSource: economics.expectedSalePriceSource,
    daysInInventory: economics.daysInInventory,
    isSold: economics.isSold,
  };

  const masked = maskVehicleFinancials(view, ctx.actor);
  return actorCan(ctx, "tracker:read") ? masked : stripTrackerFields(masked);
}

const ECONOMICS_SELECT = {
  reconItems: { select: { estimateCents: true, actualCostCents: true } },
  expenses: { select: { amountCents: true } },
} satisfies Prisma.VehicleInclude;

async function loadView(ctx: OperationContext, vehicleId: string): Promise<VehicleInventoryView> {
  const vehicle = await ctx.db.vehicle.findUnique({
    where: { id: vehicleId },
    include: ECONOMICS_SELECT,
  });
  if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");
  return buildVehicleView(ctx, vehicle);
}

export const inventoryListFilterSchema = z.object({
  status: z.enum(ALL_VEHICLE_STATUSES).optional(),
  listingStatus: z.enum(LISTING_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type InventoryListFilter = z.input<typeof inventoryListFilterSchema>;

export interface InventoryListResult {
  items: VehicleInventoryView[];
  total: number;
}

/** Capability: `inventory:read`. */
export async function listInventory(
  ctx: OperationContext,
  rawFilter: InventoryListFilter = {},
): Promise<InventoryListResult> {
  assertCapability(ctx, "inventory:read");

  const filter = inventoryListFilterSchema.parse(rawFilter);
  const search = filter.search;
  const where: Prisma.VehicleWhereInput = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.listingStatus ? { listingStatus: filter.listingStatus } : {}),
    ...(search
      ? {
          OR: [
            { vin: { contains: search, mode: "insensitive" } },
            { stockNumber: { contains: search, mode: "insensitive" } },
            { make: { contains: search, mode: "insensitive" } },
            { model: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    ctx.db.vehicle.findMany({
      where,
      include: ECONOMICS_SELECT,
      orderBy: [{ createdAt: "desc" }],
      take: filter.limit,
      skip: filter.offset,
    }),
    ctx.db.vehicle.count({ where }),
  ]);

  return { items: rows.map((row) => buildVehicleView(ctx, row)), total };
}

export interface VehicleDetail {
  vehicle: VehicleInventoryView;
  photos: VehiclePhoto[];
  statusEvents: Array<{ id: string; fromStatus: VehicleStatus | null; toStatus: VehicleStatus; note: string | null; createdAt: Date }>;
  /** Present only for roles allowed to see spend. */
  expenses?: Expense[];
  /** Present only for roles allowed to see reconditioning. */
  reconItems?: VehicleReconItem[];
  publiclyVisible: boolean;
}

/**
 * Capability: `inventory:read`.
 *
 * Cost detail is not merely masked but omitted: a role without `expenses:read`
 * never receives the expense rows, and a role without `recon:write` never
 * receives the recon items.
 */
export async function getVehicleDetail(
  ctx: OperationContext,
  vehicleId: string,
): Promise<VehicleDetail> {
  assertCapability(ctx, "inventory:read");

  const id = recordIdSchema.parse(vehicleId);
  const vehicle = await ctx.db.vehicle.findUnique({
    where: { id },
    include: ECONOMICS_SELECT,
  });
  if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");

  const [photos, statusEvents, expenses, reconItems] = await Promise.all([
    ctx.db.vehiclePhoto.findMany({ where: { vehicleId: id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    ctx.db.vehicleStatusEvent.findMany({
      where: { vehicleId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, fromStatus: true, toStatus: true, note: true, createdAt: true },
    }),
    actorCan(ctx, "expenses:read")
      ? ctx.db.expense.findMany({ where: { vehicleId: id }, orderBy: { incurredOn: "desc" } })
      : Promise.resolve(undefined),
    actorCan(ctx, "recon:write")
      ? ctx.db.vehicleReconItem.findMany({ where: { vehicleId: id }, orderBy: { createdAt: "asc" } })
      : Promise.resolve(undefined),
  ]);

  return {
    vehicle: buildVehicleView(ctx, vehicle),
    photos,
    statusEvents,
    ...(expenses ? { expenses } : {}),
    ...(reconItems ? { reconItems } : {}),
    publiclyVisible: isPubliclyVisible(vehicle.status),
  };
}

/** Descriptive fields only. Pricing, status and cost have their own operations. */
export const vehicleDetailsSchema = z
  .object({
    trim: requiredText(80).nullable().optional(),
    exteriorColor: requiredText(40).nullable().optional(),
    interiorColor: requiredText(40).nullable().optional(),
    transmission: requiredText(60).nullable().optional(),
    drivetrain: requiredText(60).nullable().optional(),
    engine: requiredText(120).nullable().optional(),
    fuelType: requiredText(40).nullable().optional(),
    bodyType: requiredText(60).nullable().optional(),
    doors: z.number().int().min(0).max(20).nullable().optional(),
    seats: z.number().int().min(0).max(60).nullable().optional(),
    mileage: z.number().int().min(0).max(2_000_000).optional(),
    titleStatus: z.enum(["UNKNOWN", "CLEAN", "SALVAGE", "REBUILT", "FLOOD", "LEMON", "BONDED", "PARTS_ONLY"]).optional(),
    location: requiredText(120).nullable().optional(),
    notes: z.string().trim().max(5_000).nullable().optional(),
    description: z.string().trim().max(20_000).nullable().optional(),
    features: z.array(requiredText(60)).max(60).optional(),
  })
  .strict();

export type VehicleDetailsPatch = z.input<typeof vehicleDetailsSchema>;

/** Capability: `inventory:write` (OWNER, MANAGER, RECON). */
export async function updateVehicleDetails(
  ctx: OperationContext,
  vehicleId: string,
  patch: VehicleDetailsPatch,
): Promise<VehicleInventoryView> {
  assertCapability(ctx, "inventory:write");

  const id = recordIdSchema.parse(vehicleId);
  // `.strict()` above means a caller that tries to slip `askingPriceCents` or
  // `status` through this operation gets a validation error rather than a
  // silent no-op.
  const parsed = vehicleDetailsSchema.parse(patch);
  if (Object.keys(parsed).length === 0) throw new ActionError("Nothing to update.");

  const existing = await ctx.db.vehicle.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("That vehicle no longer exists.");

  await ctx.db.vehicle.update({ where: { id }, data: parsed });
  return loadView(ctx, id);
}

export const vehiclePricingSchema = z
  .object({
    targetRetailPriceCents: centsSchema.nullable().optional(),
    askingPriceCents: positiveCentsSchema.nullable().optional(),
    minimumApprovedCents: centsSchema.nullable().optional(),
  })
  .strict();

export type VehiclePricingPatch = z.input<typeof vehiclePricingSchema>;

/**
 * Capability: `pricing:write` (OWNER, MANAGER).
 *
 * Mirrors `vehicles_asking_above_minimum` and
 * `vehicles_active_listing_requires_price` so the operator gets a sentence
 * instead of a raw constraint violation — and so a listed car can never be
 * repriced to nothing.
 */
export async function updateVehiclePricing(
  ctx: OperationContext,
  vehicleId: string,
  patch: VehiclePricingPatch,
): Promise<VehicleInventoryView> {
  assertCapability(ctx, "pricing:write");

  const id = recordIdSchema.parse(vehicleId);
  const parsed = vehiclePricingSchema.parse(patch);
  if (Object.keys(parsed).length === 0) throw new ActionError("Nothing to update.");

  const existing = await ctx.db.vehicle.findUnique({
    where: { id },
    select: { id: true, listingStatus: true, askingPriceCents: true, minimumApprovedCents: true },
  });
  if (!existing) throw new NotFoundError("That vehicle no longer exists.");

  const asking = parsed.askingPriceCents === undefined ? existing.askingPriceCents : parsed.askingPriceCents;
  const minimum =
    parsed.minimumApprovedCents === undefined ? existing.minimumApprovedCents : parsed.minimumApprovedCents;

  if (asking !== null && minimum !== null && asking < minimum) {
    throw new ConflictError("The asking price cannot be below the minimum approved price.");
  }
  if (existing.listingStatus === "ACTIVE" && (asking === null || asking <= 0)) {
    throw new ConflictError("A published vehicle must keep an asking price. Unpublish it first.");
  }

  await ctx.db.vehicle.update({ where: { id }, data: parsed });
  return loadView(ctx, id);
}

export const vehicleAcquisitionSchema = z
  .object({
    acquisitionSource: z
      .enum(["AUCTION", "DEALER_TRADE", "PRIVATE_PARTY", "WHOLESALE", "CONSIGNMENT", "CUSTOMER_TRADE_IN", "OTHER"])
      .nullable()
      .optional(),
    acquisitionDate: z.coerce.date().nullable().optional(),
    acquisitionPriceCents: centsSchema.optional(),
    auctionFeesCents: centsSchema.optional(),
    transportationCents: centsSchema.optional(),
    inspectionCents: centsSchema.optional(),
    otherAcquisitionCents: centsSchema.optional(),
    reconOverrideCents: centsSchema.nullable().optional(),
  })
  .strict();

export type VehicleAcquisitionPatch = z.input<typeof vehicleAcquisitionSchema>;

/**
 * Capability: `pricing:write`.
 *
 * The existing matrix has `acquisition:read` but no `acquisition:write`; cost
 * edits are therefore gated by the money-write authority, which is already
 * exactly OWNER + MANAGER. Adding a capability would change no role's effective
 * access, so none was added.
 */
export async function updateVehicleAcquisition(
  ctx: OperationContext,
  vehicleId: string,
  patch: VehicleAcquisitionPatch,
): Promise<VehicleInventoryView> {
  assertCapability(ctx, "pricing:write");

  const id = recordIdSchema.parse(vehicleId);
  const parsed = vehicleAcquisitionSchema.parse(patch);
  if (Object.keys(parsed).length === 0) throw new ActionError("Nothing to update.");

  const existing = await ctx.db.vehicle.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("That vehicle no longer exists.");

  await ctx.db.vehicle.update({ where: { id }, data: parsed });
  return loadView(ctx, id);
}

export const expenseSchema = z.object({
  vehicleId: recordIdSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  amountCents: positiveCentsSchema,
  vendor: requiredText(120).nullable().optional(),
  incurredOn: z.coerce.date().optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  paid: z.boolean().optional(),
});

export type RecordExpenseInput = z.input<typeof expenseSchema>;

/**
 * Capability: `expenses:write` (OWNER, MANAGER, RECON).
 *
 * `ExpenseCategory` deliberately cannot express purchase price, auction fee,
 * transport, inspection or recon, so this operation cannot double-count a cost
 * that already lives on the vehicle.
 */
export async function recordVehicleExpense(
  ctx: OperationContext,
  rawInput: RecordExpenseInput,
): Promise<Expense> {
  assertCapability(ctx, "expenses:write");

  const input = expenseSchema.parse(rawInput);
  const vehicle = await ctx.db.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true } });
  if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");

  return ctx.db.expense.create({
    data: {
      vehicleId: input.vehicleId,
      category: input.category,
      amountCents: input.amountCents,
      vendor: input.vendor ?? null,
      incurredOn: input.incurredOn ?? new Date(),
      description: input.description ?? null,
      paid: input.paid ?? true,
    },
  });
}

export const reconItemSchema = z.object({
  vehicleId: recordIdSchema,
  issue: requiredText(300),
  vendor: requiredText(120).nullable().optional(),
  estimateCents: centsSchema.optional(),
  actualCostCents: centsSchema.nullable().optional(),
  status: z.enum(RECON_STATUSES).optional(),
  approvedByStaff: z.boolean().optional(),
  startedAt: z.coerce.date().nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
});

export type RecordReconItemInput = z.input<typeof reconItemSchema>;

/**
 * `recon_completed_has_date` requires a completion date, so one is stamped
 * automatically rather than letting the write fail.
 */
function completionStamp(
  status: ReconStatus | undefined,
  completedAt: Date | null | undefined,
): Date | null | undefined {
  if (status === "COMPLETED" && !completedAt) return new Date();
  return completedAt;
}

/** Capability: `recon:write` (OWNER, MANAGER, RECON). */
export async function recordReconItem(
  ctx: OperationContext,
  rawInput: RecordReconItemInput,
): Promise<VehicleReconItem> {
  assertCapability(ctx, "recon:write");

  const input = reconItemSchema.parse(rawInput);
  const vehicle = await ctx.db.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true } });
  if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");

  return ctx.db.vehicleReconItem.create({
    data: {
      vehicleId: input.vehicleId,
      issue: input.issue,
      vendor: input.vendor ?? null,
      estimateCents: input.estimateCents ?? 0,
      actualCostCents: input.actualCostCents ?? null,
      status: input.status ?? "ESTIMATED",
      approvedByStaff: input.approvedByStaff ?? false,
      startedAt: input.startedAt ?? null,
      completedAt: completionStamp(input.status, input.completedAt) ?? null,
      notes: input.notes ?? null,
    },
  });
}

export const reconItemPatchSchema = reconItemSchema.omit({ vehicleId: true }).partial().strict();
export type UpdateReconItemPatch = z.input<typeof reconItemPatchSchema>;

/** Capability: `recon:write`. */
export async function updateReconItem(
  ctx: OperationContext,
  reconItemId: string,
  patch: UpdateReconItemPatch,
): Promise<VehicleReconItem> {
  assertCapability(ctx, "recon:write");

  const id = recordIdSchema.parse(reconItemId);
  const parsed = reconItemPatchSchema.parse(patch);
  if (Object.keys(parsed).length === 0) throw new ActionError("Nothing to update.");

  const existing = await ctx.db.vehicleReconItem.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("That reconditioning item no longer exists.");

  const status = parsed.status ?? existing.status;
  const completedAt = completionStamp(status, parsed.completedAt ?? existing.completedAt);

  return ctx.db.vehicleReconItem.update({
    where: { id },
    data: { ...parsed, completedAt: completedAt ?? null },
  });
}

/**
 * Statuses that only their own operation may set.
 *
 * SOLD/DELIVERED need a recorded sale price (enforced by the database, but the
 * sale operation is where the money is written), and RESERVED is backed by a
 * `Reservation` row with a customer and a deposit. Allowing a bare status flip
 * would create a record that lies about the business.
 */
const SALES_ONLY_STATUSES: Partial<Record<VehicleStatus, string>> = {
  SOLD: "Complete the sale with the SALES operation; sold vehicles must record a final sale price.",
  DELIVERED: "Deliver the vehicle through its deal.",
  RESERVED: "Reserve the vehicle through the reservation flow, which records the customer and deposit.",
};

/** Statuses that take a vehicle out of retail: a manager-level decision. */
const MANAGER_ONLY_STATUSES: readonly VehicleStatus[] = ["WHOLESALE", "REJECTED"];

/**
 * Retail targets a vehicle with a RECORDED SALE must not re-enter.
 *
 * `vehicle-status.ts` allows SOLD -> LISTED ("a deal can be unwound"), but the
 * only correct way to unwind is `cancelDeal`, which also clears
 * `finalSalePriceCents` and `dateSold`. Letting the generic transition (or a
 * plain republish) put the car back on sale would leave a LISTED, publicly
 * visible vehicle that the economics engine still reports as sold, with a
 * CONTRACTED deal attached to it.
 */
const SALE_MUST_BE_CANCELLED_FIRST: readonly VehicleStatus[] = ["LISTED"];

const SOLD_VEHICLE_MESSAGE =
  "This vehicle carries a recorded sale. Cancel the sale before returning it to the retail catalog.";

export const statusTransitionSchema = z.object({
  vehicleId: recordIdSchema,
  toStatus: z.enum(ALL_VEHICLE_STATUSES),
  note: z.string().trim().max(1_000).optional(),
});

export type StatusTransitionInput = z.input<typeof statusTransitionSchema>;

/**
 * Moves a vehicle along the lifecycle.
 *
 * Legality comes from `assertTransition()` in `vehicle-status.ts`; this
 * operation adds authorization, the sales-only guard and the derived
 * `listingStatus` write, plus the audit event.
 *
 * Capability: `inventory:write`, except disposal to WHOLESALE/REJECTED which
 * requires `pricing:write`.
 */
export async function transitionVehicleStatus(
  ctx: OperationContext,
  rawInput: StatusTransitionInput,
): Promise<VehicleInventoryView> {
  assertCapability(ctx, "inventory:write");

  const input = statusTransitionSchema.parse(rawInput);
  const blockedReason = SALES_ONLY_STATUSES[input.toStatus];
  if (blockedReason) throw new ConflictError(blockedReason);
  if (MANAGER_ONLY_STATUSES.includes(input.toStatus)) {
    assertCapability(ctx, "pricing:write", "Only a manager can wholesale or reject a vehicle.");
  }

  const vehicle = await ctx.db.vehicle.findUnique({
    where: { id: input.vehicleId },
    select: { id: true, status: true, finalSalePriceCents: true },
  });
  if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");
  if (vehicle.finalSalePriceCents !== null && SALE_MUST_BE_CANCELLED_FIRST.includes(input.toStatus)) {
    throw new ConflictError(SOLD_VEHICLE_MESSAGE);
  }

  assertTransition(vehicle.status, input.toStatus);

  await ctx.db.$transaction(async (tx) => {
    await tx.vehicle.update({
      where: { id: vehicle.id },
      data: {
        status: input.toStatus,
        listingStatus: deriveListingStatus(input.toStatus),
        ...(input.toStatus === "WHOLESALE" || input.toStatus === "REJECTED" ? { dateListed: null } : {}),
      },
    });
    await tx.vehicleStatusEvent.create({
      data: {
        vehicleId: vehicle.id,
        fromStatus: vehicle.status,
        toStatus: input.toStatus,
        note: input.note ?? null,
        changedById: ctx.actor.id,
      },
    });
  });

  return loadView(ctx, vehicle.id);
}

/**
 * Publishes a vehicle to the retail surface.
 *
 * Requires the READY -> LISTED transition, a positive asking price (matching
 * `vehicles_active_listing_requires_price`) and sets `listingStatus = ACTIVE`.
 * `dateListed` is stamped once, so the original listing date survives a
 * temporary unpublish.
 *
 * Capability: `pricing:write`.
 */
export async function publishVehicle(
  ctx: OperationContext,
  vehicleId: string,
): Promise<VehicleInventoryView> {
  assertCapability(ctx, "pricing:write");

  const id = recordIdSchema.parse(vehicleId);
  const vehicle = await ctx.db.vehicle.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      listingStatus: true,
      askingPriceCents: true,
      dateListed: true,
      finalSalePriceCents: true,
    },
  });
  if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");
  if (vehicle.finalSalePriceCents !== null || vehicle.status === "SOLD" || vehicle.status === "DELIVERED") {
    throw new ConflictError(SOLD_VEHICLE_MESSAGE);
  }
  if (vehicle.listingStatus === "ACTIVE") throw new ConflictError("That vehicle is already published.");
  if (vehicle.askingPriceCents === null || vehicle.askingPriceCents <= 0) {
    throw new ConflictError("Set an asking price before publishing this vehicle.");
  }

  assertTransition(vehicle.status, "LISTED");

  await ctx.db.$transaction(async (tx) => {
    await tx.vehicle.update({
      where: { id },
      data: {
        status: "LISTED",
        listingStatus: "ACTIVE",
        dateListed: vehicle.dateListed ?? new Date(),
      },
    });
    await tx.vehicleStatusEvent.create({
      data: {
        vehicleId: id,
        fromStatus: vehicle.status,
        toStatus: "LISTED",
        note: "Published to the retail catalog.",
        changedById: ctx.actor.id,
      },
    });
  });

  return loadView(ctx, id);
}

/**
 * Unpublishes a vehicle, returning it to READY.
 *
 * Listing status is DERIVED from lifecycle status, so there is no separate
 * "paused" state to drift out of sync: an unpublished car is READY/UNLISTED.
 *
 * Capability: `pricing:write`.
 */
export async function unpublishVehicle(
  ctx: OperationContext,
  vehicleId: string,
): Promise<VehicleInventoryView> {
  assertCapability(ctx, "pricing:write");

  const id = recordIdSchema.parse(vehicleId);
  const vehicle = await ctx.db.vehicle.findUnique({
    where: { id },
    select: { id: true, status: true, listingStatus: true },
  });
  if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");
  if (vehicle.listingStatus !== "ACTIVE") throw new ConflictError("That vehicle is not published.");

  assertTransition(vehicle.status, "READY");

  await ctx.db.$transaction(async (tx) => {
    await tx.vehicle.update({
      where: { id },
      data: { status: "READY", listingStatus: deriveListingStatus("READY") },
    });
    await tx.vehicleStatusEvent.create({
      data: {
        vehicleId: id,
        fromStatus: vehicle.status,
        toStatus: "READY",
        note: "Unpublished from the retail catalog.",
        changedById: ctx.actor.id,
      },
    });
  });

  return loadView(ctx, id);
}

export const photoUploadSchema = z.object({
  vehicleId: recordIdSchema,
  fileName: requiredText(255),
  declaredMimeType: requiredText(120),
  alt: z.string().trim().max(200).optional(),
  bytes: z.instanceof(Uint8Array),
});

export type UploadVehiclePhotoInput = z.input<typeof photoUploadSchema>;

/**
 * Stores a vehicle photo through the existing storage boundary.
 *
 * The declared MIME type is never trusted: `validateUpload()` sniffs magic
 * bytes, allow-lists JPEG/PNG/WebP (SVG is rejected as a script carrier) and
 * the stored key is generated, so an uploaded filename cannot traverse paths.
 *
 * Capability: `inventory:write`.
 */
export async function uploadVehiclePhoto(
  ctx: OperationContext,
  rawInput: UploadVehiclePhotoInput,
): Promise<VehiclePhoto> {
  assertCapability(ctx, "inventory:write");

  const input = photoUploadSchema.parse(rawInput);
  const vehicle = await ctx.db.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true } });
  if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");

  const validation = validateUpload({
    fileName: input.fileName,
    declaredMimeType: input.declaredMimeType,
    sizeBytes: input.bytes.byteLength,
    bytes: input.bytes,
    kind: "image",
  });
  if (!validation.ok || !validation.safeExtension) {
    throw new ActionError(validation.error ?? "That image could not be accepted.");
  }

  const key = buildStorageKey({
    scope: "vehicle",
    ownerId: input.vehicleId,
    extension: validation.safeExtension,
  });
  const stored = await saveUploadedFile({ key, bytes: input.bytes });

  const [existingCount, last] = await Promise.all([
    ctx.db.vehiclePhoto.count({ where: { vehicleId: input.vehicleId } }),
    ctx.db.vehiclePhoto.findFirst({
      where: { vehicleId: input.vehicleId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    }),
  ]);

  return ctx.db.vehiclePhoto.create({
    data: {
      vehicleId: input.vehicleId,
      url: stored.url,
      storagePath: stored.key,
      alt: input.alt ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      isPrimary: existingCount === 0,
    },
  });
}

/** Capability: `inventory:write`. */
export async function deleteVehiclePhoto(ctx: OperationContext, photoId: string): Promise<void> {
  assertCapability(ctx, "inventory:write");

  const id = recordIdSchema.parse(photoId);
  const photo = await ctx.db.vehiclePhoto.findUnique({ where: { id }, select: { id: true, vehicleId: true } });
  if (!photo) throw new NotFoundError("That photo no longer exists.");

  await ctx.db.vehiclePhoto.delete({ where: { id } });
}

/**
 * Makes one photo the primary image, atomically clearing the previous one.
 *
 * Capability: `inventory:write`.
 */
export async function setPrimaryVehiclePhoto(
  ctx: OperationContext,
  photoId: string,
): Promise<VehiclePhoto> {
  assertCapability(ctx, "inventory:write");

  const id = recordIdSchema.parse(photoId);
  const photo = await ctx.db.vehiclePhoto.findUnique({ where: { id } });
  if (!photo) throw new NotFoundError("That photo no longer exists.");

  return ctx.db.$transaction(async (tx) => {
    await tx.vehiclePhoto.updateMany({
      where: { vehicleId: photo.vehicleId, isPrimary: true },
      data: { isPrimary: false },
    });
    return tx.vehiclePhoto.update({ where: { id }, data: { isPrimary: true } });
  });
}

export type { Vehicle, VehiclePhoto, VehicleReconItem, Expense };
