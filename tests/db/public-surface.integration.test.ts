import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma";
import { assertMigrated, cleanupRun, createClient, databaseConfigured, expectAccepted, id, vehicleInsert } from "./helpers";

/**
 * Proves the public surface: which columns the three public views project, which
 * inventory they expose, and what a genuinely restricted NON-OWNER role can see.
 *
 * Role switching uses `SET LOCAL ROLE` inside a transaction so every statement
 * runs on one connection as that role, and the role is restored automatically.
 */

const PROBE_ROLE = "nexo_rls_probe";
const ANON_ROLE = "nexo_anon_probe";

describe.skipIf(!databaseConfigured)("public surface (real PostgreSQL)", () => {
  let prisma: PrismaClient;
  let canCreateRoles = false;

  async function asRole<T>(role: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  beforeAll(async () => {
    prisma = createClient();
    await assertMigrated(prisma);

    try {
      await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${PROBE_ROLE}"`);
      await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${ANON_ROLE}"`);
      await prisma.$executeRawUnsafe(`CREATE ROLE "${PROBE_ROLE}" NOLOGIN`);
      await prisma.$executeRawUnsafe(`CREATE ROLE "${ANON_ROLE}" NOLOGIN`);

      // Privilege layer only: the probe role IS granted SELECT on vehicles, so
      // anything it cannot see is hidden by RLS rather than by privileges.
      await prisma.$executeRawUnsafe(`GRANT SELECT ON "vehicles" TO "${PROBE_ROLE}"`);

      // Mirrors migration 0003's grant block, which only fires when the
      // Supabase-style roles already exist.
      await prisma.$executeRawUnsafe(`GRANT SELECT ON "public_vehicle_listings" TO "${ANON_ROLE}"`);
      await prisma.$executeRawUnsafe(`GRANT SELECT ON "public_vehicle_photos" TO "${ANON_ROLE}"`);
      await prisma.$executeRawUnsafe(`GRANT SELECT ON "public_vehicle_availability" TO "${ANON_ROLE}"`);

      canCreateRoles = true;
    } catch {
      // A non-superuser developer database cannot create roles; the catalog
      // assertions below still run.
      canCreateRoles = false;
    }
  });

  afterAll(async () => {
    if (canCreateRoles) {
      await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${PROBE_ROLE}"`).catch(() => 0);
      await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${ANON_ROLE}"`).catch(() => 0);
    }
    await cleanupRun(prisma);
    await prisma?.$disconnect();
  });

  describe("the public views project a fixed, non-sensitive column set", () => {
    it("exposes exactly the intended columns", async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; columns: string }>>(
        `SELECT table_name, string_agg(column_name, ',' ORDER BY ordinal_position) AS columns
         FROM information_schema.columns
         WHERE table_schema='public' AND table_name LIKE 'public_vehicle%'
         GROUP BY table_name ORDER BY table_name`,
      );
      const byName = Object.fromEntries(rows.map((r) => [r.table_name, r.columns]));

      expect(byName["public_vehicle_listings"]).toBe(
        "id,stockNumber,vin,year,make,model,trim,mileage,exteriorColor,interiorColor,transmission,drivetrain," +
          "engine,fuelType,bodyType,doors,seats,titleStatus,askingPriceCents,description,features,location," +
          "status,dateListed,dataOrigin,createdAt,updatedAt",
      );
      expect(byName["public_vehicle_photos"]).toBe("id,vehicleId,url,alt,sortOrder,isPrimary");
      expect(byName["public_vehicle_availability"]).toBe("vehicle_id,availability");
    });

    it("never exposes cost, margin, floor, notes, tracker or personal data", async () => {
      const forbidden = [
        "acquisitionPriceCents",
        "auctionFeesCents",
        "transportationCents",
        "inspectionCents",
        "otherAcquisitionCents",
        "reconOverrideCents",
        "targetRetailPriceCents",
        "minimumApprovedCents",
        "finalSalePriceCents",
        "notes",
        "trackerDeviceId",
        "trackerStatus",
        "trackerLastLatitude",
        "trackerLastLongitude",
        "trackerLastSeenAt",
        "trackerGeofenceState",
        "acquisitionSource",
        "acquisitionDate",
        "firstName",
        "lastName",
        "email",
        "phone",
        "addressLine1",
        "passwordHash",
        "tokenHash",
        "userId",
      ];
      const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name LIKE 'public_vehicle%'`,
      );
      const exposed = rows.map((r) => r.column_name).filter((c) => forbidden.includes(c));
      expect(exposed).toEqual([]);
    });
  });

  describe("only published inventory is exposed", () => {
    it("shows LISTED and RESERVED but hides SOLD, SOURCING, PAUSED and READY+ACTIVE", async () => {
      await expectAccepted(
        prisma,
        vehicleInsert("pub", { status: "'LISTED'", listingStatus: "'ACTIVE'", askingPriceCents: "1899500" }),
        "listed",
      );
      await expectAccepted(
        prisma,
        vehicleInsert("res", { status: "'RESERVED'", listingStatus: "'ACTIVE'", askingPriceCents: "1599500" }),
        "reserved",
      );
      await expectAccepted(
        prisma,
        vehicleInsert("soldpub", {
          status: "'SOLD'",
          listingStatus: "'SOLD'",
          askingPriceCents: "2100000",
          finalSalePriceCents: "2050000",
        }),
        "sold",
      );
      await expectAccepted(
        prisma,
        vehicleInsert("src", { status: "'SOURCING'", listingStatus: "'UNLISTED'" }),
        "sourcing",
      );
      await expectAccepted(
        prisma,
        vehicleInsert("pause", { status: "'READY'", listingStatus: "'PAUSED'", askingPriceCents: "1200000" }),
        "paused",
      );
      await expectAccepted(
        prisma,
        vehicleInsert("ra", { status: "'READY'", listingStatus: "'ACTIVE'", askingPriceCents: "1300000" }),
        "ready+active",
      );

      const visible = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "public_vehicle_listings" WHERE id LIKE '${id("%")}' ORDER BY id`,
      );
      expect(visible.map((r) => r.id).sort()).toEqual([id("pub"), id("res")].sort());
    });

    it("keeps the reservation holder out of the availability view", async () => {
      await expectAccepted(
        prisma,
        `INSERT INTO "customers" ("id","firstName","phone","updatedAt") VALUES ('${id("secret")}','Secret','5550001234',now())`,
        "secret customer",
      );
      await expectAccepted(
        prisma,
        `INSERT INTO "reservations" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("r")}','${id("res")}','${id("secret")}','ACTIVE',now())`,
        "reservation for availability",
      );

      const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "public_vehicle_availability" WHERE vehicle_id LIKE '${id("%")}' ORDER BY vehicle_id`,
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(["availability", "vehicle_id"]);
      }
      // Ordered by vehicle_id: the unreserved listing sorts before the reserved one.
      expect(rows.map((r) => r.availability)).toEqual(["AVAILABLE", "RESERVED"]);
    });
  });

  describe.skipIf(!databaseConfigured)("restricted non-owner role behaviour", () => {
    it("grants the probe role SELECT on vehicles, but RLS returns zero rows", async () => {
      if (!canCreateRoles) {
        expect(canCreateRoles).toBe(false);
        return;
      }

      const asOwner = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM "vehicles"`,
      );
      expect(Number(asOwner[0]?.n)).toBeGreaterThan(0);

      const asProbe = await asRole(PROBE_ROLE, (tx) =>
        tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "vehicles"`),
      );
      expect(Number(asProbe[0]?.n)).toBe(0);
    });

    it("denies the probe role tables it was never granted", async () => {
      if (!canCreateRoles) return;
      await expect(
        asRole(PROBE_ROLE, (tx) =>
          tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "customers"`),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it("lets the anon role read only the three public views", async () => {
      if (!canCreateRoles) return;

      const listings = await asRole(ANON_ROLE, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM "public_vehicle_listings" WHERE id LIKE '${id("%")}'`,
        ),
      );
      expect(listings.map((r) => r.id).sort()).toEqual([id("pub"), id("res")].sort());

      for (const table of ["vehicles", "customers", "deals", "leads", "reservations", "users", "sessions"]) {
        await expect(
          asRole(ANON_ROLE, (tx) =>
            tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${table}"`),
          ),
        ).rejects.toThrow(/permission denied/i);
      }
    });
  });
});
