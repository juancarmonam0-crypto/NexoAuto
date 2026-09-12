import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma";
import { assertMigrated, createClient, databaseConfigured } from "./helpers";

/**
 * Proves the SHAPE of the real PostgreSQL schema produced by the migration
 * chain. These assertions read PostgreSQL catalogs, never the migration SQL.
 */
describe.skipIf(!databaseConfigured)("database schema (real PostgreSQL)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createClient();
    await assertMigrated(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("has all 19 application tables", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations'
       ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "audit_logs",
      "customers",
      "deal_documents",
      "dealer_settings",
      "deals",
      "expenses",
      "lead_activities",
      "leads",
      "reservations",
      "saved_vehicles",
      "sessions",
      "sourcing_candidates",
      "tasks",
      "test_drive_requests",
      "users",
      "vehicle_photos",
      "vehicle_recon_items",
      "vehicle_status_events",
      "vehicles",
    ]);
  });

  it("maps DealerSettings to the dealer_settings table (regression: @@map was missing)", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(
      `SELECT to_regclass('public.dealer_settings') IS NOT NULL AS present`,
    );
    expect(rows[0]?.present).toBe(true);

    const legacy = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(
      `SELECT to_regclass('public."DealerSettings"') IS NOT NULL AS present`,
    );
    expect(legacy[0]?.present).toBe(false);
  });

  it("has 25 enum types with 172 labels", async () => {
    const types = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace
       WHERE t.typtype='e' AND ns.nspname='public'`,
    );
    expect(Number(types[0]?.n)).toBe(25);

    const labels = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
       JOIN pg_namespace ns ON ns.oid=t.typnamespace WHERE ns.nspname='public'`,
    );
    expect(Number(labels[0]?.n)).toBe(172);
  });

  it("has primary keys on every table and 36 foreign keys", async () => {
    const pk = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid=c.connamespace
       WHERE ns.nspname='public' AND c.contype='p'`,
    );
    expect(Number(pk[0]?.n)).toBe(20);

    const fk = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid=c.connamespace
       WHERE ns.nspname='public' AND c.contype='f'`,
    );
    expect(Number(fk[0]?.n)).toBe(36);
  });

  it("has every integrity CHECK constraint from migration 0002", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
      `SELECT conname FROM pg_constraint c JOIN pg_namespace ns ON ns.oid=c.connamespace
       WHERE ns.nspname='public' AND c.contype='c' ORDER BY conname`,
    );
    expect(rows.map((r) => r.conname)).toEqual([
      "customers_has_contact",
      "deal_documents_has_target",
      "deal_documents_size_sane",
      "deals_apr_sane",
      "deals_contracted_requires_sale_price",
      "deals_money_non_negative",
      "deals_term_sane",
      "expenses_amount_positive",
      "leads_lost_has_reason",
      "recon_completed_has_date",
      "recon_money_non_negative",
      "reservations_deposit_non_negative",
      "saved_vehicles_single_owner",
      "sourcing_mileage_non_negative",
      "sourcing_money_non_negative",
      "users_email_lowercase",
      "vehicles_active_listing_requires_price",
      "vehicles_asking_above_minimum",
      "vehicles_mileage_non_negative",
      "vehicles_money_non_negative",
      "vehicles_sold_requires_final_price",
      "vehicles_tracker_coordinates_paired",
      "vehicles_tracker_latitude_range",
      "vehicles_tracker_longitude_range",
      "vehicles_vin_length",
      "vehicles_year_sane",
    ]);
  });

  it("has the two partial unique indexes with their WHERE predicates", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname='public'
         AND indexname IN ('reservations_one_active_per_vehicle','deals_one_live_per_vehicle')
       ORDER BY indexname`,
    );
    expect(rows).toHaveLength(2);

    const reservations = rows.find((r) => r.indexname === "reservations_one_active_per_vehicle");
    expect(reservations?.indexdef).toMatch(/UNIQUE/);
    expect(reservations?.indexdef).toMatch(/"vehicleId"/);
    expect(reservations?.indexdef).toMatch(/WHERE/);
    expect(reservations?.indexdef).toMatch(/PENDING/);
    expect(reservations?.indexdef).toMatch(/ACTIVE/);

    const deals = rows.find((r) => r.indexname === "deals_one_live_per_vehicle");
    expect(deals?.indexdef).toMatch(/UNIQUE/);
    expect(deals?.indexdef).toMatch(/"vehicleId"/);
    expect(deals?.indexdef).toMatch(/WHERE/);
    expect(deals?.indexdef).toMatch(/CANCELLED/);
    expect(deals?.indexdef).toMatch(/LOST/);
  });

  it("has row level security enabled on every application table", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ relname: string; relrowsecurity: boolean }>>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
       WHERE ns.nspname='public' AND c.relkind='r' AND c.relname <> '_prisma_migrations'
       ORDER BY c.relname`,
    );
    expect(rows).toHaveLength(19);
    const unprotected = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(unprotected).toEqual([]);
  });

  it("defines no permissive policies, so non-owner access is deny-by-default", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_policies WHERE schemaname='public'`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("exposes exactly three public views, all reading as their owner", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ relname: string; reloptions: string[] | null }>>(
      `SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
       WHERE ns.nspname='public' AND c.relkind='v' ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual([
      "public_vehicle_availability",
      "public_vehicle_listings",
      "public_vehicle_photos",
    ]);
    // On PostgreSQL 15+ the views must opt out of security_invoker so a
    // restricted role can read the fixed, non-sensitive projection.
    for (const view of rows) {
      expect(view.reloptions ?? []).toContain("security_invoker=false");
    }
  });

  // PRE-EXISTING DEFECT FIXED (Phase 4): this assertion still listed only the
  // three migrations that existed before Phase 3 added the Supabase
  // compatibility migrations, so the committed suite failed against the
  // committed migration chain. The expected list now mirrors prisma/migrations.
  it("records the full canonical migration chain as applied", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `SELECT migration_name FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    );
    expect(rows.map((r) => r.migration_name)).toEqual([
      "0001_init",
      "0002_integrity_constraints",
      "0003_rls_and_public_surface",
      "0004_public_views_read_only",
      "0005_lock_prisma_migration_history",
    ]);
  });
});
