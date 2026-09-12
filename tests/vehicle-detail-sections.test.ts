import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, UserRole } from "@/generated/prisma";
import { NotFoundError } from "@/lib/domain-errors";
import {
  getVehicleDetail,
  type OperationContext,
  type VehicleDetailSection,
} from "@/lib/operations";

/**
 * CARS — the vehicle-detail read is driven by the ACTIVE TAB.
 *
 * WHAT THIS FILE PINS
 * `src/app/(operator)/cars/[vehicleId]/page.tsx` renders ONE URL-driven tab at a
 * time (`?tab=overview|economics|recon|expenses|photos|deal|documents|history`).
 * Before this phase every tab ran the same read: the vehicle, the economics
 * inputs, the photos, the status events AND the full recon and expense rows — so
 * a role that could see spend paid for recon and expense data TWICE (once as
 * economics inputs, once as rows), and the live deal was read on tabs that never
 * render it.
 *
 * Every expectation below is a QUERY SHAPE — which model is asked for, with
 * which arguments, and how many times — and never a duration. The fake Prisma
 * client RECORDS calls and returns fixture rows, so a read that queries more than
 * its tab needs still resolves and fails on the call assertion rather than by
 * accident.
 *
 * The four relation models are deliberately given DIFFERENT `_count` values than
 * the number of fixture ROWS, because the tab badges must come from `_count`:
 * a badge that fell back to loading rows would return the row count, and these
 * tests would catch it.
 */

const VEHICLE_ID = "veh_1";
const ACQUIRED_ON = new Date(Date.UTC(2026, 0, 1));

/** The acquisition block, so the landed-cost expectations below are checkable. */
const ACQUISITION_TOTAL_CENTS = 1_450_000 + 45_000 + 32_000 + 9_500 + 5_000; // 1_541_500
const RECON_TOTAL_CENTS = 120_000 + 45_000; // estimate when actual is unrecorded, else actual
const EXPENSE_TOTAL_CENTS = 20_000 + 15_000;
const LANDED_COST_CENTS = ACQUISITION_TOTAL_CENTS + RECON_TOTAL_CENTS + EXPENSE_TOTAL_CENTS;

/**
 * A vehicle row carrying every column the view reads, plus the `_count` the
 * badges are built from. The fake client is untyped on purpose: what is being
 * pinned is the QUERY, and Prisma already owns row typing.
 */
const VEHICLE_ROW = {
  id: VEHICLE_ID,
  vin: "1HGCM82633A004352",
  stockNumber: "SN-TEST0001",
  year: 2019,
  make: "Toyota",
  model: "Camry",
  trim: "SE",
  mileage: 68_000,
  exteriorColor: "Silver",
  interiorColor: "Black",
  transmission: "Automatic",
  drivetrain: "FWD",
  engine: "2.5L I4",
  fuelType: "Gasoline",
  bodyType: "Sedan",
  doors: 4,
  seats: 5,
  titleStatus: "CLEAN",
  status: "READY",
  listingStatus: "UNLISTED",
  dataOrigin: "REAL",
  location: "Lot A",
  notes: "Internal note",
  description: "Public description",
  features: ["Backup camera"],
  acquisitionSource: "AUCTION",
  acquisitionDate: ACQUIRED_ON,
  acquisitionPriceCents: 1_450_000,
  auctionFeesCents: 45_000,
  transportationCents: 32_000,
  inspectionCents: 9_500,
  otherAcquisitionCents: 5_000,
  reconOverrideCents: null,
  targetRetailPriceCents: 1_999_500,
  askingPriceCents: 1_899_500,
  minimumApprovedCents: 1_750_000,
  dateListed: null,
  dateSold: null,
  finalSalePriceCents: null,
  trackerDeviceId: "TRK-9001",
  trackerStatus: "ONLINE",
  trackerLastLatitude: 29.7604,
  trackerLastLongitude: -95.3698,
  trackerLastSeenAt: new Date(Date.UTC(2026, 2, 1)),
  trackerGeofenceState: "ON_LOT",
  createdAt: ACQUIRED_ON,
  updatedAt: ACQUIRED_ON,
  // Badge counts. One photo row, two recon rows and two expense rows exist in the
  // fixtures, so a badge that counted ROWS could not produce these numbers.
  _count: { photos: 7, reconItems: 3, expenses: 5 },
};

const PHOTO_ROWS = [{ id: "photo_1", url: "https://cdn.test/1.jpg", isPrimary: true }];
const RECON_ROWS = [
  { id: "recon_1", estimateCents: 120_000, actualCostCents: null },
  { id: "recon_2", estimateCents: 40_000, actualCostCents: 45_000 },
];
const EXPENSE_ROWS = [{ id: "exp_1", amountCents: 20_000 }, { id: "exp_2", amountCents: 15_000 }];
const STATUS_EVENT_ROWS = [
  { id: "evt_1", fromStatus: null, toStatus: "ACQUIRED", note: null, createdAt: ACQUIRED_ON },
  { id: "evt_2", fromStatus: "ACQUIRED", toStatus: "READY", note: "Ready", createdAt: ACQUIRED_ON },
];

/** The Prisma argument object the operation under test actually builds. */
interface QueryArgs {
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
  orderBy?: unknown;
}

function modelMock() {
  return {
    findUnique: vi.fn(async (_args?: QueryArgs): Promise<unknown> => null),
    findMany: vi.fn(async (_args?: QueryArgs): Promise<unknown[]> => []),
  };
}

/**
 * A Prisma stand-in that RECORDS every call and answers with fixture rows, so a
 * read that queries one model too many still succeeds and fails loudly on the
 * call assertion instead of on an unrelated error.
 */
function fakeDb(options: { vehicle?: unknown } = {}) {
  const db = {
    vehicle: modelMock(),
    vehiclePhoto: modelMock(),
    vehicleReconItem: modelMock(),
    expense: modelMock(),
    vehicleStatusEvent: modelMock(),
  };

  db.vehicle.findUnique.mockResolvedValue(
    options.vehicle === undefined ? VEHICLE_ROW : options.vehicle,
  );
  db.vehiclePhoto.findMany.mockResolvedValue(PHOTO_ROWS);
  db.vehicleReconItem.findMany.mockResolvedValue(RECON_ROWS);
  db.expense.findMany.mockResolvedValue(EXPENSE_ROWS);
  db.vehicleStatusEvent.findMany.mockResolvedValue(STATUS_EVENT_ROWS);

  return db;
}

type FakeDb = ReturnType<typeof fakeDb>;

function contextFor(db: FakeDb, role: UserRole = "OWNER"): OperationContext {
  return {
    actor: { id: "staff_1", email: "staff@dealer.test", name: "Staff", role },
    db: db as unknown as PrismaClient,
  };
}

/** Run the read for a tab-shaped caller: `sections` is the whole contract. */
async function read(
  role: UserRole,
  sections: readonly VehicleDetailSection[],
): Promise<{ db: FakeDb; detail: Awaited<ReturnType<typeof getVehicleDetail>> }> {
  const db = fakeDb();
  const detail = await getVehicleDetail(contextFor(db, role), VEHICLE_ID, { sections });
  return { db, detail };
}

/** Run the read with NO options — the pre-tab call shape. */
async function readDefault(role: UserRole = "OWNER") {
  const db = fakeDb();
  const detail = await getVehicleDetail(contextFor(db, role), VEHICLE_ID);
  return { db, detail };
}

const RELATION_MODELS = [
  "vehiclePhoto",
  "vehicleReconItem",
  "expense",
  "vehicleStatusEvent",
] as const;

type RelationModel = (typeof RELATION_MODELS)[number];

/** The relation models whose ROWS were loaded, in a stable order. */
function rowsRead(db: FakeDb): RelationModel[] {
  return RELATION_MODELS.filter((model) => db[model].findMany.mock.calls.length > 0);
}

function timesRead(db: FakeDb, model: RelationModel): number {
  return db[model].findMany.mock.calls.length;
}

type CallRecorder = { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } };

/** The arguments of the FIRST call to a query mock. */
function argsOf(mock: CallRecorder): QueryArgs {
  return (mock.mock.calls[0]?.[0] ?? {}) as QueryArgs;
}

/** The `_count` relations the vehicle statement asked Prisma to count. */
function countedRelations(db: FakeDb): string[] {
  const include = argsOf(db.vehicle.findUnique).include as
    | { _count?: { select?: Record<string, boolean> } }
    | undefined;
  return Object.keys(include?._count?.select ?? {}).sort();
}

function expectNoRelationRows(db: FakeDb, why: string): void {
  for (const model of RELATION_MODELS) {
    expect(db[model].findMany, `${model}.findMany must not be called ${why}`).not.toHaveBeenCalled();
  }
}

/* -------------------------------------------------------------------------- */
/* A. The core read — identity, lifecycle and badge counts, and nothing else   */
/* -------------------------------------------------------------------------- */

describe("CARS — the core read loads no relation rows", () => {
  it("reads NOTHING but the vehicle row when no section is requested", async () => {
    const { db, detail } = await read("OWNER", []);

    expectNoRelationRows(db, "for the core read");
    expect(db.vehicle.findUnique).toHaveBeenCalledTimes(1);
    expect(detail.vehicle.id).toBe(VEHICLE_ID);
    expect(detail.publiclyVisible).toBe(false);

    // A section that was not requested is ABSENT, never an empty list pretending
    // to be "none recorded".
    expect(detail.reconItems).toBeUndefined();
    expect(detail.expenses).toBeUndefined();
    expect(detail.photos).toEqual([]);
    expect(detail.statusEvents).toEqual([]);
  });

  it("takes every tab badge from `_count`, not from loading rows", async () => {
    const { db, detail } = await read("OWNER", []);

    expect(countedRelations(db)).toEqual(["expenses", "photos", "reconItems"]);
    // 7 / 3 / 5 come from `_count`; the fixtures hold 1 / 2 / 2 ROWS and were
    // never queried, so a badge built from rows could not produce these numbers.
    expect(detail.counts).toEqual({ photos: 7, reconItems: 3, expenses: 5 });
    expectNoRelationRows(db, "when the badges are counted");
  });

  it("never leaks the `_count` block into the vehicle payload", async () => {
    const { detail } = await read("OWNER", []);

    expect(detail.vehicle).not.toHaveProperty("_count");
    expect(detail.vehicle.askingPriceCents).toBe(1_899_500);
  });

  it("withholds cost-derived figures instead of computing them from no inputs", async () => {
    const { detail } = await read("OWNER", ["photos"]);

    // A landed cost computed from an empty recon/expense set would be the
    // acquisition block alone: a fabricated number. It is withheld instead.
    for (const field of [
      "landedCostCents",
      "estimatedGrossProfitCents",
      "actualGrossProfitCents",
      "expectedProfitCents",
      "estimatedRoiBasisPoints",
      "actualRoiBasisPoints",
      "frontEndMarginCents",
      "landedCost",
    ] as const) {
      expect(detail.vehicle[field], `${field} must be withheld, not guessed`).toBeNull();
    }
    expect(detail.vehicle.landedCostCents).not.toBe(ACQUISITION_TOTAL_CENTS);

    // Everything that comes from the vehicle row itself stays exact.
    expect(detail.vehicle.acquisitionPriceCents).toBe(1_450_000);
    expect(detail.vehicle.askingPriceCents).toBe(1_899_500);
    expect(detail.vehicle.minimumApprovedCents).toBe(1_750_000);
    expect(detail.vehicle.negotiatingRoomCents).toBe(149_500);
    expect(detail.vehicle.expectedSalePriceCents).toBe(1_999_500);
    expect(detail.vehicle.daysInInventory).not.toBeNull();
    expect(detail.vehicle.isSold).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* B. One section at a time — the tab drives the read                          */
/* -------------------------------------------------------------------------- */

describe("CARS — a requested section reads its own model and nothing else", () => {
  it("`photos` reads the gallery, and NOT expenses, recon or history", async () => {
    const { db, detail } = await read("OWNER", ["photos"]);

    expect(rowsRead(db)).toEqual(["vehiclePhoto"]);
    expect(timesRead(db, "vehiclePhoto")).toBe(1);
    expect(detail.photos).toEqual(PHOTO_ROWS);
    expect(detail.expenses).toBeUndefined();
    expect(detail.reconItems).toBeUndefined();
    expect(detail.statusEvents).toEqual([]);
    expect(detail.counts).toEqual({ photos: 7, reconItems: 3, expenses: 5 });
  });

  it("`expenses` reads the expense rows, and NOT photos, recon or history", async () => {
    const { db, detail } = await read("OWNER", ["expenses"]);

    expect(rowsRead(db)).toEqual(["expense"]);
    expect(timesRead(db, "expense")).toBe(1);
    expect(detail.expenses).toEqual(EXPENSE_ROWS);
    expect(detail.reconItems).toBeUndefined();
    expect(detail.photos).toEqual([]);
    expect(detail.statusEvents).toEqual([]);
    // The tab badge still comes from `_count` (5), not from the 2 rows loaded.
    expect(detail.counts.expenses).toBe(5);
  });

  it("`history` reads the status events, and NOT photos or expenses", async () => {
    const { db, detail } = await read("OWNER", ["history"]);

    expect(rowsRead(db)).toEqual(["vehicleStatusEvent"]);
    expect(detail.statusEvents).toEqual(STATUS_EVENT_ROWS);
    expect(detail.photos).toEqual([]);
    expect(detail.expenses).toBeUndefined();
    expect(detail.reconItems).toBeUndefined();
  });

  it("`recon` reads the recon rows ONCE, and NOT photos or expenses", async () => {
    const { db, detail } = await read("OWNER", ["recon"]);

    expect(rowsRead(db)).toEqual(["vehicleReconItem"]);
    // ONCE: the full rows double as the economics inputs, so the tab that lists
    // recon items does not also pay for a second, narrower recon query.
    expect(timesRead(db, "vehicleReconItem")).toBe(1);
    expect(detail.reconItems).toEqual(RECON_ROWS);
    expect(detail.photos).toEqual([]);
    expect(detail.expenses).toBeUndefined();
    expect(detail.statusEvents).toEqual([]);
    expect(detail.counts.reconItems).toBe(3);
  });

  it("`economics` reads the cost inputs as COLUMNS, never as rows", async () => {
    const { db, detail } = await read("OWNER", ["economics"]);

    expect(rowsRead(db)).toEqual(["vehicleReconItem", "expense"]);
    expect(argsOf(db.vehicleReconItem.findMany).select).toEqual({
      estimateCents: true,
      actualCostCents: true,
    });
    expect(argsOf(db.expense.findMany).select).toEqual({ amountCents: true });
    // A narrow input read is not a row list: no ordering, no full row, and the
    // rows never reach the payload.
    expect(argsOf(db.vehicleReconItem.findMany).orderBy).toBeUndefined();
    expect(argsOf(db.expense.findMany).orderBy).toBeUndefined();
    expect(detail.reconItems).toBeUndefined();
    expect(detail.expenses).toBeUndefined();
    expect(db.vehiclePhoto.findMany).not.toHaveBeenCalled();
    expect(db.vehicleStatusEvent.findMany).not.toHaveBeenCalled();

    // The money is the canonical engine's, on the canonical inputs.
    expect(detail.vehicle.landedCostCents).toBe(LANDED_COST_CENTS);
    expect(detail.vehicle.landedCost?.reconCents).toBe(RECON_TOTAL_CENTS);
    expect(detail.vehicle.landedCost?.additionalExpenseCents).toBe(EXPENSE_TOTAL_CENTS);
    expect(detail.vehicle.landedCost?.reconSource).toBe("recon-items");
    expect(detail.vehicle.estimatedGrossProfitCents).toBe(1_999_500 - LANDED_COST_CENTS);
  });

  it("keeps the row ordering each section always used", async () => {
    const { db } = await read("OWNER", ["photos", "expenses", "recon", "history"]);

    expect(argsOf(db.vehiclePhoto.findMany).orderBy).toEqual([
      { sortOrder: "asc" },
      { createdAt: "asc" },
    ]);
    expect(argsOf(db.expense.findMany).orderBy).toEqual({ incurredOn: "desc" });
    expect(argsOf(db.vehicleReconItem.findMany).orderBy).toEqual({ createdAt: "asc" });
    expect(argsOf(db.vehicleStatusEvent.findMany).orderBy).toEqual({ createdAt: "desc" });
  });
});

/* -------------------------------------------------------------------------- */
/* C. The default is every section, and no model is ever read twice            */
/* -------------------------------------------------------------------------- */

describe("CARS — the pre-tab default read is unchanged, minus the double fetch", () => {
  it("reads every section when no section list is given", async () => {
    const { db } = await readDefault("OWNER");

    expect([...rowsRead(db)].sort()).toEqual([...RELATION_MODELS].sort());
  });

  it("queries each model EXACTLY ONCE — the double fetch is gone", async () => {
    const { db, detail } = await readDefault("OWNER");

    for (const model of RELATION_MODELS) {
      expect(timesRead(db, model), `${model} must be read once, not twice`).toBe(1);
    }
    // The full rows are the economics inputs, and the cost basis is still exact.
    expect(detail.vehicle.landedCostCents).toBe(LANDED_COST_CENTS);
    expect(detail.reconItems).toEqual(RECON_ROWS);
    expect(detail.expenses).toEqual(EXPENSE_ROWS);
    expect(detail.photos).toEqual(PHOTO_ROWS);
    expect(detail.statusEvents).toEqual(STATUS_EVENT_ROWS);
  });
});

/* -------------------------------------------------------------------------- */
/* D. Security — a section can never widen what a role receives                */
/* -------------------------------------------------------------------------- */

describe("CARS — requesting a section never bypasses a capability", () => {
  it("SALES asking for `recon` and `expenses` queries NEITHER model", async () => {
    // SALES holds inventory:read but neither recon:write nor expenses:read.
    const { db, detail } = await read("SALES", ["recon", "expenses"]);

    expect(db.vehicleReconItem.findMany).not.toHaveBeenCalled();
    expect(db.expense.findMany).not.toHaveBeenCalled();
    expect(rowsRead(db)).toEqual([]);

    expect(detail.reconItems).toBeUndefined();
    expect(detail.expenses).toBeUndefined();
    // A badge is data too: an invisible section has no count.
    expect(detail.counts.reconItems).toBeUndefined();
    expect(detail.counts.expenses).toBeUndefined();
    // Photos are not capability-gated, so that count is always real.
    expect(detail.counts.photos).toBe(7);
  });

  it("SALES asking for `economics` gets no cost figure back", async () => {
    const { detail } = await read("SALES", ["economics"]);

    // The inputs are read server-side, but SALES holds no `finance:read`, so
    // every cost-derived figure is masked to null — never a real number, and
    // never a fabricated one.
    expect(detail.vehicle.landedCostCents).toBeNull();
    expect(detail.vehicle.landedCost).toBeNull();
    expect(detail.vehicle.acquisitionPriceCents).toBeNull();
    expect(detail.vehicle.estimatedGrossProfitCents).toBeNull();
    expect(detail.vehicle.negotiatingRoomCents).toBeNull();
    expect(detail.vehicle.minimumApprovedCents).toBeNull();
    // ...while what a salesperson needs to quote the car survives.
    expect(detail.vehicle.askingPriceCents).toBe(1_899_500);
    expect(detail.vehicle.targetRetailPriceCents).toBe(1_999_500);
    // Tracker data stays behind `tracker:read`.
    expect(detail.vehicle.trackerDeviceId).toBeNull();
    expect(detail.vehicle.trackerLastLatitude).toBeNull();
  });

  it("RECON sees the spend it recorded and still cannot see the cost basis", async () => {
    const { db, detail } = await read("RECON", ["expenses"]);

    expect(rowsRead(db)).toEqual(["expense"]);
    expect(detail.expenses).toEqual(EXPENSE_ROWS);
    expect(detail.counts.expenses).toBe(5);
    expect(detail.vehicle.acquisitionPriceCents).toBeNull();
    expect(detail.vehicle.landedCostCents).toBeNull();
  });

  it("masks the cost basis for VIEWER on the default read too", async () => {
    const { detail } = await readDefault("VIEWER");

    expect(detail.vehicle.mileage).toBe(68_000);
    expect(detail.vehicle.landedCostCents).toBeNull();
    expect(detail.vehicle.actualRoiBasisPoints).toBeNull();
    expect(detail.vehicle.acquisitionPriceCents).toBeNull();
    // VIEWER may read deals but not spend or recon.
    expect(detail.expenses).toBeUndefined();
    expect(detail.reconItems).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* E. Failure paths                                                            */
/* -------------------------------------------------------------------------- */

describe("CARS — the section list changes nothing about failure handling", () => {
  it("still reports a missing vehicle as not found, with no relation reads", async () => {
    const db = fakeDb({ vehicle: null });

    await expect(
      getVehicleDetail(contextFor(db), VEHICLE_ID, { sections: [] }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expectNoRelationRows(db, "for a vehicle that does not exist");
  });
});
