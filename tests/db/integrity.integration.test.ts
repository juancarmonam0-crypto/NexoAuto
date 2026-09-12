import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma";
import {
  assertMigrated,
  cleanupRun,
  createClient,
  databaseConfigured,
  expectAccepted,
  expectRejected,
  id,
  vehicleInsert,
  vinFor,
} from "./helpers";

/**
 * Proves that the database actually ENFORCES its invariants. Every rejection
 * test performs a real INSERT against real PostgreSQL and asserts the failure,
 * including which constraint fired.
 */
describe.skipIf(!databaseConfigured)("database integrity (real PostgreSQL)", () => {
  let prisma: PrismaClient;

  const customer = (suffix: string, phone: string) =>
    `INSERT INTO "customers" ("id","firstName","phone","updatedAt")
     VALUES ('${id(suffix)}','Test','${phone}',now())`;

  beforeAll(async () => {
    prisma = createClient();
    await assertMigrated(prisma);
  });

  afterAll(async () => {
    await cleanupRun(prisma);
    await prisma?.$disconnect();
  });

  describe("valid persistence paths succeed", () => {
    it("inserts a valid vehicle, customer and user", async () => {
      await expectAccepted(prisma, vehicleInsert("ok"), "valid vehicle");
      await expectAccepted(prisma, customer("cust", "5551234567"), "valid customer");
      await expectAccepted(
        prisma,
        `INSERT INTO "users" ("id","email","name","passwordHash","updatedAt")
         VALUES ('${id("user")}','lower@dealer.test','Staff','hash',now())`,
        "valid user",
      );
    });

    it("persists a reservation, a deal, a recon item and an expense", async () => {
      await expectAccepted(prisma, vehicleInsert("child"), "parent vehicle");
      await expectAccepted(prisma, customer("c2", "5559998888"), "customer for children");
      await expectAccepted(
        prisma,
        `INSERT INTO "reservations" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("res")}','${id("child")}','${id("c2")}','ACTIVE',now())`,
        "valid reservation",
      );
      await expectAccepted(
        prisma,
        `INSERT INTO "deals" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("deal")}','${id("child")}','${id("c2")}','OPEN',now())`,
        "valid deal",
      );
      await expectAccepted(
        prisma,
        `INSERT INTO "vehicle_recon_items" ("id","vehicleId","issue","updatedAt")
         VALUES ('${id("recon")}','${id("child")}','Brake pads',now())`,
        "valid recon item",
      );
      await expectAccepted(
        prisma,
        `INSERT INTO "expenses" ("id","vehicleId","category","amountCents","incurredOn","updatedAt")
         VALUES ('${id("exp")}','${id("child")}','PARTS',12500,CURRENT_DATE,now())`,
        "valid expense",
      );
    });

    it("accepts a SOLD vehicle that carries a final sale price", async () => {
      await expectAccepted(
        prisma,
        vehicleInsert("soldok", { status: "'SOLD'", finalSalePriceCents: "1995000" }),
        "sold vehicle with price",
      );
    });

    it("accepts asking price equal to the minimum approved price", async () => {
      await expectAccepted(
        prisma,
        vehicleInsert("eq", { askingPriceCents: "1500000", minimumApprovedCents: "1500000" }),
        "equal price boundary",
      );
    });

    it("accepts paired tracker coordinates", async () => {
      await expectAccepted(
        prisma,
        vehicleInsert("trk", { trackerLastLatitude: "32.7767", trackerLastLongitude: "-96.7970" }),
        "paired tracker coordinates",
      );
    });
  });

  describe("schema invariants are enforced", () => {
    it("rejects a duplicate VIN", async () => {
      await expectAccepted(prisma, vehicleInsert("vin"), "first VIN");
      // The only unique index on vin is vehicles_vin_key, so a 23505 on that
      // key can only come from it.
      await expectRejected(
        prisma,
        vehicleInsert("vindup", { vin: `'${vinFor("vin")}'` }),
        /Key \(vin\)=/,
        "duplicate VIN",
        "23505",
      );
    });

    it("accepts a valid VIN shape but rejects a short one", async () => {
      await expectRejected(prisma, vehicleInsert("shortvin", { vin: "'ABC'" }), /vehicles_vin_length/, "short VIN");
      await expectRejected(
        prisma,
        vehicleInsert("longvin", { vin: "'ABCDEFGHIJKLMNOPQRSTUVWXYZ'" }),
        /vehicles_vin_length/,
        "long VIN",
      );
    });

    it("rejects negative money on a vehicle", async () => {
      await expectRejected(
        prisma,
        vehicleInsert("neg", { acquisitionPriceCents: "-500000" }),
        /vehicles_money_non_negative/,
        "negative acquisition price",
      );
      await expectRejected(
        prisma,
        vehicleInsert("neg2", { auctionFeesCents: "-1" }),
        /vehicles_money_non_negative/,
        "negative auction fees",
      );
    });

    it("rejects a SOLD vehicle with no final sale price", async () => {
      await expectRejected(
        prisma,
        vehicleInsert("soldbad", { status: "'SOLD'" }),
        /vehicles_sold_requires_final_price/,
        "sold without price",
      );
    });

    it("rejects an ACTIVE listing without a positive asking price", async () => {
      await expectRejected(
        prisma,
        vehicleInsert("l1", { listingStatus: "'ACTIVE'" }),
        /vehicles_active_listing_requires_price/,
        "active listing without price",
      );
      await expectRejected(
        prisma,
        vehicleInsert("l2", { listingStatus: "'ACTIVE'", askingPriceCents: "0" }),
        /vehicles_active_listing_requires_price/,
        "active listing with zero price",
      );
    });

    it("rejects an asking price below the minimum approved price", async () => {
      await expectRejected(
        prisma,
        vehicleInsert("floor", { askingPriceCents: "1000000", minimumApprovedCents: "1900000" }),
        /vehicles_asking_above_minimum/,
        "asking below floor",
      );
    });

    it("rejects a non-sensical year and negative mileage", async () => {
      await expectRejected(prisma, vehicleInsert("y1", { year: "1500" }), /vehicles_year_sane/, "year 1500");
      await expectRejected(prisma, vehicleInsert("y2", { year: "2200" }), /vehicles_year_sane/, "year 2200");
      await expectRejected(prisma, vehicleInsert("m", { mileage: "-1" }), /vehicles_mileage_non_negative/, "negative mileage");
    });

    it("rejects half-set tracker coordinates", async () => {
      await expectRejected(
        prisma,
        vehicleInsert("t1", { trackerLastLatitude: "32.7" }),
        /vehicles_tracker_coordinates_paired/,
        "latitude without longitude",
      );
      await expectRejected(
        prisma,
        vehicleInsert("t2", { trackerLastLongitude: "-96.8" }),
        /vehicles_tracker_coordinates_paired/,
        "longitude without latitude",
      );
    });

    it("rejects a customer with no contact method", async () => {
      await expectRejected(
        prisma,
        `INSERT INTO "customers" ("id","firstName","updatedAt") VALUES ('${id("nocontact")}','Nobody',now())`,
        /customers_has_contact/,
        "customer without phone or email",
      );
    });

    it("rejects a LOST lead with no meaningful reason", async () => {
      await expectAccepted(prisma, customer("lc", "5550001111"), "lead customer");
      await expectRejected(
        prisma,
        `INSERT INTO "leads" ("id","customerId","status","updatedAt") VALUES ('${id("l1")}','${id("lc")}','LOST',now())`,
        /leads_lost_has_reason/,
        "lost lead without reason",
      );
      await expectRejected(
        prisma,
        `INSERT INTO "leads" ("id","customerId","status","lostReason","updatedAt")
         VALUES ('${id("l2")}','${id("lc")}','LOST','   ',now())`,
        /leads_lost_has_reason/,
        "lost lead with blank reason",
      );
    });

    it("rejects a non-lowercase user email", async () => {
      await expectRejected(
        prisma,
        `INSERT INTO "users" ("id","email","name","passwordHash","updatedAt")
         VALUES ('${id("u")}','Mixed@Case.Test','Staff','hash',now())`,
        /users_email_lowercase/,
        "mixed case email",
      );
    });
  });

  describe("partial unique indexes prevent double-selling", () => {
    it("rejects a second ACTIVE reservation on one vehicle", async () => {
      await expectAccepted(prisma, vehicleInsert("rsv"), "reservation vehicle");
      await expectAccepted(prisma, customer("rc1", "5550000001"), "customer 1");
      await expectAccepted(prisma, customer("rc2", "5550000002"), "customer 2");
      await expectAccepted(
        prisma,
        `INSERT INTO "reservations" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("r1")}','${id("rsv")}','${id("rc1")}','ACTIVE',now())`,
        "first ACTIVE reservation",
      );
      await expectRejected(
        prisma,
        `INSERT INTO "reservations" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("r2")}','${id("rsv")}','${id("rc2")}','ACTIVE',now())`,
        /Key \("vehicleId"\)=/,
        "second ACTIVE reservation",
        "23505",
      );
      await expectRejected(
        prisma,
        `INSERT INTO "reservations" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("r3")}','${id("rsv")}','${id("rc2")}','PENDING',now())`,
        /Key \("vehicleId"\)=/,
        "second PENDING reservation",
        "23505",
      );
    });

    it("allows a new reservation once the previous one is released", async () => {
      await expectAccepted(prisma, vehicleInsert("rsv2"), "reservation vehicle 2");
      await expectAccepted(prisma, customer("rd", "5550000004"), "customer d");
      await expectAccepted(
        prisma,
        `INSERT INTO "reservations" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("rr1")}','${id("rsv2")}','${id("rd")}','ACTIVE',now())`,
        "first reservation",
      );
      await expectAccepted(
        prisma,
        `UPDATE "reservations" SET "status"='CANCELLED' WHERE "id"='${id("rr1")}'`,
        "release reservation",
      );
      await expectAccepted(
        prisma,
        `INSERT INTO "reservations" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("rr2")}','${id("rsv2")}','${id("rd")}','ACTIVE',now())`,
        "re-reserve after release",
      );
    });

    it("rejects a second live deal on one vehicle, but allows one after cancellation", async () => {
      await expectAccepted(prisma, vehicleInsert("dl"), "deal vehicle");
      await expectAccepted(prisma, customer("dc", "5550000005"), "deal customer");
      await expectAccepted(
        prisma,
        `INSERT INTO "deals" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("d1")}','${id("dl")}','${id("dc")}','OPEN',now())`,
        "first live deal",
      );
      await expectRejected(
        prisma,
        `INSERT INTO "deals" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("d2")}','${id("dl")}','${id("dc")}','NEGOTIATING',now())`,
        /Key \("vehicleId"\)=/,
        "second live deal",
        "23505",
      );
      await expectAccepted(
        prisma,
        `UPDATE "deals" SET "status"='CANCELLED' WHERE "id"='${id("d1")}'`,
        "cancel first deal",
      );
      await expectAccepted(
        prisma,
        `INSERT INTO "deals" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("d3")}','${id("dl")}','${id("dc")}','OPEN',now())`,
        "deal after cancellation",
      );
    });
  });

  describe("foreign keys and dependent-table rules", () => {
    it("rejects a foreign key that points at nothing", async () => {
      await expectRejected(
        prisma,
        `INSERT INTO "vehicle_photos" ("id","vehicleId","url") VALUES ('${id("ph")}','nope-does-not-exist','http://x/y.jpg')`,
        /vehicle_photos_vehicleId_fkey/,
        "orphan photo",
      );
      await expectRejected(
        prisma,
        `INSERT INTO "deal_documents" ("id","type","title","fileName","fileUrl","mimeType","sizeBytes","vehicleId","updatedAt")
         VALUES ('${id("doc")}','OTHER','T','f.pdf','http://x/f.pdf','application/pdf',10,'nope',now())`,
        /deal_documents_vehicleId_fkey/,
        "orphan document",
      );
    });

    it("rejects an enum value outside the declared type", async () => {
      await expectRejected(
        prisma,
        vehicleInsert("en", { status: "'NOT_A_STATUS'" }),
        /invalid input value for enum/,
        "unknown enum value",
      );
    });

    it("rejects a deal without a sale price once contracted", async () => {
      await expectAccepted(prisma, vehicleInsert("ct"), "contract vehicle");
      await expectAccepted(prisma, customer("cc", "5550000006"), "contract customer");
      await expectRejected(
        prisma,
        `INSERT INTO "deals" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("dc1")}','${id("ct")}','${id("cc")}','CONTRACTED',now())`,
        /deals_contracted_requires_sale_price/,
        "contracted without sale price",
      );
    });

    it("rejects an expense of zero and a completed recon item with no date", async () => {
      await expectAccepted(prisma, vehicleInsert("exp"), "expense vehicle");
      await expectRejected(
        prisma,
        `INSERT INTO "expenses" ("id","vehicleId","category","amountCents","incurredOn","updatedAt")
         VALUES ('${id("e0")}','${id("exp")}','PARTS',0,CURRENT_DATE,now())`,
        /expenses_amount_positive/,
        "zero expense",
      );
      await expectRejected(
        prisma,
        `INSERT INTO "vehicle_recon_items" ("id","vehicleId","issue","status","updatedAt")
         VALUES ('${id("rcd")}','${id("exp")}','Done','COMPLETED',now())`,
        /recon_completed_has_date/,
        "completed recon without date",
      );
    });

    it("cascades deletes to photos and recon items, and nulls an expense link", async () => {
      await expectAccepted(prisma, vehicleInsert("cas"), "cascade vehicle");
      await expectAccepted(
        prisma,
        `INSERT INTO "vehicle_photos" ("id","vehicleId","url") VALUES ('${id("php")}','${id("cas")}','http://x/p.jpg')`,
        "cascade photo",
      );
      await expectAccepted(
        prisma,
        `INSERT INTO "vehicle_recon_items" ("id","vehicleId","issue","updatedAt") VALUES ('${id("ric")}','${id("cas")}','x',now())`,
        "cascade recon",
      );
      await expectAccepted(
        prisma,
        `INSERT INTO "expenses" ("id","vehicleId","category","amountCents","incurredOn","updatedAt")
         VALUES ('${id("exc")}','${id("cas")}','PARTS',5000,CURRENT_DATE,now())`,
        "cascade expense",
      );

      await expectAccepted(prisma, `DELETE FROM "vehicles" WHERE "id"='${id("cas")}'`, "delete vehicle");

      const photos = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM "vehicle_photos" WHERE "vehicleId"='${id("cas")}'`,
      );
      const recon = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM "vehicle_recon_items" WHERE "vehicleId"='${id("cas")}'`,
      );
      const expenses = await prisma.$queryRawUnsafe<Array<{ n: bigint; nulls: bigint }>>(
        `SELECT count(*) AS n, count(*) FILTER (WHERE "vehicleId" IS NULL) AS nulls
         FROM "expenses" WHERE "id"='${id("exc")}'`,
      );

      expect(Number(photos[0]?.n)).toBe(0);
      expect(Number(recon[0]?.n)).toBe(0);
      expect(Number(expenses[0]?.n)).toBe(1);
      expect(Number(expenses[0]?.nulls)).toBe(1);
    });

    it("blocks deleting a vehicle that still has a reservation", async () => {
      await expectAccepted(prisma, vehicleInsert("rest"), "restrict vehicle");
      await expectAccepted(prisma, customer("rcx", "5550000007"), "restrict customer");
      await expectAccepted(
        prisma,
        `INSERT INTO "reservations" ("id","vehicleId","customerId","status","updatedAt")
         VALUES ('${id("rx")}','${id("rest")}','${id("rcx")}','ACTIVE',now())`,
        "restrict reservation",
      );
      await expectRejected(
        prisma,
        `DELETE FROM "vehicles" WHERE "id"='${id("rest")}'`,
        /reservations_vehicleId_fkey/,
        "delete vehicle with reservation",
      );
    });
  });
});
