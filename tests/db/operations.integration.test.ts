import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, UserRole } from "@/generated/prisma";
import { ActionError } from "@/lib/action-result";
import { AuthorizationError } from "@/lib/auth/errors";
import { ConflictError, NotFoundError } from "@/lib/domain-errors";
import { InvalidLeadTransitionError } from "@/lib/lead-status";
import { LOCAL_UPLOAD_ROOT } from "@/lib/storage";
import { InvalidVehicleTransitionError } from "@/lib/vehicle-status";
import * as ops from "@/lib/operations";
import type { OperationContext } from "@/lib/operations";
import { getDealerSettings } from "@/lib/settings";
import { assertMigrated, cleanupRun, createClient, databaseConfigured, id, RUN_TAG } from "./helpers";

/**
 * PHASE 4 — the operational loop against real PostgreSQL.
 *
 *   OPPORTUNITY -> ANALYZE -> BUY -> ACQUIRE -> COSTS -> PREPARE -> PUBLISH
 *   -> LEAD -> SELL -> ACTUAL ECONOMICS
 *
 * These tests exercise the operations through their public surface only. Where
 * a rule lives in the database (a unique index, a CHECK constraint, the
 * partial unique index on live deals), the test asserts the outcome rather than
 * the mechanism, so it stays honest if the implementation changes.
 *
 * Every row this file creates is tracked and removed in `afterAll`.
 */

const ROLES: UserRole[] = ["OWNER", "MANAGER", "SALES", "RECON", "VIEWER"];

/** A VIN that satisfies the decoder's rule: 11-17 chars, no I, O or Q. */
function opVin(suffix: string): string {
  const safe = (value: string) => value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "X");
  const body = `1HG${safe(RUN_TAG)}${safe(suffix).slice(0, 6)}0000`;
  const trimmed = body.slice(0, 17);
  return trimmed.length >= 11 ? trimmed : trimmed.padEnd(11, "0");
}

const BASE_OPPORTUNITY = {
  source: "AUCTION_FEED" as const,
  year: 2019,
  make: "Toyota",
  model: "Camry",
  mileage: 68_000,
  askingPriceCents: 1_450_000,
  expectedAuctionFeesCents: 45_000,
  transportEstimateCents: 32_000,
  estimatedReconCents: 120_000,
  otherCostsCents: 0,
  estimatedRetailCents: 1_899_500,
};

describe.skipIf(!databaseConfigured)("Phase 4 operations (real PostgreSQL)", () => {
  let prisma: PrismaClient;
  const actorIds = new Map<UserRole, string>();

  const vehicles: string[] = [];
  const candidates: string[] = [];
  const customers: string[] = [];
  const leads: string[] = [];
  /** Storage keys of photos this run wrote to disk, so they can be removed. */
  const photoKeys: string[] = [];

  function ctxFor(role: UserRole): OperationContext {
    const actorId = actorIds.get(role);
    if (!actorId) throw new Error(`no fixture user for ${role}`);
    return {
      actor: { id: actorId, email: `${role.toLowerCase()}@dealer.test`, name: role, role },
      db: prisma,
    };
  }

  /** Creates an opportunity, then records the operator's BUY decision. */
  async function approvedOpportunity(role: UserRole, suffix: string, patch: Record<string, unknown> = {}) {
    const ctx = ctxFor(role);
    const created = await ops.createSourcingCandidate(ctx, {
      ...BASE_OPPORTUNITY,
      vin: opVin(suffix),
      ...patch,
    });
    candidates.push(created.candidateId);
    await ops.recordSourcingDecision(ctx, created.candidateId, { status: "APPROVED_TO_BUY" });
    return created.candidateId;
  }

  /** ACQUIRE: candidate -> owned inventory. */
  async function acquire(role: UserRole, suffix: string) {
    const ctx = ctxFor(role);
    const candidateId = await approvedOpportunity(role, suffix);
    const result = await ops.acquireVehicleFromCandidate(ctx, {
      candidateId,
      vehicle: {
        vin: opVin(suffix),
        year: 2019,
        make: "Toyota",
        model: "Camry",
        trim: "SE",
        mileage: 68_000,
        stockNumber: `SN-${RUN_TAG}-${suffix}`.toUpperCase(),
      },
      acquisition: {
        source: "AUCTION",
        purchasePriceCents: 1_450_000,
        auctionFeesCents: 45_000,
        transportationCents: 32_000,
        inspectionCents: 9_500,
        otherCents: 5_000,
      },
      pricing: {
        targetRetailPriceCents: 1_999_500,
        askingPriceCents: 1_899_500,
        minimumApprovedCents: 1_750_000,
      },
    });
    vehicles.push(result.vehicle.id);
    return result;
  }

  /** Walks a freshly acquired car from PURCHASED to READY. */
  async function prepareForRetail(role: UserRole, vehicleId: string) {
    const ctx = ctxFor(role);
    for (const toStatus of ["INSPECTION", "RECONDITIONING", "READY"] as const) {
      await ops.transitionVehicleStatus(ctx, { vehicleId, toStatus });
    }
  }

  /** The full path to a published car, returning its id. */
  async function publishableVehicle(role: UserRole, suffix: string) {
    const acquired = await acquire(role, suffix);
    await prepareForRetail(role, acquired.vehicle.id);
    await ops.publishVehicle(ctxFor(role), acquired.vehicle.id);
    return acquired.vehicle.id;
  }

  async function makeCustomer(suffix: string, phone: string): Promise<string> {
    const created = await prisma.customer.create({
      data: { id: id(`cust_${suffix}`), firstName: "Test", lastName: suffix, phone },
      select: { id: true },
    });
    customers.push(created.id);
    return created.id;
  }

  beforeAll(async () => {
    prisma = createClient();
    await assertMigrated(prisma);

    for (const role of ROLES) {
      const created = await prisma.user.create({
        data: {
          id: id(`user_${role}`),
          email: `${role.toLowerCase()}.${RUN_TAG.toLowerCase()}@dealer.test`,
          name: `${role} Fixture`,
          passwordHash: "not-a-real-hash",
          role,
        },
        select: { id: true },
      });
      actorIds.set(role, created.id);
    }

    // The singleton is created by the first read; its schema defaults are the
    // sourcing floors these tests rely on.
    const settings = await getDealerSettings(prisma);
    expect(settings.minGrossProfitCents).toBe(150_000);
    expect(settings.minRoiBasisPoints).toBe(1_000);
  });

  afterAll(async () => {
    if (!prisma) return;
    // Children first: an operation-created row has a cuid, not a run-prefixed
    // id, so it is removed by the ids collected during the run.
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: leads } } }).catch(() => 0);
    await prisma.lead.deleteMany({ where: { id: { in: leads } } }).catch(() => 0);
    await prisma.deal.deleteMany({ where: { vehicleId: { in: vehicles } } }).catch(() => 0);
    await prisma.vehicleStatusEvent.deleteMany({ where: { vehicleId: { in: vehicles } } }).catch(() => 0);
    await prisma.vehicleReconItem.deleteMany({ where: { vehicleId: { in: vehicles } } }).catch(() => 0);
    await prisma.expense.deleteMany({ where: { vehicleId: { in: vehicles } } }).catch(() => 0);
    await prisma.vehiclePhoto.deleteMany({ where: { vehicleId: { in: vehicles } } }).catch(() => 0);
    await prisma.sourcingCandidate.deleteMany({ where: { id: { in: candidates } } }).catch(() => 0);
    await prisma.vehicle.deleteMany({ where: { id: { in: vehicles } } }).catch(() => 0);
    await prisma.customer.deleteMany({ where: { id: { in: customers } } }).catch(() => 0);
    await cleanupRun(prisma);
    // The settings singleton was created by this run in an otherwise empty
    // database; removing it leaves zero test data.
    await prisma.dealerSettings.deleteMany({ where: { id: "singleton" } }).catch(() => 0);
    // Remove the image blobs the storage-boundary test wrote to disk.
    await Promise.all(
      photoKeys
        .filter(Boolean)
        .map((key) => rm(path.join(LOCAL_UPLOAD_ROOT, key), { force: true }).catch(() => 0)),
    );
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // BUY
  // -------------------------------------------------------------------------

  describe("BUY — sourcing against the canonical engine", () => {
    it("persists a scored opportunity with its evaluation snapshot", async () => {
      const ctx = ctxFor("MANAGER");
      const created = await ops.createSourcingCandidate(ctx, { ...BASE_OPPORTUNITY, vin: opVin("buy1") });
      candidates.push(created.candidateId);

      expect(created.evaluation.landedCostCents).toBe(1_647_000);
      expect(created.evaluation.expectedProfitCents).toBe(252_500);
      expect(created.evaluation.recommendation).toBe("BUY");
      expect(created.evaluation.bindingConstraint).toBe("roi-floor");

      expect(created.candidate.status).toBe("INBOX");
      expect(created.candidate.landedCostCents).toBe(1_647_000);
      expect(created.candidate.expectedProfitCents).toBe(252_500);
      expect(created.candidate.expectedRoiBasisPoints).toBe(1_533);
      expect(created.candidate.maxPurchasePriceCents).toBe(1_529_800);
      expect(created.candidate.maxBidCents).toBe(1_529_800);
      expect(created.candidate.recommendation).toBe("BUY");
      expect(created.candidate.recommendationReasons.length).toBeGreaterThan(0);
      expect(created.candidate.evaluatedAt).toBeInstanceOf(Date);
      expect(created.candidate.createdById).toBe(ctx.actor.id);
    });

    it("uses the dealership floors from dealer_settings when none are supplied", async () => {
      const ctx = ctxFor("MANAGER");
      const created = await ops.createSourcingCandidate(ctx, { ...BASE_OPPORTUNITY, vin: opVin("buy2") });
      candidates.push(created.candidateId);

      // Defaults are minGross 150000 / minRoi 1000 bps.
      expect(created.candidate.minGrossProfitCents).toBe(150_000);
      expect(created.candidate.minRoiBasisPoints).toBe(1_000);
      expect(created.candidate.maxPurchasePriceCents).toBe(1_529_800);
    });

    it("re-evaluates when an input changes and clears a stale verdict", async () => {
      const ctx = ctxFor("MANAGER");
      const created = await ops.createSourcingCandidate(ctx, { ...BASE_OPPORTUNITY, vin: opVin("buy3") });
      candidates.push(created.candidateId);
      expect(created.candidate.recommendation).toBe("BUY");

      const updated = await ops.updateSourcingCandidate(ctx, created.candidateId, {
        askingPriceCents: 1_600_000,
      });
      expect(updated.candidate.askingPriceCents).toBe(1_600_000);
      expect(updated.candidate.recommendation).not.toBe("BUY"); // above the ceiling
      // The ceiling itself is unchanged: only the asking price moved.
      expect(updated.evaluation.maxPurchasePriceCents).toBe(1_529_800);
      expect(updated.candidate.expectedProfitCents).toBe(102_500);
      expect(updated.candidate.vin).toBe(opVin("buy3")); // untouched by the patch
    });

    it("records a decision, and still allows re-evaluation before purchase", async () => {
      const ctx = ctxFor("MANAGER");
      const created = await ops.createSourcingCandidate(ctx, { ...BASE_OPPORTUNITY, vin: opVin("buy4") });
      candidates.push(created.candidateId);

      const decided = await ops.recordSourcingDecision(ctx, created.candidateId, {
        status: "PASSED",
        notes: "Too much recon risk.",
      });
      expect(decided.status).toBe("PASSED");
      expect(decided.decisionNotes).toBe("Too much recon risk.");
      expect(decided.decidedById).toBe(ctx.actor.id);
      expect(decided.decidedAt).toBeInstanceOf(Date);

      await expect(
        ops.updateSourcingCandidate(ctx, created.candidateId, { askingPriceCents: 1 }),
      ).resolves.toBeDefined();
    });

    it("lets SALES read the inbox but never write to it", async () => {
      const owner = ctxFor("OWNER");
      const created = await ops.createSourcingCandidate(owner, { ...BASE_OPPORTUNITY, vin: opVin("buy5") });
      candidates.push(created.candidateId);

      const list = await ops.listSourcingCandidates(ctxFor("SALES"), { limit: 200 });
      expect(list.items.some((row) => row.id === created.candidateId)).toBe(true);
      expect(list.total).toBeGreaterThan(0);

      await expect(
        ops.createSourcingCandidate(ctxFor("SALES"), { ...BASE_OPPORTUNITY, vin: opVin("buy6") }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("reports a missing candidate as NotFound rather than returning nothing", async () => {
      await expect(ops.getSourcingCandidate(ctxFor("OWNER"), "cand_does_not_exist")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // ACQUISITION
  // -------------------------------------------------------------------------

  describe("ACQUISITION — opportunity becomes inventory", () => {
    it("creates the canonical vehicle, links it and initialises the lifecycle", async () => {
      const ctx = ctxFor("OWNER");
      const candidateId = await approvedOpportunity("OWNER", "acq1");
      const result = await ops.acquireVehicleFromCandidate(ctx, {
        candidateId,
        vehicle: {
          vin: opVin("acq1"),
          year: 2019,
          make: "Toyota",
          model: "Camry",
          mileage: 68_000,
          stockNumber: `SN-${RUN_TAG}-ACQ1`.toUpperCase(),
        },
        acquisition: {
          source: "AUCTION",
          purchasePriceCents: 1_450_000,
          auctionFeesCents: 45_000,
          transportationCents: 32_000,
          inspectionCents: 9_500,
          otherCents: 5_000,
        },
        pricing: { askingPriceCents: 1_899_500, minimumApprovedCents: 1_750_000 },
      });
      vehicles.push(result.vehicle.id);

      expect(result.vehicle.status).toBe("PURCHASED");
      expect(result.vehicle.listingStatus).toBe("PAUSED");
      expect(result.landedCost.landedCostCents).toBe(1_541_500);

      const candidate = await prisma.sourcingCandidate.findUniqueOrThrow({ where: { id: candidateId } });
      expect(candidate.status).toBe("PURCHASED");
      expect(candidate.purchasedVehicleId).toBe(result.vehicle.id);

      const events = await prisma.vehicleStatusEvent.findMany({ where: { vehicleId: result.vehicle.id } });
      expect(events).toHaveLength(1);
      expect(events[0]?.fromStatus).toBeNull();
      expect(events[0]?.toStatus).toBe("PURCHASED");
    });

    it("initialises the lifecycle at PURCHASED, not SOURCING", async () => {
      const acquired = await acquire("OWNER", "acq2");
      expect(acquired.vehicle.status).toBe("PURCHASED");
    });

    it("refuses to buy a candidate that was never approved", async () => {
      const ctx = ctxFor("OWNER");
      const created = await ops.createSourcingCandidate(ctx, { ...BASE_OPPORTUNITY, vin: opVin("acq3") });
      candidates.push(created.candidateId);

      await expect(
        ops.acquireVehicleFromCandidate(ctx, {
          candidateId: created.candidateId,
          vehicle: { vin: opVin("acq3"), year: 2019, make: "Toyota", model: "Camry", mileage: 1 },
          acquisition: { source: "AUCTION", purchasePriceCents: 100 },
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("refuses a duplicate VIN, and rolls the whole acquisition back", async () => {
      const ctx = ctxFor("OWNER");
      const first = await acquire("OWNER", "acq4");
      const duplicateVin = first.vehicle.vin;

      const candidateId = await approvedOpportunity("OWNER", "acq5");
      await expect(
        ops.acquireVehicleFromCandidate(ctx, {
          candidateId,
          vehicle: { vin: duplicateVin, year: 2020, make: "Honda", model: "Civic", mileage: 10 },
          acquisition: { source: "AUCTION", purchasePriceCents: 100 },
        }),
      ).rejects.toBeInstanceOf(ConflictError);

      // Atomicity: the candidate must NOT have been marked purchased, and no
      // orphan vehicle may exist.
      const candidate = await prisma.sourcingCandidate.findUniqueOrThrow({ where: { id: candidateId } });
      expect(candidate.status).toBe("APPROVED_TO_BUY");
      expect(candidate.purchasedVehicleId).toBeNull();

      const orphans = await prisma.vehicle.count({ where: { make: "Honda", model: "Civic", mileage: 10 } });
      expect(orphans).toBe(0);
    });

    it("refuses an asking price below the minimum approved price", async () => {
      const ctx = ctxFor("OWNER");
      const candidateId = await approvedOpportunity("OWNER", "acq6");
      await expect(
        ops.acquireVehicleFromCandidate(ctx, {
          candidateId,
          vehicle: { vin: opVin("acq6"), year: 2019, make: "Toyota", model: "Camry", mileage: 1 },
          acquisition: { source: "AUCTION", purchasePriceCents: 100 },
          pricing: { askingPriceCents: 900_000, minimumApprovedCents: 1_000_000 },
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  // -------------------------------------------------------------------------
  // CARS
  // -------------------------------------------------------------------------

  describe("CARS — inventory operations", () => {
    it("lists inventory and hides the cost basis from a salesperson", async () => {
      const acquired = await acquire("OWNER", "cars1");
      const vehicleId = acquired.vehicle.id;

      const ownerList = await ops.listInventory(ctxFor("OWNER"), { search: acquired.vehicle.stockNumber });
      const ownerRow = ownerList.items.find((row) => row.id === vehicleId);
      expect(ownerRow?.landedCostCents).toBe(1_541_500);
      expect(ownerRow?.acquisitionPriceCents).toBe(1_450_000);
      expect(ownerRow?.negotiatingRoomCents).toBe(149_500);

      const salesList = await ops.listInventory(ctxFor("SALES"), { search: acquired.vehicle.stockNumber });
      const salesRow = salesList.items.find((row) => row.id === vehicleId);
      expect(salesRow?.askingPriceCents).toBe(1_899_500);
      expect(salesRow?.landedCostCents).toBeNull();
      expect(salesRow?.acquisitionPriceCents).toBeNull();
      expect(salesRow?.negotiatingRoomCents).toBeNull();
      expect(salesRow?.frontEndMarginCents).toBeNull();
      expect(salesRow?.estimatedRoiBasisPoints).toBeNull();
    });

    it("omits expense and recon rows from a role that may not see spend", async () => {
      const acquired = await acquire("OWNER", "cars2");
      const vehicleId = acquired.vehicle.id;
      await ops.recordVehicleExpense(ctxFor("RECON"), {
        vehicleId,
        category: "PARTS",
        amountCents: 20_000,
        vendor: "Parts Co",
      });
      await ops.recordReconItem(ctxFor("RECON"), { vehicleId, issue: "Front brakes", estimateCents: 120_000 });

      const asSales = await ops.getVehicleDetail(ctxFor("SALES"), vehicleId);
      expect(asSales.expenses).toBeUndefined();
      expect(asSales.reconItems).toBeUndefined();
      expect(asSales.vehicle.landedCostCents).toBeNull();

      const asRecon = await ops.getVehicleDetail(ctxFor("RECON"), vehicleId);
      expect(asRecon.expenses).toHaveLength(1);
      expect(asRecon.reconItems).toHaveLength(1);
      // RECON sees spend but not the acquisition cost basis or margin.
      expect(asRecon.vehicle.acquisitionPriceCents).toBeNull();
      expect(asRecon.vehicle.landedCostCents).toBeNull();

      const asOwner = await ops.getVehicleDetail(ctxFor("OWNER"), vehicleId);
      expect(asOwner.vehicle.landedCostCents).toBe(1_541_500 + 120_000 + 20_000);
      expect(asOwner.statusEvents.length).toBeGreaterThan(0);
    });

    it("records a vehicle expense and refuses a zero or negative amount", async () => {
      const acquired = await acquire("OWNER", "cars3");
      const expense = await ops.recordVehicleExpense(ctxFor("RECON"), {
        vehicleId: acquired.vehicle.id,
        category: "DETAIL",
        amountCents: 15_000,
      });
      expect(expense.amountCents).toBe(15_000);
      expect(expense.paid).toBe(true);

      await expect(
        ops.recordVehicleExpense(ctxFor("RECON"), {
          vehicleId: acquired.vehicle.id,
          category: "DETAIL",
          amountCents: 0,
        }),
      ).rejects.toBeTruthy();
    });

    it("stamps a completion date when a recon item is completed", async () => {
      const acquired = await acquire("OWNER", "cars4");
      const item = await ops.recordReconItem(ctxFor("RECON"), {
        vehicleId: acquired.vehicle.id,
        issue: "Tires",
        estimateCents: 80_000,
      });
      expect(item.status).toBe("ESTIMATED");
      expect(item.completedAt).toBeNull();

      const completed = await ops.updateReconItem(ctxFor("RECON"), item.id, { status: "COMPLETED" });
      expect(completed.status).toBe("COMPLETED");
      expect(completed.completedAt).toBeInstanceOf(Date);
    });

    it("allows a legal lifecycle move and rejects an illegal one", async () => {
      const acquired = await acquire("OWNER", "cars5");
      const vehicleId = acquired.vehicle.id;

      const inspected = await ops.transitionVehicleStatus(ctxFor("RECON"), {
        vehicleId,
        toStatus: "INSPECTION",
        note: "In the bay",
      });
      expect(inspected.status).toBe("INSPECTION");
      expect(inspected.listingStatus).toBe("PAUSED");

      // RECONDITIONING is the only forward exit from INSPECTION besides READY.
      await expect(
        ops.transitionVehicleStatus(ctxFor("RECON"), { vehicleId, toStatus: "PURCHASED" }),
      ).rejects.toBeInstanceOf(InvalidVehicleTransitionError);

      const events = await prisma.vehicleStatusEvent.findMany({ where: { vehicleId } });
      expect(events).toHaveLength(2);
    });

    it("refuses to move a vehicle into SOLD through a status change", async () => {
      const acquired = await acquire("OWNER", "cars6");
      await expect(
        ops.transitionVehicleStatus(ctxFor("OWNER"), { vehicleId: acquired.vehicle.id, toStatus: "SOLD" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("updates permitted details but not pricing, and rejects smuggled fields", async () => {
      const acquired = await acquire("OWNER", "cars7");
      const vehicleId = acquired.vehicle.id;

      const updated = await ops.updateVehicleDetails(ctxFor("RECON"), vehicleId, {
        mileage: 69_100,
        exteriorColor: "Blue",
        features: ["Sunroof"],
      });
      expect(updated.mileage).toBe(69_100);
      expect(updated.exteriorColor).toBe("Blue");
      expect(updated.features).toEqual(["Sunroof"]);

      // `.strict()` means a pricing field cannot ride along silently.
      await expect(
        ops.updateVehicleDetails(ctxFor("OWNER"), vehicleId, { askingPriceCents: 1 } as never),
      ).rejects.toBeTruthy();
    });

    it("updates pricing and refuses to go below the minimum approved price", async () => {
      const acquired = await acquire("OWNER", "cars8");
      const vehicleId = acquired.vehicle.id;

      const repriced = await ops.updateVehiclePricing(ctxFor("MANAGER"), vehicleId, {
        askingPriceCents: 1_950_000,
      });
      expect(repriced.askingPriceCents).toBe(1_950_000);
      expect(repriced.landedCostCents).toBe(1_541_500);

      await expect(
        ops.updateVehiclePricing(ctxFor("MANAGER"), vehicleId, { askingPriceCents: 1_000_000 }),
      ).rejects.toBeInstanceOf(ConflictError);

      await expect(
        ops.updateVehiclePricing(ctxFor("SALES"), vehicleId, { askingPriceCents: 2_000_000 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("publishes a READY vehicle and unpublishes it back to READY", async () => {
      const ctx = ctxFor("OWNER");
      const acquired = await acquire("OWNER", "cars9");
      const vehicleId = acquired.vehicle.id;

      // Not READY yet: the lifecycle forbids the jump to LISTED.
      await expect(ops.publishVehicle(ctx, vehicleId)).rejects.toBeInstanceOf(
        InvalidVehicleTransitionError,
      );

      await prepareForRetail("OWNER", vehicleId);
      const published = await ops.publishVehicle(ctx, vehicleId);
      expect(published.status).toBe("LISTED");
      expect(published.listingStatus).toBe("ACTIVE");
      expect(published.dateListed).toBeInstanceOf(Date);

      await expect(ops.publishVehicle(ctx, vehicleId)).rejects.toBeInstanceOf(ConflictError);

      const unpublished = await ops.unpublishVehicle(ctx, vehicleId);
      expect(unpublished.status).toBe("READY");
      expect(unpublished.listingStatus).toBe("UNLISTED");

      const republished = await ops.publishVehicle(ctx, vehicleId);
      // The original listing date survives a temporary unpublish.
      expect(republished.dateListed?.getTime()).toBe(published.dateListed?.getTime());
    });

    it("refuses to publish a vehicle with no asking price", async () => {
      const ctx = ctxFor("OWNER");
      const acquired = await acquire("OWNER", "carsa");
      await prepareForRetail("OWNER", acquired.vehicle.id);
      await prisma.vehicle.update({ where: { id: acquired.vehicle.id }, data: { askingPriceCents: null } });

      await expect(ops.publishVehicle(ctx, acquired.vehicle.id)).rejects.toBeInstanceOf(ConflictError);
    });

    it("refuses to empty the price of a published vehicle", async () => {
      const vehicleId = await publishableVehicle("OWNER", "carsb");
      await expect(
        ops.updateVehiclePricing(ctxFor("MANAGER"), vehicleId, { askingPriceCents: null }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("keeps RECON out of publishing but inside the reconditioning flow", async () => {
      const acquired = await acquire("OWNER", "carsc");
      await prepareForRetail("OWNER", acquired.vehicle.id);
      await expect(ops.publishVehicle(ctxFor("RECON"), acquired.vehicle.id)).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      const moved = await ops.transitionVehicleStatus(ctxFor("RECON"), {
        vehicleId: acquired.vehicle.id,
        toStatus: "RECONDITIONING",
      });
      expect(moved.status).toBe("RECONDITIONING");
    });

    it("records acquisition costs and reflects them in the landed cost", async () => {
      const acquired = await acquire("OWNER", "carsd");
      const updated = await ops.updateVehicleAcquisition(ctxFor("MANAGER"), acquired.vehicle.id, {
        transportationCents: 100_000,
      });
      expect(updated.transportationCents).toBe(100_000);
      expect(updated.landedCostCents).toBe(1_541_500 + (100_000 - 32_000));
    });

    it("stores a photo through the storage boundary and refuses a disguised file", async () => {
      const acquired = await acquire("OWNER", "carse");
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

      const photo = await ops.uploadVehiclePhoto(ctxFor("OWNER"), {
        vehicleId: acquired.vehicle.id,
        fileName: "front.png",
        declaredMimeType: "image/png",
        bytes: png,
      });
      expect(photo.isPrimary).toBe(true);
      expect(photo.storagePath).toContain("vehicle/");
      if (photo.storagePath) photoKeys.push(photo.storagePath);

      const second = await ops.uploadVehiclePhoto(ctxFor("OWNER"), {
        vehicleId: acquired.vehicle.id,
        fileName: "side.png",
        declaredMimeType: "image/png",
        bytes: png,
      });
      if (second.storagePath) photoKeys.push(second.storagePath);
      expect(second.isPrimary).toBe(false);
      const promoted = await ops.setPrimaryVehiclePhoto(ctxFor("OWNER"), second.id);
      expect(promoted.isPrimary).toBe(true);
      expect((await prisma.vehiclePhoto.findUniqueOrThrow({ where: { id: photo.id } })).isPrimary).toBe(false);

      await ops.deleteVehiclePhoto(ctxFor("OWNER"), second.id);
      expect(await prisma.vehiclePhoto.count({ where: { id: second.id } })).toBe(0);

      // A script renamed to .png is rejected on content, not on its name.
      await expect(
        ops.uploadVehiclePhoto(ctxFor("OWNER"), {
          vehicleId: acquired.vehicle.id,
          fileName: "evil.png",
          declaredMimeType: "image/png",
          bytes: new TextEncoder().encode("<html><script>alert(1)</script>"),
        }),
      ).rejects.toBeInstanceOf(ActionError);
    });
  });

  // -------------------------------------------------------------------------
  // LEADS
  // -------------------------------------------------------------------------

  describe("LEADS — the small CRM surface", () => {
    it("creates a lead and its customer in one step", async () => {
      const ctx = ctxFor("SALES");
      const lead = await ops.createLead(ctx, {
        customer: { firstName: "Dana", lastName: "Reyes", phone: "5550102030" },
        summary: "Asked about the Camry",
      });
      leads.push(lead.id);
      customers.push(lead.customer.id);

      expect(lead.status).toBe("NEW");
      expect(lead.customer.firstName).toBe("Dana");
      expect(lead.assignedToId).toBeNull();
    });

    it("requires a way to contact the customer", async () => {
      await expect(
        ops.createLead(ctxFor("SALES"), { customer: { firstName: "NoContact" } }),
      ).rejects.toBeInstanceOf(ActionError);
    });

    it("refuses both an existing customer and new details at once", async () => {
      const customerId = await makeCustomer("both", "5550000001");
      await expect(
        ops.createLead(ctxFor("SALES"), {
          customerId,
          customer: { firstName: "Both", phone: "5550000002" },
        }),
      ).rejects.toBeInstanceOf(ActionError);
    });

    it("attaches a lead to a vehicle and lists it back", async () => {
      const acquired = await acquire("OWNER", "lead1");
      const lead = await ops.createLead(ctxFor("SALES"), {
        customer: { firstName: "Ivan", phone: "5550304050" },
        vehicleId: acquired.vehicle.id,
      });
      leads.push(lead.id);
      customers.push(lead.customer.id);
      expect(lead.vehicleId).toBe(acquired.vehicle.id);

      const list = await ops.listLeads(ctxFor("SALES"), { search: "Ivan" });
      expect(list.items.some((row) => row.id === lead.id)).toBe(true);

      const detail = await ops.getLead(ctxFor("VIEWER"), lead.id);
      expect(detail.lead.id).toBe(lead.id);
      expect(detail.activities).toHaveLength(0);
    });

    it("walks NEW -> CONTACTED -> APPOINTMENT -> WON and records each step", async () => {
      const ctx = ctxFor("SALES");
      const lead = await ops.createLead(ctx, { customer: { firstName: "Wanda", phone: "5550506070" } });
      leads.push(lead.id);
      customers.push(lead.customer.id);

      const contacted = await ops.updateLeadStatus(ctx, { leadId: lead.id, status: "CONTACTED" });
      expect(contacted.status).toBe("CONTACTED");
      expect(contacted.lastContactedAt).toBeInstanceOf(Date);

      const appointment = await ops.updateLeadStatus(ctx, { leadId: lead.id, status: "APPOINTMENT" });
      expect(appointment.status).toBe("APPOINTMENT");

      const won = await ops.updateLeadStatus(ctx, { leadId: lead.id, status: "WON", note: "Signed" });
      expect(won.status).toBe("WON");

      const detail = await ops.getLead(ctx, lead.id);
      expect(detail.activities).toHaveLength(3);
      const statusChanges = detail.activities.filter((row) => row.type === "STATUS_CHANGE");
      expect(statusChanges).toHaveLength(3);
      expect(statusChanges[0]?.fromStatus).toBe("APPOINTMENT");
      expect(statusChanges[0]?.toStatus).toBe("WON");
      expect(statusChanges[0]?.createdById).toBe(ctx.actor.id);
    });

    it("rejects a transition the lead state machine forbids", async () => {
      const ctx = ctxFor("SALES");
      const lead = await ops.createLead(ctx, { customer: { firstName: "Skip", phone: "5550708090" } });
      leads.push(lead.id);
      customers.push(lead.customer.id);

      await expect(
        ops.updateLeadStatus(ctx, { leadId: lead.id, status: "APPOINTMENT" }),
      ).rejects.toBeInstanceOf(InvalidLeadTransitionError);
    });

    it("rejects a no-op status change", async () => {
      const ctx = ctxFor("SALES");
      const lead = await ops.createLead(ctx, { customer: { firstName: "Same", phone: "5550809001" } });
      leads.push(lead.id);
      customers.push(lead.customer.id);

      await expect(
        ops.updateLeadStatus(ctx, { leadId: lead.id, status: "NEW" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("requires a reason to lose a lead, and clears it when reopened", async () => {
      const ctx = ctxFor("SALES");
      const lead = await ops.createLead(ctx, { customer: { firstName: "Lost", phone: "5550901020" } });
      leads.push(lead.id);
      customers.push(lead.customer.id);
      await ops.updateLeadStatus(ctx, { leadId: lead.id, status: "CONTACTED" });

      await expect(
        ops.updateLeadStatus(ctx, { leadId: lead.id, status: "LOST" }),
      ).rejects.toBeInstanceOf(ActionError);

      const lost = await ops.updateLeadStatus(ctx, {
        leadId: lead.id,
        status: "LOST",
        lostReason: "Bought elsewhere",
      });
      expect(lost.status).toBe("LOST");
      expect(lost.lostReason).toBe("Bought elsewhere");

      const reopened = await ops.updateLeadStatus(ctx, { leadId: lead.id, status: "CONTACTED" });
      expect(reopened.status).toBe("CONTACTED");
      expect(reopened.lostReason).toBeNull();
    });

    it("updates contact details but never leaves a customer unreachable", async () => {
      const ctx = ctxFor("SALES");
      const lead = await ops.createLead(ctx, { customer: { firstName: "Edit", phone: "5551011121" } });
      leads.push(lead.id);
      customers.push(lead.customer.id);

      const updated = await ops.updateLeadContact(ctx, lead.id, { phone: "5551011122", city: "Austin" });
      expect(updated.customer.phone).toBe("5551011122");

      await expect(
        ops.updateLeadContact(ctx, lead.id, { phone: null }),
      ).rejects.toBeInstanceOf(ActionError);
    });

    it("records notes as lead activities and refuses to write as RECON", async () => {
      const ctx = ctxFor("SALES");
      const lead = await ops.createLead(ctx, { customer: { firstName: "Note", phone: "5552021222" } });
      leads.push(lead.id);
      customers.push(lead.customer.id);

      const note = await ops.addLeadNote(ctx, { leadId: lead.id, body: "Left a voicemail." });
      expect(note.type).toBe("NOTE");
      expect(note.body).toBe("Left a voicemail.");

      await expect(
        ops.addLeadNote(ctxFor("RECON"), { leadId: lead.id, body: "should fail" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("stops VIEWER from writing anything", async () => {
      await expect(
        ops.createLead(ctxFor("VIEWER"), { customer: { firstName: "Read", phone: "5553031323" } }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  // -------------------------------------------------------------------------
  // SALES
  // -------------------------------------------------------------------------

  describe("SALES — completing a sale", () => {
    it("contracts the deal, sells the vehicle and returns the real economics", async () => {
      const vehicleId = await publishableVehicle("OWNER", "sale1");
      await ops.recordReconItem(ctxFor("RECON"), {
        vehicleId,
        issue: "Front brakes",
        estimateCents: 120_000,
      });
      await ops.recordVehicleExpense(ctxFor("RECON"), {
        vehicleId,
        category: "DETAIL",
        amountCents: 20_000,
      });

      const customerId = await makeCustomer("sale1", "5554000001");
      // A manager, because this test asserts the cost and profit figures; the
      // salesperson path is covered below and deliberately receives none.
      const result = await ops.completeVehicleSale(ctxFor("MANAGER"), {
        vehicleId,
        customerId,
        salePriceCents: 1_950_000,
      });

      expect(result.vehicleStatus).toBe("SOLD");
      expect(result.dealStatus).toBe("CONTRACTED");
      expect(result.finalSalePriceCents).toBe(1_950_000);
      expect(result.landedCostCents).toBe(1_681_500);
      expect(result.actualGrossProfitCents).toBe(268_500);
      expect(result.actualRoiBasisPoints).toBe(1_597);
      expect(result.daysInInventory).not.toBeNull();

      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(vehicle.status).toBe("SOLD");
      expect(vehicle.listingStatus).toBe("SOLD");
      expect(vehicle.finalSalePriceCents).toBe(1_950_000);
      expect(vehicle.dateSold).toBeInstanceOf(Date);

      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: result.dealId } });
      expect(deal.status).toBe("CONTRACTED");
      expect(deal.salePriceCents).toBe(1_950_000);
      expect(deal.saleDate).toBeInstanceOf(Date);
      expect(deal.salespersonId).toBe(ctxFor("MANAGER").actor.id);

      const events = await prisma.vehicleStatusEvent.findMany({
        where: { vehicleId, toStatus: "SOLD" },
      });
      expect(events).toHaveLength(1);
    });

    it("masks cost and profit for a salesperson but not for the owner", async () => {
      const vehicleId = await publishableVehicle("OWNER", "sale2");
      const customerId = await makeCustomer("sale2", "5554000002");

      const asSales = await ops.completeVehicleSale(ctxFor("SALES"), {
        vehicleId,
        customerId,
        salePriceCents: 1_900_000,
      });
      expect(asSales.finalSalePriceCents).toBe(1_900_000);
      expect(asSales.landedCostCents).toBeNull();
      expect(asSales.actualGrossProfitCents).toBeNull();
      expect(asSales.actualRoiBasisPoints).toBeNull();
      expect(asSales.landedCost).toBeNull();

      const vehicleId2 = await publishableVehicle("OWNER", "sale3");
      const customerId2 = await makeCustomer("sale3", "5554000003");
      const asOwner = await ops.completeVehicleSale(ctxFor("OWNER"), {
        vehicleId: vehicleId2,
        customerId: customerId2,
        salePriceCents: 1_900_000,
      });
      expect(asOwner.landedCostCents).toBe(1_541_500);
      expect(asOwner.actualGrossProfitCents).toBe(1_900_000 - 1_541_500);
      expect(asOwner.actualRoiBasisPoints).not.toBeNull();
    });

    it("creates the buyer when new customer details are supplied", async () => {
      const vehicleId = await publishableVehicle("OWNER", "sale4");
      const result = await ops.completeVehicleSale(ctxFor("SALES"), {
        vehicleId,
        customer: { firstName: "Nora", lastName: "Buyer", email: "nora@example.test" },
        salePriceCents: 1_925_000,
      });
      customers.push(result.customerId);
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: result.customerId } });
      expect(customer.firstName).toBe("Nora");
      expect(customer.email).toBe("nora@example.test");
    });

    it("refuses to sell a car that has not been published", async () => {
      const acquired = await acquire("OWNER", "sale5");
      await prepareForRetail("OWNER", acquired.vehicle.id);
      const customerId = await makeCustomer("sale5", "5554000005");

      await expect(
        ops.completeVehicleSale(ctxFor("SALES"), {
          vehicleId: acquired.vehicle.id,
          customerId,
          salePriceCents: 1_900_000,
        }),
      ).rejects.toBeInstanceOf(InvalidVehicleTransitionError);
    });

    it("refuses a sale with no price", async () => {
      const vehicleId = await publishableVehicle("OWNER", "sale6");
      const customerId = await makeCustomer("sale6", "5554000006");
      await expect(
        ops.completeVehicleSale(ctxFor("SALES"), { vehicleId, customerId, salePriceCents: 0 }),
      ).rejects.toBeTruthy();
    });

    it("refuses to sell the same vehicle twice", async () => {
      const vehicleId = await publishableVehicle("OWNER", "sale7");
      const customerId = await makeCustomer("sale7", "5554000007");
      await ops.completeVehicleSale(ctxFor("SALES"), { vehicleId, customerId, salePriceCents: 1_900_000 });

      await expect(
        ops.completeVehicleSale(ctxFor("SALES"), { vehicleId, customerId, salePriceCents: 1_800_000 }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("reuses a live deal for the same buyer and refuses one promised to somebody else", async () => {
      const vehicleId = await publishableVehicle("OWNER", "sale8");
      const holderId = await makeCustomer("sale8holder", "5554000008");
      const otherId = await makeCustomer("sale8other", "5554000009");

      // A live deal that already exists (created directly, as an earlier phase
      // or a manual correction would leave it).
      const existing = await prisma.deal.create({
        data: { vehicleId, customerId: holderId, status: "OPEN", askingPriceCents: 1_899_500 },
        select: { id: true },
      });

      await expect(
        ops.completeVehicleSale(ctxFor("SALES"), { vehicleId, customerId: otherId, salePriceCents: 1_900_000 }),
      ).rejects.toBeInstanceOf(ConflictError);

      const result = await ops.completeVehicleSale(ctxFor("SALES"), {
        vehicleId,
        customerId: holderId,
        salePriceCents: 1_900_000,
      });
      expect(result.dealId).toBe(existing.id);
      expect((await prisma.deal.count({ where: { vehicleId } }))).toBe(1);
    });

    it("cancels a sale, releases the vehicle and clears the sold markers", async () => {
      const vehicleId = await publishableVehicle("OWNER", "sale9");
      const customerId = await makeCustomer("sale9", "5554000009");
      const sale = await ops.completeVehicleSale(ctxFor("SALES"), {
        vehicleId,
        customerId,
        salePriceCents: 1_950_000,
      });

      const cancelled = await ops.cancelDeal(ctxFor("MANAGER"), {
        dealId: sale.dealId,
        reason: "Financing fell through",
      });
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.vehicleStatus).toBe("LISTED");

      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(vehicle.status).toBe("LISTED");
      expect(vehicle.listingStatus).toBe("ACTIVE");
      expect(vehicle.finalSalePriceCents).toBeNull();
      expect(vehicle.dateSold).toBeNull();

      // With the live deal released, the car can be sold again, and the earlier
      // cancelled deal is kept as history.
      const resold = await ops.completeVehicleSale(ctxFor("SALES"), {
        vehicleId,
        customerId,
        salePriceCents: 1_875_000,
      });
      expect(resold.dealId).not.toBe(sale.dealId);
      expect(await prisma.deal.count({ where: { vehicleId } })).toBe(2);
    });

    it("reports the live deal for a vehicle", async () => {
      const vehicleId = await publishableVehicle("OWNER", "salea");
      const customerId = await makeCustomer("salea", "5554000010");
      const sale = await ops.completeVehicleSale(ctxFor("SALES"), {
        vehicleId,
        customerId,
        salePriceCents: 1_900_000,
      });

      const live = await ops.liveDealForVehicle(ctxFor("VIEWER"), vehicleId);
      expect(live?.id).toBe(sale.dealId);
      expect(live?.customerId).toBe(customerId);

      await ops.cancelDeal(ctxFor("MANAGER"), { dealId: sale.dealId });
      expect(await ops.liveDealForVehicle(ctxFor("VIEWER"), vehicleId)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // The loop, end to end
  // -------------------------------------------------------------------------

  describe("the complete operating loop", () => {
    it("runs OPPORTUNITY -> BUY -> ACQUIRE -> PUBLISH -> LEAD -> SELL -> PROFIT", async () => {
      const owner = ctxFor("OWNER");
      const suffix = "loop1";

      // 1-2. Opportunity, analysed by the canonical engine.
      const candidate = await ops.createSourcingCandidate(owner, {
        ...BASE_OPPORTUNITY,
        vin: opVin(suffix),
      });
      candidates.push(candidate.candidateId);
      expect(candidate.evaluation.recommendation).toBe("BUY");

      // 3. BUY decision.
      await ops.recordSourcingDecision(owner, candidate.candidateId, { status: "APPROVED_TO_BUY" });

      // 4-5. Acquire, recording the real costs.
      const acquired = await ops.acquireVehicleFromCandidate(owner, {
        candidateId: candidate.candidateId,
        vehicle: {
          vin: opVin(suffix),
          year: 2019,
          make: "Toyota",
          model: "Camry",
          mileage: 68_000,
          stockNumber: `SN-${RUN_TAG}-LOOP1`.toUpperCase(),
        },
        acquisition: {
          source: "AUCTION",
          purchasePriceCents: 1_450_000,
          auctionFeesCents: 45_000,
          transportationCents: 32_000,
          inspectionCents: 9_500,
          otherCents: 5_000,
        },
        pricing: { targetRetailPriceCents: 1_999_500, askingPriceCents: 1_899_500 },
      });
      const vehicleId = acquired.vehicle.id;
      vehicles.push(vehicleId);

      // 6-8. Recondition, prepare, publish.
      await ops.recordReconItem(ctxFor("RECON"), { vehicleId, issue: "Brakes", estimateCents: 120_000 });
      await prepareForRetail("OWNER", vehicleId);
      const published = await ops.publishVehicle(owner, vehicleId);
      expect(published.listingStatus).toBe("ACTIVE");

      // 9-10. Lead arrives and is worked.
      const lead = await ops.createLead(ctxFor("SALES"), {
        customer: { firstName: "Loop", lastName: "Buyer", phone: "5555000001" },
        vehicleId,
        source: "WEBSITE_INQUIRY",
      });
      leads.push(lead.id);
      customers.push(lead.customer.id);
      await ops.updateLeadStatus(ctxFor("SALES"), { leadId: lead.id, status: "CONTACTED" });
      const won = await ops.updateLeadStatus(ctxFor("SALES"), { leadId: lead.id, status: "WON" });
      expect(won.status).toBe("WON");

      // 11-14. Deal, sale, final price, actual profit.
      const sale = await ops.completeVehicleSale(ctxFor("MANAGER"), {
        vehicleId,
        customerId: lead.customer.id,
        leadId: lead.id,
        salePriceCents: 1_950_000,
        financeType: "CASH",
      });

      expect(sale.vehicleStatus).toBe("SOLD");
      // 1_541_500 acquisition + 120_000 recon (the loop records no other expense).
      expect(sale.landedCostCents).toBe(1_661_500);
      expect(sale.actualGrossProfitCents).toBe(288_500);
      expect(sale.actualRoiBasisPoints).toBe(1_736);
      expect(sale.daysInInventory).toBe(0); // acquired today

      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: sale.dealId } });
      expect(deal.leadId).toBe(lead.id);
      expect(deal.financeType).toBe("CASH");
    });
  });
});
