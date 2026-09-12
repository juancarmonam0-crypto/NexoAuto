import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, UserRole } from "@/generated/prisma";
import { AuthorizationError } from "@/lib/auth/errors";
import { ConflictError } from "@/lib/domain-errors";
import {
  computeActualGrossProfit,
  computeDaysInInventory,
  computeRoiBasisPoints,
} from "@/lib/economics";
import { InvalidLeadTransitionError } from "@/lib/lead-status";
import * as ops from "@/lib/operations";
import type { OperationContext } from "@/lib/operations";
import { getDealerSettings } from "@/lib/settings";
import { LOCAL_UPLOAD_ROOT } from "@/lib/storage";
import { InvalidVehicleTransitionError, isPubliclyVisible } from "@/lib/vehicle-status";
import {
  assertMigrated,
  cleanupRun,
  createClient,
  databaseConfigured,
  expectRejected,
  id,
  RUN_TAG,
} from "./helpers";

/**
 * PHASE 5 — the dealer vertical slice on real PostgreSQL.
 *
 *   SOURCE -> BUY -> INVENTORY -> PUBLISH -> LEAD -> SELL -> PROFIT
 *
 * The first describe block is a single business story told in chapters, using
 * only the Phase 4 public operations — exactly what a future server action or UI
 * will call. The chapters run in order and share one vehicle; a failure early in
 * the story will also fail the later chapters, and that is deliberate: the point
 * is that the loop as a whole holds together.
 *
 * Everything after the story is independent: cross-module failure paths and
 * explicit transactional rollback proofs, each building its own fixtures.
 *
 * NOTHING here reaches into Prisma to perform a BUSINESS write. Prisma and raw
 * SQL are used only to (a) read the public views, which no operation exposes
 * because the catalog is served by PostgREST/Supabase, and (b) probe database
 * constraints directly, which is the point of those assertions.
 */

const ROLES: UserRole[] = ["OWNER", "MANAGER", "SALES", "RECON", "VIEWER"];

/** A VIN the decoder rule accepts: 11-17 chars, no I, O or Q. */
function opVin(suffix: string): string {
  const safe = (value: string) => value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "X");
  const body = `1HG${safe(RUN_TAG)}${safe(suffix).slice(0, 6)}0000`;
  const trimmed = body.slice(0, 17);
  return trimmed.length >= 11 ? trimmed : trimmed.padEnd(11, "0");
}

/** Fixed dates so days-in-inventory is deterministic (2026 is not a leap year). */
const ACQUIRED_ON = new Date(Date.UTC(2026, 0, 15));
const SOLD_ON = new Date(Date.UTC(2026, 2, 6));
const EXPECTED_DAYS_IN_INVENTORY = 50; // Jan 15 -> Mar 6

/** The 27 columns the public catalog view is allowed to project. */
const PUBLIC_LISTING_COLUMNS = [
  "id",
  "stockNumber",
  "vin",
  "year",
  "make",
  "model",
  "trim",
  "mileage",
  "exteriorColor",
  "interiorColor",
  "transmission",
  "drivetrain",
  "engine",
  "fuelType",
  "bodyType",
  "doors",
  "seats",
  "titleStatus",
  "askingPriceCents",
  "description",
  "features",
  "location",
  "status",
  "dateListed",
  "dataOrigin",
  "createdAt",
  "updatedAt",
];

/** Values that must never appear in a public payload. */
const INTERNAL_AMOUNTS = [
  1_440_000, // acquisition price actually paid
  1_531_500, // acquisition block subtotal
  1_731_500, // actual landed cost
  1_800_000, // minimum approved price
  2_050_000, // internal target retail
  135_000, // recon actual
];

describe.skipIf(!databaseConfigured)("Phase 5 — dealer vertical slice (real PostgreSQL)", () => {
  let prisma: PrismaClient;
  const actorIds = new Map<UserRole, string>();

  const vehicles: string[] = [];
  const candidates: string[] = [];
  const customers: string[] = [];
  const leads: string[] = [];
  const photoKeys: string[] = [];

  /** State carried across the story chapters. */
  const story: {
    candidateId: string;
    evaluation: ReturnType<typeof ops.evaluateOpportunity> | null;
    vehicleId: string;
    leadId: string;
    customerId: string;
    saleDealId: string;
  } = { candidateId: "", evaluation: null, vehicleId: "", leadId: "", customerId: "", saleDealId: "" };

  function ctxFor(role: UserRole, overrideId?: string): OperationContext {
    const actorId = overrideId ?? actorIds.get(role);
    if (!actorId) throw new Error(`no fixture user for ${role}`);
    return {
      actor: {
        id: actorId,
        email: `${role.toLowerCase()}@dealer.test`,
        name: `${role} Fixture`,
        role,
      },
      db: prisma,
    };
  }

  const owner = () => ctxFor("OWNER");
  const manager = () => ctxFor("MANAGER");
  const sales = () => ctxFor("SALES");
  const recon = () => ctxFor("RECON");
  const viewer = () => ctxFor("VIEWER");

  async function publicListing(vehicleId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "public_vehicle_listings" WHERE id = $1`,
      vehicleId,
    );
    return rows[0] ?? null;
  }

  async function publicAvailability(vehicleId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ vehicle_id: string; availability: string }>>(
      `SELECT vehicle_id, availability FROM "public_vehicle_availability" WHERE vehicle_id = $1`,
      vehicleId,
    );
    return rows[0] ?? null;
  }

  async function publicPhotoCount(vehicleId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM "public_vehicle_photos" WHERE "vehicleId" = $1`,
      vehicleId,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async function makeCustomer(suffix: string, phone: string): Promise<string> {
    const created = await prisma.customer.create({
      data: { id: id(`cust_${suffix}`), firstName: "Fixture", lastName: suffix, phone },
      select: { id: true },
    });
    customers.push(created.id);
    return created.id;
  }

  /** Creates an opportunity and approves it. Returns the candidate id. */
  async function approvedCandidate(suffix: string, patch: Record<string, unknown> = {}) {
    const created = await ops.createSourcingCandidate(owner(), {
      source: "AUCTION_FEED",
      vin: opVin(suffix),
      year: 2019,
      make: "Toyota",
      model: "Camry",
      mileage: 68_000,
      askingPriceCents: 1_450_000,
      expectedAuctionFeesCents: 45_000,
      transportEstimateCents: 32_000,
      estimatedReconCents: 120_000,
      estimatedRetailCents: 1_899_500,
      ...patch,
    });
    candidates.push(created.candidateId);
    await ops.recordSourcingDecision(owner(), created.candidateId, { status: "APPROVED_TO_BUY" });
    return created.candidateId;
  }

  /** Acquires a vehicle from an approved candidate and returns its id. */
  async function acquiredVehicle(suffix: string) {
    const candidateId = await approvedCandidate(suffix);
    const result = await ops.acquireVehicleFromCandidate(owner(), {
      candidateId,
      vehicle: {
        vin: opVin(suffix),
        year: 2019,
        make: "Toyota",
        model: "Camry",
        mileage: 68_000,
        stockNumber: `SN-${RUN_TAG}-${suffix}`.toUpperCase(),
      },
      acquisition: { source: "AUCTION", date: ACQUIRED_ON, purchasePriceCents: 1_440_000 },
    });
    vehicles.push(result.vehicle.id);
    return result.vehicle.id;
  }

  /** Drives a vehicle to READY and publishes it. Returns the vehicle id. */
  async function publishedVehicle(suffix: string, askingPriceCents = 1_899_500) {
    const vehicleId = await acquiredVehicle(suffix);
    await ops.updateVehiclePricing(manager(), vehicleId, { askingPriceCents });
    for (const toStatus of ["INSPECTION", "RECONDITIONING", "READY"] as const) {
      await ops.transitionVehicleStatus(owner(), { vehicleId, toStatus });
    }
    await ops.publishVehicle(manager(), vehicleId);
    return vehicleId;
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

    const settings = await getDealerSettings(prisma);
    expect(settings.minGrossProfitCents).toBe(150_000);
    expect(settings.minRoiBasisPoints).toBe(1_000);
  });

  afterAll(async () => {
    if (!prisma) return;
    const byVehicle = { vehicleId: { in: vehicles } };
    const byCustomer = { customerId: { in: customers } };

    // ORDER MATTERS, and so does batching.
    //
    // `deleteMany` is a SINGLE statement: if one row in the batch is still
    // referenced by a RESTRICT foreign key, the whole statement fails. The
    // reservation inserted by failure-path E references both a vehicle and a
    // customer with RESTRICT, so deleting vehicles before reservations would
    // abort both batches and silently leak every fixture of the run.
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: leads } } }).catch(() => 0);
    await prisma.lead.deleteMany({ where: { OR: [{ id: { in: leads } }, byVehicle] } }).catch(() => 0);
    await prisma.reservation.deleteMany({ where: { OR: [byVehicle, byCustomer] } }).catch(() => 0);
    await prisma.deal.deleteMany({ where: { OR: [byVehicle, byCustomer] } }).catch(() => 0);
    await prisma.dealDocument.deleteMany({ where: { OR: [byVehicle, byCustomer] } }).catch(() => 0);
    await prisma.testDriveRequest.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.savedVehicle.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.task.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.vehicleStatusEvent.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.vehicleReconItem.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.expense.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.vehiclePhoto.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.sourcingCandidate
      .deleteMany({ where: { OR: [{ id: { in: candidates } }, { purchasedVehicleId: { in: vehicles } }] } })
      .catch(() => 0);
    // Every vehicle this suite acquires carries the run tag in its stock number,
    // so the delete cannot miss one even if bookkeeping did.
    await prisma.vehicle
      .deleteMany({
        where: { OR: [{ id: { in: vehicles } }, { stockNumber: { startsWith: `SN-${RUN_TAG}` } }] },
      })
      .catch(() => 0);
    await prisma.customer.deleteMany({ where: { id: { in: customers } } }).catch(() => 0);
    // Raw fixtures from the failure-path block use run-prefixed ids.
    await cleanupRun(prisma);
    await prisma.dealerSettings.deleteMany({ where: { id: "singleton" } }).catch(() => 0);
    await Promise.all(
      photoKeys
        .filter(Boolean)
        .map((key) => rm(path.join(LOCAL_UPLOAD_ROOT, key), { force: true }).catch(() => 0)),
    );
    await prisma.$disconnect();
  });

  // ==========================================================================
  // THE STORY
  // ==========================================================================

  describe("1. FIND + ANALYZE — an opportunity is scored by the canonical engine", () => {
    it("persists the opportunity with its estimated economics and a BUY verdict", async () => {
      const created = await ops.createSourcingCandidate(owner(), {
        source: "AUCTION_FEED",
        vin: opVin("golden"),
        year: 2019,
        make: "Toyota",
        model: "Camry",
        trim: "SE",
        mileage: 68_000,
        listingUrl: "https://example.test/auction/lot-1234",
        listingTitle: "2019 Toyota Camry SE",
        sellerName: "Synthetic Auction House",
        location: "Dallas, TX",
        askingPriceCents: 1_450_000,
        expectedAuctionFeesCents: 45_000,
        transportEstimateCents: 32_000,
        estimatedReconCents: 120_000,
        estimatedRetailCents: 1_899_500,
      });
      story.candidateId = created.candidateId;
      story.evaluation = created.evaluation;
      candidates.push(created.candidateId);

      // Estimated economics, from the engine.
      expect(created.evaluation.landedCostCents).toBe(1_647_000);
      expect(created.evaluation.expectedProfitCents).toBe(252_500);
      expect(created.evaluation.expectedRoiBasisPoints).toBe(1_533);
      expect(created.evaluation.maxPurchasePriceCents).toBe(1_529_800);
      expect(created.evaluation.maxBidCents).toBe(created.evaluation.maxPurchasePriceCents);
      expect(created.evaluation.bindingConstraint).toBe("roi-floor");
      expect(created.evaluation.recommendation).toBe("BUY");

      // Persisted snapshot.
      expect(created.candidate.status).toBe("INBOX");
      expect(created.candidate.landedCostCents).toBe(1_647_000);
      expect(created.candidate.recommendation).toBe("BUY");
      expect(created.candidate.evaluatedAt).toBeInstanceOf(Date);
      expect(created.candidate.recommendationReasons.length).toBeGreaterThan(0);

      // The operation is a shell over the canonical engine, not a second one.
      expect(created.evaluation).toEqual(
        ops.evaluateOpportunity(
          {
            askingPriceCents: 1_450_000,
            expectedAuctionFeesCents: 45_000,
            transportEstimateCents: 32_000,
            estimatedReconCents: 120_000,
            estimatedRetailCents: 1_899_500,
            minGrossProfitCents: 150_000,
            minRoiBasisPoints: 1_000,
          },
          { minGrossProfitCents: 150_000, minRoiBasisPoints: 1_000 },
        ),
      );
    });
  });

  describe("2. BUY + ACQUIRE — the opportunity becomes owned inventory", () => {
    it("records the decision and creates the canonical vehicle", async () => {
      expect(story.candidateId).not.toBe("");

      const decided = await ops.recordSourcingDecision(owner(), story.candidateId, {
        status: "APPROVED_TO_BUY",
        notes: "Approved at the auction ceiling minus transport.",
      });
      expect(decided.status).toBe("APPROVED_TO_BUY");
      expect(decided.decidedAt).toBeInstanceOf(Date);

      const acquired = await ops.acquireVehicleFromCandidate(owner(), {
        candidateId: story.candidateId,
        vehicle: {
          vin: opVin("golden"),
          year: 2019,
          make: "Toyota",
          model: "Camry",
          trim: "SE",
          mileage: 68_000,
          stockNumber: `SN-${RUN_TAG}-GOLD`.toUpperCase(),
          titleStatus: "CLEAN",
          location: "Lot A",
        },
        acquisition: {
          source: "AUCTION",
          date: ACQUIRED_ON,
          // Negotiated below the asking price, so estimate and actual diverge.
          purchasePriceCents: 1_440_000,
          auctionFeesCents: 45_000,
          transportationCents: 32_000,
          inspectionCents: 9_500,
          otherCents: 5_000,
        },
      });
      story.vehicleId = acquired.vehicle.id;
      vehicles.push(acquired.vehicle.id);

      // Initial inventory state.
      expect(acquired.vehicle.status).toBe("PURCHASED");
      expect(acquired.vehicle.listingStatus).toBe("PAUSED");
      expect(acquired.vehicle.dataOrigin).toBe("REAL");
      expect(acquired.landedCost.landedCostCents).toBe(1_531_500);

      // Provenance: candidate <-> vehicle, and the first lifecycle event.
      const candidate = await prisma.sourcingCandidate.findUniqueOrThrow({
        where: { id: story.candidateId },
      });
      expect(candidate.status).toBe("PURCHASED");
      expect(candidate.purchasedVehicleId).toBe(story.vehicleId);

      const events = await prisma.vehicleStatusEvent.findMany({
        where: { vehicleId: story.vehicleId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.fromStatus).toBeNull();
      expect(events[0]?.toStatus).toBe("PURCHASED");

      // Internal inventory can see it; the public catalog cannot.
      const internal = await ops.listInventory(owner(), { status: "PURCHASED" });
      expect(internal.items.some((row) => row.id === story.vehicleId)).toBe(true);
      expect(await publicListing(story.vehicleId)).toBeNull();
    });
  });

  describe("3. COSTS — real recon and expense spend is recorded", () => {
    it("records reconditioning work with its real cost", async () => {
      const brakes = await ops.recordReconItem(recon(), {
        vehicleId: story.vehicleId,
        issue: "Front brake pads and rotors",
        vendor: "Synthetic Brake Shop",
        estimateCents: 120_000,
        actualCostCents: 135_000,
        status: "IN_PROGRESS",
        approvedByStaff: true,
      });
      expect(brakes.status).toBe("IN_PROGRESS");

      const completed = await ops.updateReconItem(recon(), brakes.id, {
        status: "COMPLETED",
        actualCostCents: 135_000,
      });
      expect(completed.status).toBe("COMPLETED");
      // `recon_completed_has_date` is satisfied automatically.
      expect(completed.completedAt).toBeInstanceOf(Date);

      await ops.recordReconItem(recon(), {
        vehicleId: story.vehicleId,
        issue: "Two tyres",
        estimateCents: 40_000,
        actualCostCents: 30_000,
        status: "COMPLETED",
      });
    });

    it("records vehicle expenses that are not acquisition costs", async () => {
      const detail = await ops.recordVehicleExpense(recon(), {
        vehicleId: story.vehicleId,
        category: "DETAIL",
        amountCents: 20_000,
        vendor: "Synthetic Detail Co",
      });
      expect(detail.amountCents).toBe(20_000);

      const title = await ops.recordVehicleExpense(recon(), {
        vehicleId: story.vehicleId,
        category: "TITLE_REGISTRATION",
        amountCents: 15_000,
      });
      expect(title.amountCents).toBe(15_000);
    });

    it("folds every real cost into one actual landed cost", async () => {
      const detail = await ops.getVehicleDetail(owner(), story.vehicleId);

      // 1_531_500 acquisition + 165_000 recon (actual) + 35_000 expenses.
      expect(detail.vehicle.landedCostCents).toBe(1_731_500);
      expect(detail.vehicle.landedCost?.reconCents).toBe(165_000);
      expect(detail.vehicle.landedCost?.additionalExpenseCents).toBe(35_000);
      expect(detail.vehicle.landedCost?.reconSource).toBe("recon-items");
      // Actual spend differs from what sourcing estimated (1_647_000).
      expect(detail.vehicle.landedCostCents).not.toBe(story.evaluation?.landedCostCents);
    });

    it("keeps the cost basis away from a salesperson and from recon", async () => {
      for (const ctx of [sales(), recon()]) {
        const detail = await ops.getVehicleDetail(ctx, story.vehicleId);
        expect(detail.vehicle.landedCostCents, `${ctx.actor.role} must not see landed cost`).toBeNull();
        expect(detail.vehicle.acquisitionPriceCents).toBeNull();
        // RECON may see the spend it recorded, SALES may not see expenses at all.
        if (ctx.actor.role === "SALES") expect(detail.expenses).toBeUndefined();
        else expect(detail.expenses?.length).toBe(2);
      }
    });
  });

  describe("4. PREPARE + PRICE — the car is finished and priced", () => {
    it("updates the details needed for a listing", async () => {
      const updated = await ops.updateVehicleDetails(recon(), story.vehicleId, {
        exteriorColor: "Silver",
        interiorColor: "Black",
        transmission: "Automatic",
        description: "One-owner sedan, freshly serviced, synthetic listing copy.",
        features: ["Backup camera", "Bluetooth", "Alloy wheels"],
        notes: "Internal: minor paint chip on the rear bumper. Do not mention publicly.",
      });
      expect(updated.exteriorColor).toBe("Silver");
      expect(updated.features).toHaveLength(3);
      expect(updated.notes).toContain("Internal:");
      // RECON can do inventory work but still cannot see the cost basis.
      expect(updated.landedCostCents).toBeNull();
    });

    it("sets the target, asking and minimum approved prices", async () => {
      const priced = await ops.updateVehiclePricing(manager(), story.vehicleId, {
        targetRetailPriceCents: 2_050_000,
        askingPriceCents: 1_999_500,
        minimumApprovedCents: 1_800_000,
      });
      expect(priced.askingPriceCents).toBe(1_999_500);
      expect(priced.minimumApprovedCents).toBe(1_800_000);
      expect(priced.negotiatingRoomCents).toBe(199_500);
      expect(priced.frontEndMarginCents).toBe(268_000);
    });

    it("walks the lifecycle to READY without exposing the car yet", async () => {
      for (const toStatus of ["INSPECTION", "RECONDITIONING", "READY"] as const) {
        const moved = await ops.transitionVehicleStatus(recon(), { vehicleId: story.vehicleId, toStatus });
        expect(moved.status).toBe(toStatus);
      }

      const ready = await ops.getVehicleDetail(owner(), story.vehicleId);
      expect(ready.vehicle.status).toBe("READY");
      expect(ready.vehicle.listingStatus).toBe("UNLISTED");
      expect(ready.publiclyVisible).toBe(false);
      expect(await publicListing(story.vehicleId)).toBeNull();
    });
  });

  describe("5. PUBLISH — the car reaches the public catalog safely", () => {
    it("publishes through the pricing authority", async () => {
      const published = await ops.publishVehicle(manager(), story.vehicleId);
      expect(published.status).toBe("LISTED");
      expect(published.listingStatus).toBe("ACTIVE");
      expect(published.dateListed).toBeInstanceOf(Date);
      expect(isPubliclyVisible(published.status)).toBe(true);
    });

    it("uploads a photo that the public photo view can serve", async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      const photo = await ops.uploadVehiclePhoto(owner(), {
        vehicleId: story.vehicleId,
        fileName: "front.png",
        declaredMimeType: "image/png",
        bytes: png,
        alt: "Front three-quarter",
      });
      if (photo.storagePath) photoKeys.push(photo.storagePath);
      expect(photo.isPrimary).toBe(true);
      expect(await publicPhotoCount(story.vehicleId)).toBe(1);
    });

    it("exposes the vehicle through the public listing view", async () => {
      const listing = await publicListing(story.vehicleId);
      expect(listing).not.toBeNull();
      expect(listing?.askingPriceCents).toBe(1_999_500);
      expect(listing?.status).toBe("LISTED");
      expect(listing?.dataOrigin).toBe("REAL");
      expect(listing?.mileage).toBe(68_000);
      expect(listing?.vin).toBe(opVin("golden"));

      const availability = await publicAvailability(story.vehicleId);
      expect(availability?.availability).toBe("AVAILABLE");
    });

    it("projects exactly the approved columns and nothing sensitive", async () => {
      const listing = await publicListing(story.vehicleId);
      expect(Object.keys(listing ?? {}).sort()).toEqual([...PUBLIC_LISTING_COLUMNS].sort());

      const forbidden = [
        "acquisitionPriceCents",
        "acquisitionSource",
        "acquisitionDate",
        "auctionFeesCents",
        "transportationCents",
        "inspectionCents",
        "otherAcquisitionCents",
        "reconOverrideCents",
        "minimumApprovedCents",
        "targetRetailPriceCents",
        "finalSalePriceCents",
        "notes",
        "trackerDeviceId",
        "trackerStatus",
        "trackerLastLatitude",
        "trackerLastLongitude",
        "trackerLastSeenAt",
        "trackerGeofenceState",
        "customerId",
        "leadId",
      ];
      for (const column of forbidden) {
        expect(listing, `public listing must not carry ${column}`).not.toHaveProperty(column);
      }
    });

    it("never leaks an internal amount or an internal note in the public payload", async () => {
      const listing = await publicListing(story.vehicleId);
      const serialized = JSON.stringify(listing);
      for (const amount of INTERNAL_AMOUNTS) {
        expect(serialized, `public payload leaked ${amount}`).not.toContain(String(amount));
      }
      expect(serialized).not.toContain("Synthetic Brake Shop");
      // `location` is a public column by design; `notes` is not.
      expect(serialized).not.toContain("minor paint chip");
      expect(listing?.location).toBe("Lot A");
    });
  });

  describe("6. LEAD — a buyer arrives and is worked", () => {
    it("creates the customer and lead against the published vehicle", async () => {
      const lead = await ops.createLead(sales(), {
        customer: {
          firstName: "Marisol",
          lastName: "Vega",
          phone: "5125550143",
          email: "marisol.vega@example.test",
          preferredContact: "TEXT",
        },
        vehicleId: story.vehicleId,
        source: "WEBSITE_INQUIRY",
        summary: "Asked whether the Camry is still available.",
      });
      story.leadId = lead.id;
      story.customerId = lead.customer.id;
      leads.push(lead.id);
      customers.push(lead.customer.id);

      expect(lead.status).toBe("NEW");
      expect(lead.vehicleId).toBe(story.vehicleId);
      expect(lead.customer.phone).toBe("5125550143");
    });

    it("advances NEW -> CONTACTED -> APPOINTMENT with recorded history", async () => {
      const contacted = await ops.updateLeadStatus(sales(), {
        leadId: story.leadId,
        status: "CONTACTED",
        note: "Texted availability.",
      });
      expect(contacted.status).toBe("CONTACTED");
      expect(contacted.lastContactedAt).toBeInstanceOf(Date);

      const appointment = await ops.updateLeadStatus(sales(), {
        leadId: story.leadId,
        status: "APPOINTMENT",
        note: "Coming Saturday 10:00.",
      });
      expect(appointment.status).toBe("APPOINTMENT");

      const detail = await ops.getLead(sales(), story.leadId);
      const changes = detail.activities.filter((row) => row.type === "STATUS_CHANGE");
      expect(changes).toHaveLength(2);
      expect(changes.every((row) => row.createdById === actorIds.get("SALES"))).toBe(true);
    });

    it("lets SALES quote the car while still hiding the cost basis", async () => {
      const detail = await ops.getVehicleDetail(sales(), story.vehicleId);
      expect(detail.vehicle.askingPriceCents).toBe(1_999_500);
      expect(detail.vehicle.estimatedGrossProfitCents).toBeNull();
      expect(detail.vehicle.landedCostCents).toBeNull();
      expect(detail.vehicle.negotiatingRoomCents).toBeNull();
      expect(detail.vehicle.minimumApprovedCents).toBeNull();
      // Tracker data is gated by tracker:read, which SALES does not hold.
      expect(detail.vehicle.trackerDeviceId).toBeNull();
      expect(detail.vehicle.trackerLastLatitude).toBeNull();
    });
  });

  describe("7. SELL — the vehicle is sold and leaves active inventory", () => {
    it("completes the sale through the sales operation", async () => {
      const sale = await ops.completeVehicleSale(sales(), {
        vehicleId: story.vehicleId,
        customerId: story.customerId,
        leadId: story.leadId,
        salePriceCents: 1_950_000,
        financeType: "CASH",
        saleDate: SOLD_ON,
      });
      story.saleDealId = sale.dealId;

      expect(sale.dealStatus).toBe("CONTRACTED");
      expect(sale.vehicleStatus).toBe("SOLD");
      expect(sale.finalSalePriceCents).toBe(1_950_000);
      expect(sale.daysInInventory).toBe(EXPECTED_DAYS_IN_INVENTORY);
      // A salesperson completes the sale without being handed the cost basis.
      expect(sale.landedCostCents).toBeNull();
      expect(sale.actualGrossProfitCents).toBeNull();
      expect(sale.actualRoiBasisPoints).toBeNull();
    });

    it("records the final price and date on the vehicle", async () => {
      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: story.vehicleId } });
      expect(vehicle.status).toBe("SOLD");
      expect(vehicle.listingStatus).toBe("SOLD");
      expect(vehicle.finalSalePriceCents).toBe(1_950_000);
      expect(vehicle.dateSold?.toISOString()).toBe(SOLD_ON.toISOString());
    });

    it("keeps lead, deal, customer and vehicle coherently linked", async () => {
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: story.saleDealId } });
      expect(deal.status).toBe("CONTRACTED");
      expect(deal.vehicleId).toBe(story.vehicleId);
      expect(deal.customerId).toBe(story.customerId);
      expect(deal.leadId).toBe(story.leadId);
      expect(deal.salePriceCents).toBe(1_950_000);
      expect(deal.saleDate?.toISOString()).toBe(SOLD_ON.toISOString());
      expect(deal.salespersonId).toBe(actorIds.get("SALES"));
      expect(deal.financeType).toBe("CASH");

      const won = await ops.updateLeadStatus(sales(), {
        leadId: story.leadId,
        status: "WON",
        note: "Sold for 19,500 dollars.",
      });
      expect(won.status).toBe("WON");

      // One live deal for the vehicle, and the sale event is on the record.
      expect(await prisma.deal.count({ where: { vehicleId: story.vehicleId } })).toBe(1);
      const soldEvents = await prisma.vehicleStatusEvent.findMany({
        where: { vehicleId: story.vehicleId, toStatus: "SOLD" },
      });
      expect(soldEvents).toHaveLength(1);
      expect(soldEvents[0]?.fromStatus).toBe("LISTED");
    });

    it("removes the vehicle from active public inventory", async () => {
      expect(await publicListing(story.vehicleId)).toBeNull();
      expect(await publicAvailability(story.vehicleId)).toBeNull();
      expect(await publicPhotoCount(story.vehicleId)).toBe(0);
    });
  });

  describe("8. PROFIT — actual economics come from the canonical engine", () => {
    it("reports actual landed cost, gross profit, ROI and days in inventory", async () => {
      const detail = await ops.getVehicleDetail(owner(), story.vehicleId);
      const vehicle = detail.vehicle;

      expect(vehicle.landedCostCents).toBe(1_731_500);
      expect(vehicle.actualGrossProfitCents).toBe(218_500);
      expect(vehicle.actualRoiBasisPoints).toBe(1_262);
      expect(vehicle.daysInInventory).toBe(EXPECTED_DAYS_IN_INVENTORY);
      expect(vehicle.isSold).toBe(true);
      expect(vehicle.finalSalePriceCents).toBe(1_950_000);
    });

    it("proves ACTUAL GROSS = FINAL SALE PRICE - ACTUAL LANDED COST via the engine", async () => {
      const { vehicle } = await ops.getVehicleDetail(owner(), story.vehicleId);
      const finalSalePriceCents = vehicle.finalSalePriceCents as number;
      const landedCostCents = vehicle.landedCostCents as number;

      // The engine's own functions, not a formula written for this test.
      expect(vehicle.actualGrossProfitCents).toBe(
        computeActualGrossProfit(finalSalePriceCents, landedCostCents),
      );
      expect(vehicle.actualRoiBasisPoints).toBe(
        computeRoiBasisPoints(vehicle.actualGrossProfitCents as number, landedCostCents),
      );
      expect(vehicle.daysInInventory).toBe(computeDaysInInventory(ACQUIRED_ON, SOLD_ON));

      // And the arithmetic the dealership will read off the screen.
      expect(finalSalePriceCents - landedCostCents).toBe(218_500);
    });

    it("preserves the distinction between estimated and actual economics", async () => {
      const { vehicle } = await ops.getVehicleDetail(owner(), story.vehicleId);

      // Estimate: today's target retail against today's landed cost.
      expect(vehicle.expectedSalePriceCents).toBe(2_050_000);
      expect(vehicle.expectedSalePriceSource).toBe("target");
      expect(vehicle.estimatedGrossProfitCents).toBe(318_500);
      expect(vehicle.estimatedRoiBasisPoints).toBe(1_839);

      // Actual: what the car really sold for against what it really cost.
      expect(vehicle.actualGrossProfitCents).toBe(218_500);
      expect(vehicle.actualRoiBasisPoints).toBe(1_262);

      // The two are never collapsed into one number.
      expect(vehicle.estimatedGrossProfitCents).not.toBe(vehicle.actualGrossProfitCents);
      expect(vehicle.estimatedRoiBasisPoints).not.toBe(vehicle.actualRoiBasisPoints);
    });

    it("leaves the sourcing snapshot untouched as a historical estimate", async () => {
      const candidate = await ops.getSourcingCandidate(manager(), story.candidateId);

      // The evaluation the operator approved is still exactly that.
      expect(candidate.landedCostCents).toBe(1_647_000);
      expect(candidate.expectedProfitCents).toBe(252_500);
      expect(candidate.expectedRoiBasisPoints).toBe(1_533);
      expect(candidate.maxPurchasePriceCents).toBe(1_529_800);
      expect(candidate.recommendation).toBe("BUY");
      expect(candidate.status).toBe("PURCHASED");
      expect(candidate.purchasedVehicleId).toBe(story.vehicleId);

      // Estimated at sourcing, actual on the vehicle: different numbers, both kept.
      const { vehicle } = await ops.getVehicleDetail(owner(), story.vehicleId);
      expect(candidate.landedCostCents).not.toBe(vehicle.landedCostCents);
      expect(candidate.expectedProfitCents).not.toBe(vehicle.actualGrossProfitCents);
    });
  });

  // ==========================================================================
  // ROLE / MASKING CONTINUITY
  // ==========================================================================

  describe("9. ROLES — capabilities hold across the workflow", () => {
    it("keeps RECON out of financial authority", async () => {
      const vehicleId = await acquiredVehicle("roles1");

      await expect(
        ops.updateVehiclePricing(recon(), vehicleId, { askingPriceCents: 1_000_000 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(ops.publishVehicle(recon(), vehicleId)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        ops.updateVehicleAcquisition(recon(), vehicleId, { acquisitionPriceCents: 1 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        ops.acquireVehicleFromCandidate(recon(), {
          candidateId: "anything",
          vehicle: { vin: opVin("roles1"), year: 2019, make: "Toyota", model: "Camry", mileage: 1 },
          acquisition: { source: "AUCTION", purchasePriceCents: 1 },
        }),
      ).rejects.toBeInstanceOf(AuthorizationError);

      // RECON's legitimate work still succeeds.
      const expense = await ops.recordVehicleExpense(recon(), {
        vehicleId,
        category: "PARTS",
        amountCents: 5_000,
      });
      expect(expense.amountCents).toBe(5_000);
    });

    it("stops VIEWER from mutating dealer state at all", async () => {
      const vehicleId = await acquiredVehicle("roles2");

      await expect(
        ops.updateVehicleDetails(viewer(), vehicleId, { mileage: 1 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        ops.recordVehicleExpense(viewer(), { vehicleId, category: "PARTS", amountCents: 100 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        ops.createLead(viewer(), { customer: { firstName: "No", phone: "5550000000" } }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        ops.completeVehicleSale(viewer(), { vehicleId, customerId: "x", salePriceCents: 100 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        ops.createSourcingCandidate(viewer(), {
          askingPriceCents: 1,
          estimatedRetailCents: 2,
        }),
      ).rejects.toBeInstanceOf(AuthorizationError);

      // VIEWER can still read.
      const detail = await ops.getVehicleDetail(viewer(), vehicleId);
      expect(detail.vehicle.mileage).toBe(68_000);
      expect(detail.vehicle.landedCostCents).toBeNull();
    });
  });

  // ==========================================================================
  // FAILURE PATHS
  // ==========================================================================

  describe("10. FAILURE PATHS — cross-module rejection", () => {
    it("A. refuses to acquire a candidate that was never approved", async () => {
      const created = await ops.createSourcingCandidate(owner(), {
        source: "MANUAL_ENTRY",
        vin: opVin("faila"),
        askingPriceCents: 1_000_000,
        estimatedRetailCents: 1_500_000,
      });
      candidates.push(created.candidateId);

      await expect(
        ops.acquireVehicleFromCandidate(owner(), {
          candidateId: created.candidateId,
          vehicle: { vin: opVin("faila"), year: 2019, make: "Toyota", model: "Camry", mileage: 1 },
          acquisition: { source: "PRIVATE_PARTY", purchasePriceCents: 1_000_000 },
        }),
      ).rejects.toBeInstanceOf(ConflictError);

      const candidate = await prisma.sourcingCandidate.findUniqueOrThrow({
        where: { id: created.candidateId },
      });
      expect(candidate.status).toBe("INBOX");
      expect(candidate.purchasedVehicleId).toBeNull();
      expect(await prisma.vehicle.count({ where: { vin: opVin("faila") } })).toBe(0);
    });

    it("B. refuses to make an unprepared vehicle public", async () => {
      const vehicleId = await acquiredVehicle("failb");

      // The price gate fires before the lifecycle gate: a car with no asking
      // price can never be published, whatever its status.
      await expect(ops.publishVehicle(manager(), vehicleId)).rejects.toBeInstanceOf(ConflictError);

      // With a price, the lifecycle still forbids jumping straight to LISTED.
      await ops.updateVehiclePricing(manager(), vehicleId, { askingPriceCents: 1_899_500 });
      await expect(ops.publishVehicle(manager(), vehicleId)).rejects.toBeInstanceOf(
        InvalidVehicleTransitionError,
      );
      expect(await publicListing(vehicleId)).toBeNull();

      // Even a forced ACTIVE flag cannot publish a car that is not LISTED.
      await prisma.vehicle.update({
        where: { id: vehicleId },
        data: { listingStatus: "ACTIVE", askingPriceCents: 1_899_500 },
      });
      expect(await publicListing(vehicleId)).toBeNull();
    });

    it("C. refuses a sale with invalid or missing economics", async () => {
      const vehicleId = await publishedVehicle("failc");
      const customerId = await makeCustomer("failc", "5557000001");

      for (const salePriceCents of [0, -1, 1_950_000.5]) {
        await expect(
          ops.completeVehicleSale(manager(), { vehicleId, customerId, salePriceCents }),
        ).rejects.toBeTruthy();
      }

      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(vehicle.status).toBe("LISTED");
      expect(vehicle.finalSalePriceCents).toBeNull();
      expect(await prisma.deal.count({ where: { vehicleId } })).toBe(0);

      // The database is the last line of defence for the same rule.
      await expectRejected(
        prisma,
        `UPDATE "vehicles" SET "status"='SOLD' WHERE "id"='${vehicleId}'`,
        /vehicles_sold_requires_final_price/,
        "a sold vehicle with no final sale price",
        "23514",
      );
      await expectRejected(
        prisma,
        `INSERT INTO "deals" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("bad_deal")}','${vehicleId}','${customerId}','CONTRACTED',now())`,
        /deals_contracted_requires_sale_price/,
        "a contracted deal with no sale price",
        "23514",
      );
    });

    it("D. rejects a second live deal for the same vehicle at the database level", async () => {
      const vehicleId = await publishedVehicle("faild");
      const first = await makeCustomer("faild1", "5557000002");
      const second = await makeCustomer("faild2", "5557000003");

      await prisma.$executeRawUnsafe(
        `INSERT INTO "deals" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("deal_live")}','${vehicleId}','${first}','OPEN',now())`,
      );

      await expectRejected(
        prisma,
        `INSERT INTO "deals" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("deal_live2")}','${vehicleId}','${second}','OPEN',now())`,
        // The index name is not echoed back by PostgreSQL for a unique
        // violation, so the SQLSTATE plus the offending key is the strongest
        // available assertion (same convention as the Phase 3 integrity suite).
        /Key \("vehicleId"\)=/,
        "a second live deal on one vehicle",
        "23505",
      );

      // A cancelled deal releases the vehicle, which is what cancelDeal does.
      await prisma.$executeRawUnsafe(
        `UPDATE "deals" SET "status"='CANCELLED' WHERE "id"='${id("deal_live")}'`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "deals" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("deal_live3")}','${vehicleId}','${second}','OPEN',now())`,
      );
      expect(await prisma.deal.count({ where: { vehicleId, status: { not: "CANCELLED" } } })).toBe(1);
    });

    it("E. rejects a second active reservation at the database level", async () => {
      // No reservation workflow exists in this phase; this is a direct probe of
      // the Phase 3 constraint that protects the same double-sell.
      const vehicleId = await publishedVehicle("faile");
      const first = await makeCustomer("faile1", "5557000004");
      const second = await makeCustomer("faile2", "5557000005");

      await prisma.$executeRawUnsafe(
        `INSERT INTO "reservations" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("res_active")}','${vehicleId}','${first}','ACTIVE',now())`,
      );

      await expectRejected(
        prisma,
        `INSERT INTO "reservations" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("res_active2")}','${vehicleId}','${second}','ACTIVE',now())`,
        /Key \("vehicleId"\)=/,
        "a second active reservation on one vehicle",
        "23505",
      );
    });

    it("F. leaves no partial state when the sale transaction fails late", async () => {
      const vehicleId = await publishedVehicle("failf");
      const customerId = await makeCustomer("failf", "5557000006");

      // A live deal held by the same buyer, so the sale REUSES it: the deal
      // update and the vehicle update both succeed before the failure lands.
      const live = await prisma.deal.create({
        data: { vehicleId, customerId, status: "OPEN", salespersonId: actorIds.get("SALES") },
        select: { id: true },
      });

      // A well-formed actor whose user row does not exist. The status event's
      // foreign key is the LAST statement in the sale transaction, so this
      // forces a failure after two writes have already happened.
      const ghost = ctxFor("MANAGER", id("ghost_user"));
      await expect(
        ops.completeVehicleSale(ghost, {
          vehicleId,
          customerId,
          salePriceCents: 1_950_000,
          saleDate: SOLD_ON,
        }),
      ).rejects.toBeTruthy();

      // Neither write survived.
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: live.id } });
      expect(deal.status).toBe("OPEN");
      expect(deal.salePriceCents).toBeNull();
      expect(deal.saleDate).toBeNull();

      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(vehicle.status).toBe("LISTED");
      expect(vehicle.listingStatus).toBe("ACTIVE");
      expect(vehicle.finalSalePriceCents).toBeNull();
      expect(vehicle.dateSold).toBeNull();
      expect(
        await prisma.vehicleStatusEvent.count({ where: { vehicleId, toStatus: "SOLD" } }),
      ).toBe(0);
      // The car is still sellable and still public.
      expect(await publicListing(vehicleId)).not.toBeNull();
    });

    it("G. refuses an unauthorized actor even when the service is called directly", async () => {
      const vehicleId = await publishedVehicle("failg");
      const customerId = await makeCustomer("failg", "5557000007");

      await expect(
        ops.completeVehicleSale(recon(), { vehicleId, customerId, salePriceCents: 1_900_000 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        ops.completeVehicleSale(viewer(), { vehicleId, customerId, salePriceCents: 1_900_000 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        ops.recordSourcingDecision(sales(), story.candidateId, { status: "PASSED" }),
      ).rejects.toBeInstanceOf(AuthorizationError);

      // Nothing moved: no deal, still listed, still public.
      expect(await prisma.deal.count({ where: { vehicleId } })).toBe(0);
      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(vehicle.status).toBe("LISTED");
      expect(vehicle.finalSalePriceCents).toBeNull();
      expect(await publicListing(vehicleId)).not.toBeNull();
    });

    it("H. refuses to republish a sold vehicle through the generic operations", async () => {
      const vehicleId = await publishedVehicle("failh");
      const customerId = await makeCustomer("failh", "5557000008");
      await ops.completeVehicleSale(manager(), {
        vehicleId,
        customerId,
        salePriceCents: 1_900_000,
        saleDate: SOLD_ON,
      });

      await expect(ops.publishVehicle(manager(), vehicleId)).rejects.toBeInstanceOf(ConflictError);
      await expect(
        ops.transitionVehicleStatus(manager(), { vehicleId, toStatus: "LISTED" }),
      ).rejects.toBeInstanceOf(ConflictError);

      // Still sold, still absent from the catalog.
      const stillSold = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(stillSold.status).toBe("SOLD");
      expect(await publicListing(vehicleId)).toBeNull();

      // The sanctioned path works, so the guard is not a dead end.
      const deal = await prisma.deal.findFirstOrThrow({ where: { vehicleId } });
      await ops.cancelDeal(manager(), { dealId: deal.id, reason: "Buyer financing fell through" });
      const reopened = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(reopened.status).toBe("LISTED");
      expect(reopened.finalSalePriceCents).toBeNull();
      expect(await publicListing(vehicleId)).not.toBeNull();
    });

    it("I. refuses a lead transition the state machine forbids", async () => {
      const lead = await ops.createLead(sales(), {
        customer: { firstName: "Skip", phone: "5557000009" },
      });
      leads.push(lead.id);
      customers.push(lead.customer.id);

      await expect(
        ops.updateLeadStatus(sales(), { leadId: lead.id, status: "APPOINTMENT" }),
      ).rejects.toBeInstanceOf(InvalidLeadTransitionError);
    });
  });

  // ==========================================================================
  // TRANSACTIONAL PROOF
  // ==========================================================================

  describe("11. TRANSACTIONS — multi-write workflows are atomic", () => {
    it("rolls the whole acquisition back when the final write fails", async () => {
      const candidateId = await approvedCandidate("txn1");
      const vin = opVin("txn1");

      // Valid role, nonexistent user row: the lifecycle-event foreign key is the
      // last statement in the acquisition transaction.
      const ghost = ctxFor("OWNER", id("ghost_owner"));
      await expect(
        ops.acquireVehicleFromCandidate(ghost, {
          candidateId,
          vehicle: { vin, year: 2019, make: "Toyota", model: "Camry", mileage: 68_000 },
          acquisition: { source: "AUCTION", purchasePriceCents: 1_440_000 },
        }),
      ).rejects.toBeTruthy();

      // Neither half of the transaction survived.
      expect(await prisma.vehicle.count({ where: { vin } })).toBe(0);
      const candidate = await prisma.sourcingCandidate.findUniqueOrThrow({ where: { id: candidateId } });
      expect(candidate.status).toBe("APPROVED_TO_BUY");
      expect(candidate.purchasedVehicleId).toBeNull();
      expect(candidate.decidedById).toBe(actorIds.get("OWNER"));
    });

    it("keeps the acquisition atomic under a duplicate VIN", async () => {
      const first = await ops.acquireVehicleFromCandidate(owner(), {
        candidateId: await approvedCandidate("txn2a"),
        vehicle: { vin: opVin("txn2a"), year: 2019, make: "Toyota", model: "Camry", mileage: 1 },
        acquisition: { source: "AUCTION", purchasePriceCents: 1_440_000 },
      });
      vehicles.push(first.vehicle.id);

      const secondCandidate = await approvedCandidate("txn2b");
      await expect(
        ops.acquireVehicleFromCandidate(owner(), {
          candidateId: secondCandidate,
          vehicle: { vin: opVin("txn2a"), year: 2020, make: "Honda", model: "Civic", mileage: 1 },
          acquisition: { source: "AUCTION", purchasePriceCents: 100 },
        }),
      ).rejects.toBeInstanceOf(ConflictError);

      const candidate = await prisma.sourcingCandidate.findUniqueOrThrow({ where: { id: secondCandidate } });
      expect(candidate.status).toBe("APPROVED_TO_BUY");
      expect(candidate.purchasedVehicleId).toBeNull();
      expect(await prisma.vehicle.count({ where: { make: "Honda", model: "Civic" } })).toBe(0);
    });

    it("never leaves a vehicle SOLD without a contracted deal", async () => {
      const vehicleId = await publishedVehicle("txn3");
      const customerId = await makeCustomer("txn3", "5557000010");
      const sale = await ops.completeVehicleSale(manager(), {
        vehicleId,
        customerId,
        salePriceCents: 1_950_000,
        saleDate: SOLD_ON,
      });

      expect(await prisma.vehicle.count({ where: { id: vehicleId, status: "SOLD" } })).toBe(1);
      expect(await prisma.deal.count({ where: { id: sale.dealId, status: "CONTRACTED" } })).toBe(1);
      expect(await prisma.vehicle.count({ where: { id: vehicleId, finalSalePriceCents: null } })).toBe(0);
    });
  });
});
