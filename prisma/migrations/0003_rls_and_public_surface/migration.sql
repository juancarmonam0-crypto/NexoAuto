-- Dealer Digital — row level security and the public exposure surface.
--
-- SECURITY MODEL (read this before changing anything here)
--
--   1. PRIMARY CONTROL: server-side authorization. Every admin page, server
--      action and route handler calls requireStaff()/requireRole() before it
--      touches data. Middleware only redirects; it is never the boundary.
--
--   2. This file is DEFENSE IN DEPTH. It matters when a browser can reach
--      Postgres directly (Supabase PostgREST with the anon key). It enables
--      deny-by-default on every customer-, deal- and money-bearing table.
--
--   3. The application connects as the table OWNER (or Supabase's `postgres`
--      role). Postgres does not apply RLS to a table's owner unless
--      FORCE ROW LEVEL SECURITY is set, which is deliberate: the server needs
--      full access, and it has already authorized the request.
--
--   4. COLUMN-LEVEL SAFETY FOR THE PUBLIC CATALOG. Row level security cannot
--      hide columns. If we granted anon SELECT on `vehicles`, anon could read
--      minimum_approved_cents and acquisition cost. So anon gets NO access to
--      the base tables at all — only to the two read-only views below, which
--      project the public columns and nothing else.

-- ---------------------------------------------------------------------------
-- Enable deny-by-default RLS on sensitive tables.
-- No policy is created for customer, lead, deal, money or document tables,
-- so a non-owner role reads zero rows.
-- ---------------------------------------------------------------------------
ALTER TABLE "customers"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_activities"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deals"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservations"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_documents"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_recon_items"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sourcing_candidates"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_drive_requests"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_vehicles"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dealer_settings"      ENABLE ROW LEVEL SECURITY;
-- Inventory itself: no anon policy. Public reads go through the views below.
ALTER TABLE "vehicles"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_photos"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_status_events" ENABLE ROW LEVEL SECURITY;

-- Sessions and users are server-only. Nothing but the server may read them.
ALTER TABLE "sessions"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users"                ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- The public catalog surface.
-- Exposes ONLY columns a shopper is allowed to see. Deliberately absent:
-- every acquisition cost, landed-cost component, minimum approved price,
-- internal notes, tracker identifiers, tracker position history, and any
-- customer or deal data.
-- ---------------------------------------------------------------------------
CREATE VIEW "public_vehicle_listings" AS
SELECT
  v."id",
  v."stockNumber",
  v."vin",
  v."year",
  v."make",
  v."model",
  v."trim",
  v."mileage",
  v."exteriorColor",
  v."interiorColor",
  v."transmission",
  v."drivetrain",
  v."engine",
  v."fuelType",
  v."bodyType",
  v."doors",
  v."seats",
  v."titleStatus",
  v."askingPriceCents",
  v."description",
  v."features",
  v."location",
  v."status",
  v."dateListed",
  -- Shown as an honest "demo data" badge when seeded inventory is present, so
  -- demo vehicles can never be mistaken for real stock.
  v."dataOrigin",
  v."createdAt",
  v."updatedAt"
FROM "vehicles" v
WHERE v."listingStatus" = 'ACTIVE'
  AND v."status" IN ('LISTED', 'RESERVED')
  AND v."askingPriceCents" IS NOT NULL
  AND v."askingPriceCents" > 0;

CREATE VIEW "public_vehicle_photos" AS
SELECT
  p."id",
  p."vehicleId",
  p."url",
  p."alt",
  p."sortOrder",
  p."isPrimary"
FROM "vehicle_photos" p
JOIN "public_vehicle_listings" l ON l."id" = p."vehicleId";

-- Public availability only: never expose who reserved a vehicle or their data.
CREATE VIEW "public_vehicle_availability" AS
SELECT
  l."id" AS "vehicle_id",
  CASE WHEN l."status" = 'RESERVED' THEN 'RESERVED' ELSE 'AVAILABLE' END AS "availability"
FROM "public_vehicle_listings" l;

-- ---------------------------------------------------------------------------
-- Object-storage policy note.
-- Vehicle photos live at vehicle/<vehicleId>/... and documents at
-- documents/<dealId>/...  Nothing is world-readable. Signed URLs are issued
-- server-side after an authorization check; see src/lib/storage.ts.
-- ---------------------------------------------------------------------------
COMMENT ON VIEW "public_vehicle_listings" IS
  'Public catalog projection. Only explicitly public vehicle columns. No cost, margin, minimum price, note or tracker data.';

-- ---------------------------------------------------------------------------
-- Grants, applied only when the Supabase-style roles exist, so this migration
-- also runs cleanly on a plain PostgreSQL instance.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      -- Base tables: explicitly revoked. The views are the only public surface.
      EXECUTE format('REVOKE ALL ON TABLE "vehicles" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE "vehicle_photos" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE "customers" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE "leads" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE "deals" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE "reservations" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE "deal_documents" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE "expenses" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE "users" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE "sessions" FROM %I', role_name);

      EXECUTE format('GRANT SELECT ON TABLE "public_vehicle_listings" TO %I', role_name);
      EXECUTE format('GRANT SELECT ON TABLE "public_vehicle_photos" TO %I', role_name);
      EXECUTE format('GRANT SELECT ON TABLE "public_vehicle_availability" TO %I', role_name);
    END IF;
  END LOOP;
END $$;

-- Views must be readable by anon. On PostgreSQL 15+ a view is SECURITY INVOKER
-- by default, so anon would hit RLS on the base tables and see nothing. Reading
-- as the view owner is safe here precisely because the projection is fixed and
-- contains no sensitive column.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW "public_vehicle_listings" SET (security_invoker = false)';
    EXECUTE 'ALTER VIEW "public_vehicle_photos" SET (security_invoker = false)';
    EXECUTE 'ALTER VIEW "public_vehicle_availability" SET (security_invoker = false)';
  END IF;
END $$;
