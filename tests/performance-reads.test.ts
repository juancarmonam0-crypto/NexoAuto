import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, UserRole } from "@/generated/prisma";
import { AuthorizationError } from "@/lib/auth/errors";
import { hasCapability } from "@/lib/auth/roles";
import {
  MAX_BATCH_DEAL_VEHICLES,
  MAX_INVENTORY_OPTIONS,
  countInventory,
  getLiveDealForVehicle,
  getLiveDealsForVehicles,
  listInventory,
  listInventoryOptions,
  type OperationContext,
} from "@/lib/operations";

/**
 * PERFORMANCE ARCHITECTURE — WHICH models a read queries, and HOW MANY times.
 *
 * This file pins the SHAPE of three hardened reads, never their speed:
 *
 *   1. `getLiveDealsForVehicles()` — the /sales N+1 is gone. One bounded
 *      `deal.findMany` replaces one `deal.findFirst` per vehicle, and the query
 *      count must not grow with the size of the inventory.
 *   2. `listInventoryOptions()` — a real column projection (an explicit
 *      `select`), not a full inventory load with economics.
 *   3. `countInventory()` — a badge is a COUNT: it must never load a row.
 *
 * The contrast case is included too: `listInventory()` is the HEAVY read and
 * must still ask for the economics relations, so the difference between the
 * light and the heavy read is documented in one place.
 *
 * NO TIMING IS ASSERTED ANYWHERE. Every expectation is a call count or an
 * argument, which is deterministic on any machine and cannot flake. The fake
 * Prisma client RECORDS calls instead of executing them, in the style the rest
 * of `tests/operations-*.test.ts` already uses for injected databases.
 */

const ALL_ROLES: UserRole[] = ["OWNER", "MANAGER", "SALES", "RECON", "VIEWER"];

function actorFor(role: UserRole) {
  return { id: "staff_1", email: "staff@dealer.test", name: "Staff", role };
}

/** The Prisma argument object the operations under test actually build. */
interface QueryArgs {
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
  skip?: number;
}

function modelMock() {
  return {
    findMany: vi.fn(async (_args?: QueryArgs): Promise<unknown[]> => []),
    findFirst: vi.fn(async (_args?: QueryArgs): Promise<unknown> => null),
    findUnique: vi.fn(async (_args?: QueryArgs): Promise<unknown> => null),
    count: vi.fn(async (_args?: QueryArgs): Promise<number> => 0),
    create: vi.fn(async (_args?: QueryArgs): Promise<unknown> => ({})),
    update: vi.fn(async (_args?: QueryArgs): Promise<unknown> => ({})),
    updateMany: vi.fn(async (_args?: QueryArgs): Promise<unknown> => ({ count: 0 })),
    delete: vi.fn(async (_args?: QueryArgs): Promise<unknown> => ({})),
  };
}

type FakeModel = ReturnType<typeof modelMock>;

/**
 * A Prisma stand-in that RECORDS every call. It returns empty, safe values, so
 * an operation that queries MORE than it should still succeeds — and the test
 * fails on the call count rather than on an accident.
 */
function fakeDb() {
  return {
    vehicle: modelMock(),
    deal: modelMock(),
    vehicleReconItem: modelMock(),
    expense: modelMock(),
    vehiclePhoto: modelMock(),
    vehicleStatusEvent: modelMock(),
  };
}

type FakeDb = ReturnType<typeof fakeDb>;

function contextFor(db: FakeDb, role: UserRole = "OWNER"): OperationContext {
  return { actor: actorFor(role), db: db as unknown as PrismaClient };
}

type CallRecorder = { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } };

/** The arguments of the FIRST call to a query mock. */
function argsOf(mock: CallRecorder): QueryArgs {
  return (mock.mock.calls[0]?.[0] ?? {}) as QueryArgs;
}

const QUERY_METHODS = [
  "findMany",
  "findFirst",
  "findUnique",
  "count",
  "create",
  "update",
  "updateMany",
  "delete",
] as const;

/** Models a lightweight read has no business touching at all. */
const RELATION_MODELS = ["vehicleReconItem", "expense", "vehiclePhoto", "vehicleStatusEvent"] as const;

function expectRelationModelsUntouched(db: FakeDb): void {
  for (const model of RELATION_MODELS) {
    for (const method of QUERY_METHODS) {
      expect(db[model][method], `${model}.${method} must not be called`).not.toHaveBeenCalled();
    }
  }
}

function vehicleIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `veh_${index + 1}`);
}

/** The `vehicleId: { in: [...] }` list a deal query actually asked for. */
function dealIdsIn(args: QueryArgs): string[] {
  const where = args.where as { vehicleId?: { in?: string[] } } | undefined;
  return where?.vehicleId?.in ?? [];
}

const DEAD_DEAL_STATUSES = ["CANCELLED", "LOST"];

/**
 * One deal row, carrying every column `DealTermsView` reads. The fake database
 * is untyped on purpose: what is being pinned is the QUERY, not Prisma's row
 * typing, which the generated client already owns.
 */
function dealRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "deal_1",
    vehicleId: "veh_1",
    status: "CONTRACTED",
    customerId: "cust_1",
    customer: { firstName: "Ana", lastName: "Ramirez" },
    leadId: null,
    salespersonId: "staff_1",
    financeType: "FINANCE",
    lenderName: "First National",
    askingPriceCents: 1_899_500,
    negotiatedPriceCents: null,
    salePriceCents: 1_850_000,
    dealerFeesCents: 29_900,
    salesTaxCents: 120_000,
    tradeInAllowanceCents: null,
    tradeInPayoffCents: null,
    downPaymentCents: 200_000,
    amountFinancedCents: 1_600_000,
    aprBasisPoints: 750,
    termMonths: 60,
    paymentFrequency: "MONTHLY",
    numberOfPayments: 60,
    paymentAmountCents: 32_000,
    finalPaymentCents: 32_000,
    firstPaymentDate: new Date(Date.UTC(2026, 3, 1)),
    financeChargeCents: 320_000,
    totalOfPaymentsCents: 1_920_000,
    remainingBalanceCents: 1_600_000,
    capitalizedCostCents: null,
    capCostReductionCents: null,
    residualValueCents: null,
    moneyFactorAprBasisPoints: null,
    purchaseOptionCents: null,
    ratePolicyId: null,
    ratePolicyCeilingBasisPoints: null,
    ratePolicyEvaluatedAt: null,
    titleWorkStatus: "PENDING",
    registrationStatus: "PENDING",
    officialNotes: null,
    saleDate: new Date(Date.UTC(2026, 2, 20)),
    deliveryDate: null,
    notes: null,
    createdAt: new Date(Date.UTC(2026, 2, 20)),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* A. getLiveDealsForVehicles — the /sales N+1 is gone                         */
/* -------------------------------------------------------------------------- */

describe("SALES — getLiveDealsForVehicles is ONE bounded batch read", () => {
  /** A database that answers the batch query with one live deal per vehicle. */
  function dbWithOneDealPerVehicle(): FakeDb {
    const db = fakeDb();
    db.deal.findMany.mockImplementation(async (args) => {
      return dealIdsIn(args ?? {}).map((vehicleId) =>
        dealRow({ id: `deal_${vehicleId}`, vehicleId }),
      );
    });
    return db;
  }

  it("reads 100 vehicles with ONE findMany keyed by exactly those 100 ids", async () => {
    const ids = vehicleIds(100);
    const db = dbWithOneDealPerVehicle();

    const views = await getLiveDealsForVehicles(contextFor(db), ids);

    expect(db.deal.findMany).toHaveBeenCalledTimes(1);
    expect(argsOf(db.deal.findMany).where).toEqual({
      vehicleId: { in: ids },
      status: { notIn: DEAD_DEAL_STATUSES },
    });
    expect(dealIdsIn(argsOf(db.deal.findMany))).toHaveLength(100);
    expect(views).toHaveLength(100);
    expect(views.map((view) => view.vehicleId)).toEqual(ids);
  });

  it("NEVER calls deal.findFirst — the per-vehicle read the old page looped over", async () => {
    const db = dbWithOneDealPerVehicle();

    await getLiveDealsForVehicles(contextFor(db), vehicleIds(100));

    // THE CORE REGRESSION: a batch read that falls back to findFirst is the N+1
    // wearing a new name.
    expect(db.deal.findFirst).not.toHaveBeenCalled();
    expect(db.deal.findUnique).not.toHaveBeenCalled();
  });

  it("does not grow its query count with the number of vehicles", async () => {
    const forOne = dbWithOneDealPerVehicle();
    const forHundred = dbWithOneDealPerVehicle();

    const one = await getLiveDealsForVehicles(contextFor(forOne), vehicleIds(1));
    const hundred = await getLiveDealsForVehicles(contextFor(forHundred), vehicleIds(100));

    expect(forOne.deal.findMany).toHaveBeenCalledTimes(1);
    expect(forHundred.deal.findMany).toHaveBeenCalledTimes(1);
    // Counts, never timings: 1 vehicle and 100 vehicles cost the same ONE query.
    expect(forHundred.deal.findMany.mock.calls.length).toBe(forOne.deal.findMany.mock.calls.length);
    expect(one).toHaveLength(1);
    expect(hundred).toHaveLength(100);
  });

  it("documents the N+1 the batch read replaces: the loop costs one query per vehicle", async () => {
    const ids = vehicleIds(100);

    const looped = fakeDb();
    looped.deal.findFirst.mockResolvedValue(dealRow());
    for (const id of ids) await getLiveDealForVehicle(contextFor(looped), id);

    const batched = dbWithOneDealPerVehicle();
    await getLiveDealsForVehicles(contextFor(batched), ids);

    expect(looped.deal.findFirst).toHaveBeenCalledTimes(100);
    expect(looped.deal.findMany).not.toHaveBeenCalled();
    expect(batched.deal.findFirst).not.toHaveBeenCalled();
    expect(batched.deal.findMany).toHaveBeenCalledTimes(1);
  });

  it("collapses a repeated vehicle id into one query and one view", async () => {
    const db = dbWithOneDealPerVehicle();

    const views = await getLiveDealsForVehicles(contextFor(db), ["veh_1", "veh_1"]);

    expect(db.deal.findMany).toHaveBeenCalledTimes(1);
    expect(dealIdsIn(argsOf(db.deal.findMany))).toEqual(["veh_1"]);
    expect(views).toHaveLength(1);
    expect(views[0].vehicleId).toBe("veh_1");
  });

  it("truncates a request beyond MAX_BATCH_DEAL_VEHICLES to the bound", async () => {
    const db = dbWithOneDealPerVehicle();
    const ids = vehicleIds(MAX_BATCH_DEAL_VEHICLES + 50);

    await getLiveDealsForVehicles(contextFor(db), ids);

    const asked = dealIdsIn(argsOf(db.deal.findMany));
    expect(asked).toHaveLength(MAX_BATCH_DEAL_VEHICLES);
    expect(asked).toEqual(ids.slice(0, MAX_BATCH_DEAL_VEHICLES));
  });

  it("issues NO query at all for an empty list", async () => {
    const db = fakeDb();

    const views = await getLiveDealsForVehicles(contextFor(db), []);

    expect(views).toEqual([]);
    expect(db.deal.findMany).not.toHaveBeenCalled();
    expect(db.deal.findFirst).not.toHaveBeenCalled();
  });

  it("returns the NEWEST live deal when history holds two for one vehicle", async () => {
    const db = fakeDb();
    const newest = dealRow({
      id: "deal_newest",
      vehicleId: "veh_1",
      salePriceCents: 1_950_000,
      createdAt: new Date(Date.UTC(2026, 2, 2)),
    });
    const older = dealRow({
      id: "deal_older",
      vehicleId: "veh_1",
      salePriceCents: 1_500_000,
      createdAt: new Date(Date.UTC(2026, 1, 2)),
    });
    // The real query is `orderBy: { createdAt: "desc" }`, so the database hands
    // the newest row back FIRST and the first row per vehicle wins.
    db.deal.findMany.mockResolvedValue([newest, older]);

    const views = await getLiveDealsForVehicles(contextFor(db), ["veh_1"]);

    expect(argsOf(db.deal.findMany).orderBy).toEqual({ createdAt: "desc" });
    expect(views).toHaveLength(1);
    expect(views[0].dealId).toBe("deal_newest");
    expect(views[0].salePriceCents).toBe(1_950_000);
  });

  it("returns exactly the view the single-vehicle read returns, terms included", async () => {
    const row = dealRow();

    const single = fakeDb();
    single.deal.findFirst.mockResolvedValue(row);
    const viaSingle = await getLiveDealForVehicle(contextFor(single), "veh_1");

    const batch = fakeDb();
    batch.deal.findMany.mockResolvedValue([row]);
    const [viaBatch] = await getLiveDealsForVehicles(contextFor(batch), ["veh_1"]);

    // One mapping, one shape: the batch read cannot drift from the single read.
    expect(viaSingle).not.toBeNull();
    expect(viaBatch).toEqual(viaSingle);
    expect(viaBatch.vehicleId).toBe("veh_1");
    expect(viaBatch.dealId).toBe("deal_1");
    expect(viaBatch.customerName).toBe("Ana Ramirez");
    expect(viaBatch).toMatchObject({
      status: "CONTRACTED",
      financeType: "FINANCE",
      lenderName: "First National",
      askingPriceCents: 1_899_500,
      salePriceCents: 1_850_000,
      dealerFeesCents: 29_900,
      salesTaxCents: 120_000,
      downPaymentCents: 200_000,
      amountFinancedCents: 1_600_000,
      aprBasisPoints: 750,
      termMonths: 60,
      paymentFrequency: "MONTHLY",
      numberOfPayments: 60,
      paymentAmountCents: 32_000,
      finalPaymentCents: 32_000,
      financeChargeCents: 320_000,
      totalOfPaymentsCents: 1_920_000,
      remainingBalanceCents: 1_600_000,
      firstPaymentDateIso: "2026-04-01T00:00:00.000Z",
      saleDateIso: "2026-03-20T00:00:00.000Z",
      createdAtIso: "2026-03-20T00:00:00.000Z",
      titleWorkStatus: "PENDING",
      registrationStatus: "PENDING",
      leadId: null,
      officialNotes: null,
      notes: null,
    });
  });

  it("builds customerName from the joined customer's first and last name", async () => {
    const db = fakeDb();
    db.deal.findMany.mockResolvedValue([dealRow({ customer: { firstName: "Ana", lastName: null } })]);

    const [view] = await getLiveDealsForVehicles(contextFor(db), ["veh_1"]);

    expect(view.customerName).toBe("Ana");
    expect(argsOf(db.deal.findMany).include).toEqual({
      customer: { select: { firstName: true, lastName: true } },
    });
  });

  it("drops ids that are not valid record ids before querying", async () => {
    const db = dbWithOneDealPerVehicle();

    await getLiveDealsForVehicles(contextFor(db), ["veh_1", "", "   "]);

    expect(dealIdsIn(argsOf(db.deal.findMany))).toEqual(["veh_1"]);
  });

  it("refuses a role without deals:read exactly as the single read does, with NO query", async () => {
    // RECON holds inventory:read and inventory:write but NOT deals:read.
    expect(hasCapability("RECON", "deals:read")).toBe(false);

    const batch = fakeDb();
    await expect(getLiveDealsForVehicles(contextFor(batch, "RECON"), ["veh_1"])).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(batch.deal.findMany).not.toHaveBeenCalled();
    expect(batch.deal.findFirst).not.toHaveBeenCalled();

    const single = fakeDb();
    await expect(getLiveDealForVehicle(contextFor(single, "RECON"), "veh_1")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(single.deal.findFirst).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* B. listInventoryOptions — a projection, not an inventory load               */
/* -------------------------------------------------------------------------- */

const OPTION_COLUMNS = [
  "id",
  "year",
  "make",
  "model",
  "trim",
  "stockNumber",
  "status",
  "listingStatus",
  "askingPriceCents",
] as const;

/** Relations the heavy read loads and a label can never need. */
const HEAVY_RELATIONS = ["reconItems", "expenses", "photos", "statusEvents"] as const;

describe("CARS — listInventoryOptions projects columns with ONE query", () => {
  it("selects an explicit allow-list and never uses include", async () => {
    const db = fakeDb();
    db.vehicle.count.mockResolvedValue(3);

    const result = await listInventoryOptions(contextFor(db), { limit: 200 });

    expect(db.vehicle.findMany).toHaveBeenCalledTimes(1);
    const args = argsOf(db.vehicle.findMany);

    expect(args.select, "a projection must use an explicit select").toBeDefined();
    expect(args.include, "a projection must not use include").toBeUndefined();

    const select = args.select ?? {};
    for (const column of OPTION_COLUMNS) {
      expect(select[column], `select.${column} must be requested`).toBe(true);
    }
    for (const relation of HEAVY_RELATIONS) {
      expect(select, `select must not carry ${relation}`).not.toHaveProperty(relation);
    }
    // Columns only: a nested select value would be an accidental relation load.
    for (const [column, value] of Object.entries(select)) {
      expect(value, `select.${column} must be a plain column flag`).toBe(true);
    }

    expect(args.take).toBe(200);
    expect(args.skip).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("touches no other model", async () => {
    const db = fakeDb();

    await listInventoryOptions(contextFor(db), { limit: 50 });

    expectRelationModelsUntouched(db);
    expect(db.vehicle.findUnique).not.toHaveBeenCalled();
    expect(db.vehicle.findFirst).not.toHaveBeenCalled();
  });

  it("counts the total instead of deriving it from the returned page", async () => {
    const db = fakeDb();
    db.vehicle.count.mockResolvedValue(1_234);

    const result = await listInventoryOptions(contextFor(db), { limit: 50 });

    expect(db.vehicle.count).toHaveBeenCalledTimes(1);
    expect(db.vehicle.count).toHaveBeenCalledWith();
    expect(result.total).toBe(1_234);
  });

  it("bounds the page size at MAX_INVENTORY_OPTIONS", async () => {
    const db = fakeDb();

    await listInventoryOptions(contextFor(db), { limit: 10_000 });

    const take = argsOf(db.vehicle.findMany).take as number;
    expect(take).toBeLessThanOrEqual(MAX_INVENTORY_OPTIONS);
    expect(take).toBe(MAX_INVENTORY_OPTIONS);
  });

  it("never asks for a page of zero or a negative page", async () => {
    for (const limit of [0, -5]) {
      const db = fakeDb();
      await listInventoryOptions(contextFor(db), { limit });
      const take = argsOf(db.vehicle.findMany).take as number;
      expect(take, `limit ${limit} must still ask for at least one row`).toBeGreaterThanOrEqual(1);
      expect(take).toBe(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* C. countInventory — a badge must never load rows                           */
/* -------------------------------------------------------------------------- */

describe("CARS — countInventory counts without loading", () => {
  it("issues ONE count with the requested filter and never loads a row", async () => {
    const db = fakeDb();
    db.vehicle.count.mockResolvedValue(42);

    const total = await countInventory(contextFor(db), { listingStatus: "ACTIVE" });

    expect(total).toBe(42);
    expect(db.vehicle.count).toHaveBeenCalledTimes(1);
    expect(argsOf(db.vehicle.count).where).toEqual({ listingStatus: "ACTIVE" });
    expect(db.vehicle.findMany).not.toHaveBeenCalled();
    expect(db.vehicle.findFirst).not.toHaveBeenCalled();
    expect(db.vehicle.findUnique).not.toHaveBeenCalled();
  });

  it("counts everything with an EMPTY where when no filter is given", async () => {
    const db = fakeDb();
    db.vehicle.count.mockResolvedValue(7);

    const total = await countInventory(contextFor(db));

    expect(total).toBe(7);
    expect(db.vehicle.count).toHaveBeenCalledTimes(1);
    const where = argsOf(db.vehicle.count).where;
    expect(where).toEqual({});
    expect(Object.keys(where ?? {})).toHaveLength(0);
    expect(db.vehicle.findMany).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* The inventory:read gate on the two new lightweight reads                    */
/* -------------------------------------------------------------------------- */

/**
 * BUG (spec vs. capability matrix): the task requires proving that a role
 * WITHOUT `inventory:read` is refused by `listInventoryOptions()` and by
 * `countInventory()` before any query runs. No such role exists, so the refusal
 * is not reachable through the real matrix and the two tests below are skipped.
 *
 *   expression: ALL_ROLES.filter((role) => !hasCapability(role, "inventory:read"))
 *   expected:   at least one role that lacks `inventory:read`
 *   actual:     [] — src/lib/auth/roles.ts grants `inventory:read` to OWNER,
 *               MANAGER, SALES, RECON and VIEWER alike
 *
 * The active test that follows PINS that fact, so the skips start failing loudly
 * (as "no longer skipped" documentation) the moment a role without
 * `inventory:read` is added and the refusals become testable.
 */
describe("CARS — the inventory:read gate cannot be exercised by any role", () => {
  it("every role in the matrix holds inventory:read", () => {
    const refusing = ALL_ROLES.filter((role) => !hasCapability(role, "inventory:read"));
    expect(refusing).toEqual([]);
  });

  // BUG: no role lacks `inventory:read`, so this assertion cannot be reached.
  //   expected: `listInventoryOptions` refuses a role without `inventory:read`
  //             with an AuthorizationError and issues NO query
  //   actual:   there is no such role (`refusing` is undefined), so the refusal
  //             branch of assertCapability(ctx, "inventory:read") is dead code
  //             for every value of UserRole
  it.skip("listInventoryOptions refuses a role without inventory:read, with NO query", async () => {
    const refusing = ALL_ROLES.find((role) => !hasCapability(role, "inventory:read"));
    const db = fakeDb();

    await expect(
      listInventoryOptions(contextFor(db, refusing as UserRole), { limit: 10 }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.vehicle.findMany).not.toHaveBeenCalled();
    expect(db.vehicle.count).not.toHaveBeenCalled();
  });

  // BUG: same condition as above — no role lacks `inventory:read`.
  //   expected: `countInventory` refuses a role without `inventory:read` with an
  //             AuthorizationError and issues NO query
  //   actual:   no such role exists in the capability matrix
  it.skip("countInventory refuses a role without inventory:read, with NO query", async () => {
    const refusing = ALL_ROLES.find((role) => !hasCapability(role, "inventory:read"));
    const db = fakeDb();

    await expect(
      countInventory(contextFor(db, refusing as UserRole), { listingStatus: "ACTIVE" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.vehicle.count).not.toHaveBeenCalled();
    expect(db.vehicle.findMany).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* D. listInventory — the heavy contrast case, in the same file                */
/* -------------------------------------------------------------------------- */

describe("CARS — listInventory is still the heavy read", () => {
  it("loads rows WITH the economics include, so the contrast is explicit", async () => {
    const db = fakeDb();
    db.vehicle.count.mockResolvedValue(3);

    const result = await listInventory(contextFor(db), { limit: 10 });

    expect(db.vehicle.findMany).toHaveBeenCalledTimes(1);
    const args = argsOf(db.vehicle.findMany);

    // ECONOMICS_SELECT = { reconItems: { select: … }, expenses: { select: … } }
    expect(args.include).toBeDefined();
    expect(Object.keys(args.include ?? {})).toEqual(expect.arrayContaining(["reconItems", "expenses"]));
    expect(args.include).toMatchObject({
      reconItems: { select: { estimateCents: true, actualCostCents: true } },
      expenses: { select: { amountCents: true } },
    });
    // The heavy read uses include, never the option projection's column select.
    expect(args.select).toBeUndefined();

    expect(args.take).toBe(10);
    expect(args.skip).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(3);
    expect(db.vehicle.count).toHaveBeenCalledTimes(1);
  });

  it("makes the light and heavy reads plainly different in one comparison", async () => {
    const light = fakeDb();
    await listInventoryOptions(contextFor(light), { limit: 10 });

    const heavy = fakeDb();
    await listInventory(contextFor(heavy), { limit: 10 });

    const lightArgs = argsOf(light.vehicle.findMany);
    const heavyArgs = argsOf(heavy.vehicle.findMany);

    // Projection: a select, no relations, no economics query.
    expect(lightArgs.select).toBeDefined();
    expect(lightArgs.include).toBeUndefined();
    // Full view: relations loaded, economics computed per row.
    expect(heavyArgs.include).toBeDefined();
    expect(heavyArgs.select).toBeUndefined();

    // Both are still ONE vehicle query plus ONE count — the difference is what
    // each row costs, not how many round trips the read makes.
    expect(light.vehicle.findMany).toHaveBeenCalledTimes(1);
    expect(light.vehicle.count).toHaveBeenCalledTimes(1);
    expect(heavy.vehicle.findMany).toHaveBeenCalledTimes(1);
    expect(heavy.vehicle.count).toHaveBeenCalledTimes(1);
  });
});
