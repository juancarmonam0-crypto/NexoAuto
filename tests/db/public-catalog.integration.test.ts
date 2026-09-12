import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma";
import { getPublicDealerInfo, getPublicVehicle, listPublicInventory } from "@/lib/public-catalog";
import { cleanupRun, createClient, databaseConfigured, id, RUN_TAG, vehicleInsert } from "./helpers";

/**
 * The PUBLIC catalog contract, against real PostgreSQL.
 *
 * This proves the anonymous read path end to end: the module queries the
 * approved views from migration 0003, so what comes back is the projection the
 * database itself defines — not an internal row with fields hidden afterwards.
 *
 * The interesting assertions are the negative ones: a sold or unpublished car is
 * indistinguishable from a wrong URL, and no internal amount can appear in the
 * payload because those columns do not exist in the view.
 */

const LISTING_COLUMNS = [
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

/** Amounts that exist only on internal records. */
const INTERNAL_AMOUNTS = [1_440_000, 1_800_000, 2_050_000, 1_950_000, 135_000];

describe.skipIf(!databaseConfigured)("public catalog boundary (real PostgreSQL)", () => {
  let prisma: PrismaClient;

  const listed = id("pclisted");
  const reserved = id("pcreserved");
  const sold = id("pcsold");
  const readyActive = id("pcready");
  const purchased = id("pcpurchased");

  beforeAll(async () => {
    prisma = createClient();

    await prisma.$executeRawUnsafe(
      vehicleInsert("pclisted", {
        status: "'LISTED'",
        listingStatus: "'ACTIVE'",
        askingPriceCents: "1899500",
        targetRetailPriceCents: "2050000",
        minimumApprovedCents: "1800000",
        acquisitionPriceCents: "1440000",
        reconOverrideCents: "135000",
        notes: "'Internal: minor paint chip. Never publish this sentence.'",
        description: "'Synthetic listing copy for the public detail page.'",
        location: "'Lot A'",
        features: "ARRAY['Backup camera','Bluetooth']",
        trackerDeviceId: "'TRK-9001'",
        trackerStatus: "'ONLINE'",
      }),
    );
    await prisma.$executeRawUnsafe(
      vehicleInsert("pcreserved", {
        status: "'RESERVED'",
        listingStatus: "'ACTIVE'",
        askingPriceCents: "1599500",
      }),
    );
    await prisma.$executeRawUnsafe(
      vehicleInsert("pcsold", {
        status: "'SOLD'",
        listingStatus: "'SOLD'",
        askingPriceCents: "2100000",
        finalSalePriceCents: "2050000",
      }),
    );
    await prisma.$executeRawUnsafe(
      vehicleInsert("pcready", {
        status: "'READY'",
        listingStatus: "'ACTIVE'",
        askingPriceCents: "1300000",
      }),
    );
    await prisma.$executeRawUnsafe(
      vehicleInsert("pcpurchased", { status: "'PURCHASED'", listingStatus: "'PAUSED'" }),
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO "vehicle_photos" ("id","vehicleId","url","alt","sortOrder","isPrimary")
       VALUES ('${id("pcphoto1")}','${listed}','https://example.test/front.jpg','Front',0,true)`,
    );
    // A photo on a sold car must not surface anywhere.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "vehicle_photos" ("id","vehicleId","url","alt","sortOrder","isPrimary")
       VALUES ('${id("pcphoto2")}','${sold}','https://example.test/sold.jpg','Sold',0,true)`,
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.vehiclePhoto.deleteMany({ where: { id: { startsWith: "itest_" } } }).catch(() => 0);
    await cleanupRun(prisma);
    await prisma.dealerSettings.deleteMany({ where: { id: "singleton" } }).catch(() => 0);
    await prisma.$disconnect();
  });

  describe("reading the catalog anonymously", () => {
    it("returns only published, priced inventory", async () => {
      const rows = await listPublicInventory({ search: RUN_TAG, limit: 50 }, prisma);
      const ids = rows.map((row) => row.id).sort();

      // LISTED and RESERVED are public; SOLD, READY+ACTIVE and PURCHASED are not.
      expect(ids).toEqual([listed, reserved].sort());
      expect(ids).not.toContain(sold);
      expect(ids).not.toContain(readyActive);
      expect(ids).not.toContain(purchased);
    });

    it("projects exactly the approved columns, plus availability and a photo", async () => {
      const rows = await listPublicInventory({ search: RUN_TAG, limit: 50 }, prisma);
      const row = rows.find((candidate) => candidate.id === listed);
      expect(row).toBeDefined();

      expect(Object.keys(row ?? {}).sort()).toEqual(
        [...LISTING_COLUMNS, "availability", "primaryPhotoUrl"].sort(),
      );
    });

    it("never carries an internal column", async () => {
      const rows = await listPublicInventory({ search: RUN_TAG, limit: 50 }, prisma);
      const row = rows.find((candidate) => candidate.id === listed) as unknown as Record<string, unknown>;

      for (const forbidden of [
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
        "customerId",
        "leadId",
      ]) {
        expect(row, `public listing must not carry ${forbidden}`).not.toHaveProperty(forbidden);
      }
    });

    it("never leaks an internal amount or an internal note in the payload", async () => {
      const rows = await listPublicInventory({ search: RUN_TAG, limit: 50 }, prisma);
      const serialized = JSON.stringify(rows);

      for (const amount of INTERNAL_AMOUNTS) {
        expect(serialized, `payload leaked ${amount}`).not.toContain(String(amount));
      }
      expect(serialized).not.toContain("minor paint chip");
      expect(serialized).not.toContain("TRK-9001");
      // The public fields are still present.
      expect(serialized).toContain("Synthetic listing copy");
      expect(serialized).toContain("Lot A");
    });

    it("reports reservation state without revealing the customer", async () => {
      const rows = await listPublicInventory({ search: RUN_TAG, limit: 50 }, prisma);
      expect(rows.find((row) => row.id === listed)?.availability).toBe("AVAILABLE");
      expect(rows.find((row) => row.id === reserved)?.availability).toBe("RESERVED");
    });

    it("filters by make and by free text", async () => {
      const byMake = await listPublicInventory({ make: "Toyota", limit: 50 }, prisma);
      expect(byMake.some((row) => row.id === listed)).toBe(true);

      const noMatch = await listPublicInventory({ make: "Ferrari" }, prisma);
      expect(noMatch.some((row) => row.id === listed)).toBe(false);
    });
  });

  describe("one public vehicle", () => {
    it("returns the listing with its photos", async () => {
      const vehicle = await getPublicVehicle(listed, prisma);

      expect(vehicle).not.toBeNull();
      expect(vehicle?.id).toBe(listed);
      expect(vehicle?.askingPriceCents).toBe(1_899_500);
      expect(vehicle?.photos).toHaveLength(1);
      expect(vehicle?.photos[0]?.alt).toBe("Front");
      expect(vehicle?.availability).toBe("AVAILABLE");
    });

    it("hides a sold vehicle behind the same answer as a wrong id", async () => {
      expect(await getPublicVehicle(sold, prisma)).toBeNull();
      expect(await getPublicVehicle(readyActive, prisma)).toBeNull();
      expect(await getPublicVehicle(purchased, prisma)).toBeNull();
      expect(await getPublicVehicle("veh_does_not_exist", prisma)).toBeNull();
      expect(await getPublicVehicle("", prisma)).toBeNull();
      expect(await getPublicVehicle("x".repeat(80), prisma)).toBeNull();
    });

    it("does not serve a photo belonging to an unpublished vehicle", async () => {
      const vehicle = await getPublicVehicle(sold, prisma);
      expect(vehicle).toBeNull();
      const listedVehicle = await getPublicVehicle(listed, prisma);
      expect(listedVehicle?.photos.every((photo) => photo.vehicleId === listed)).toBe(true);
    });
  });

  describe("dealer identity", () => {
    it("is read-only: an anonymous page view must not write", async () => {
      await prisma.dealerSettings.deleteMany({ where: { id: "singleton" } });

      const info = await getPublicDealerInfo(prisma);

      expect(info).toBeNull();
      expect(await prisma.dealerSettings.count()).toBe(0);
    });
  });
});
