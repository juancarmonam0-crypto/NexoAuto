import { PrismaClient } from "@/generated/prisma";

/**
 * Shared harness for the real-PostgreSQL integration tests.
 *
 * Every fixture id is prefixed with a unique per-run value so concurrent or
 * repeated runs cannot collide, and `cleanupRun` removes exactly what a run
 * created.
 */
export const RUN_ID = `itest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Builds a run-unique id, e.g. id("veh1") -> "itest_abc123_veh1". */
export function id(suffix: string): string {
  return `${RUN_ID}_${suffix}`;
}

/** Short per-run discriminator, so VINs are unique across repeat runs too. */
export const RUN_TAG = RUN_ID.slice(-5).toUpperCase().replace(/[^A-Z0-9]/g, "X");

/**
 * A unique, constraint-valid VIN for a fixture suffix. The schema requires
 * char_length(vin) BETWEEN 6 AND 24 and a unique index on vin.
 */
export function vinFor(suffix: string): string {
  const clean = suffix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `VIN${RUN_TAG}${clean}`.slice(0, 24);
}

/**
 * Builds a vehicles INSERT that satisfies every NOT NULL column, with named
 * overrides for the columns a test wants to vary.
 */
export function vehicleInsert(suffix: string, overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    id: `'${id(suffix)}'`,
    vin: `'${vinFor(suffix)}'`,
    stockNumber: `'SN-${suffix}'`,
    year: "2019",
    make: "'Toyota'",
    model: "'Camry'",
    mileage: "68000",
    updatedAt: "now()",
  };
  const merged = { ...base, ...overrides };
  const cols = Object.keys(merged)
    .map((c) => `"${c}"`)
    .join(",");
  const vals = Object.values(merged).join(",");
  return `INSERT INTO "vehicles" (${cols}) VALUES (${vals})`;
}

/**
 * True when a database is configured. When false the integration suites skip
 * themselves so `npm run test:db` never fails merely because nobody pointed it
 * at a database.
 */
export const databaseConfigured = Boolean(process.env.DATABASE_URL);

export function createClient(): PrismaClient {
  return new PrismaClient();
}

/** Fails fast with an actionable message when migrations have not been applied. */
export async function assertMigrated(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string | null }>>(
    `SELECT to_regclass('public.vehicles')::text AS table_name`,
  );
  if (!rows[0]?.table_name) {
    throw new Error(
      "public.vehicles does not exist. Apply the migration chain first: npx prisma migrate deploy",
    );
  }
}

/**
 * Asserts that a statement is REJECTED by PostgreSQL, optionally matching a
 * specific constraint name. A statement that unexpectedly succeeds fails the
 * test with the offending SQL attached.
 *
 * `expectedCode` is the PostgreSQL SQLSTATE. It matters for unique violations:
 * Prisma reports `Code: 23505` plus the offending key, but (unlike CHECK and
 * FOREIGN KEY violations) it does not include the index name in the message, so
 * the code plus the key is the strongest available assertion.
 */
export async function expectRejected(
  prisma: PrismaClient,
  sql: string,
  pattern: RegExp,
  label: string,
  expectedCode?: string,
): Promise<void> {
  let error: unknown = null;
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (caught) {
    error = caught;
  }

  if (error === null) {
    throw new Error(`${label}: PostgreSQL ACCEPTED a statement it should have rejected.\n${sql}`);
  }

  const message = error instanceof Error ? error.message : String(error);
  if (expectedCode && !message.includes(`Code: \`${expectedCode}\``)) {
    throw new Error(`${label}: rejected, but not with SQLSTATE ${expectedCode}.\nGot: ${message}`);
  }
  if (!pattern.test(message)) {
    throw new Error(`${label}: rejected, but for an unexpected reason.\nExpected ${pattern}\nGot: ${message}`);
  }
}

/** Asserts a statement succeeds, surfacing the SQL when it does not. */
export async function expectAccepted(
  prisma: PrismaClient,
  sql: string,
  label: string,
): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: PostgreSQL rejected a statement it should have accepted.\n${sql}\nGot: ${message}`);
  }
}

/** Removes every row this run created, children before parents. */
export async function cleanupRun(prisma: PrismaClient): Promise<void> {
  const like = `${RUN_ID}%`;
  const children = [
    "lead_activities",
    "reservations",
    "deal_documents",
    "deals",
    "vehicle_recon_items",
    "vehicle_photos",
    "vehicle_status_events",
    "expenses",
    "saved_vehicles",
    "sourcing_candidates",
    "tasks",
    "test_drive_requests",
    "leads",
  ];
  for (const table of children) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" LIKE $1`, like).catch(() => 0);
  }
  await prisma.$executeRawUnsafe(`DELETE FROM "vehicles" WHERE "id" LIKE $1`, like).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM "customers" WHERE "id" LIKE $1`, like).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" LIKE $1`, like).catch(() => 0);
}
