import { isPrismaUniqueViolation } from "@/lib/action-result";
import { ConflictError } from "@/lib/domain-errors";

/**
 * Translates the database's own concurrency arbitration into a stable
 * application error.
 *
 * The Phase 3 migrations enforce uniqueness in PostgreSQL (a unique VIN, a
 * unique stock number, one live deal per vehicle). Application code must not
 * pretend a read-then-write check is enough: two staff members can pass the
 * read at the same instant, and the database is what actually decides. These
 * helpers let an operation rely on the index and still return a message an
 * operator can act on.
 */

/** Extracts the index/column list Prisma reports for a unique violation. */
export function uniqueViolationTarget(error: unknown): string {
  const raw = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(raw)) return raw.join(",");
  return String(raw ?? "");
}

/**
 * Re-throws a unique violation as a `ConflictError` chosen by index name.
 * Anything that is not a unique violation is re-thrown untouched.
 *
 * Returns `never`, so a call site can `return rethrowUniqueViolation(...)`.
 */
export function rethrowUniqueViolation(
  error: unknown,
  messages: Record<string, string>,
  fallback: string,
): never {
  if (isPrismaUniqueViolation(error)) {
    const target = uniqueViolationTarget(error);
    for (const [needle, message] of Object.entries(messages)) {
      if (target.includes(needle)) throw new ConflictError(message);
    }
    throw new ConflictError(fallback);
  }
  throw error;
}

/**
 * True when the database is missing a column, table or type that the deployed
 * CODE expects — i.e. a migration has not been applied yet.
 *
 * WHY THIS EXISTS (Phase 9D)
 * Code and schema are deployed separately. The Phase 9 code was pushed BEFORE
 * migration `0006_deal_structuring_and_finance` is applied to production, so for
 * a window a route can legitimately ask for a column the database does not have
 * yet. That must degrade into an honest message on that one page, not a 500 and
 * certainly not a write.
 *
 * It deliberately matches ONLY "the schema is behind the code":
 *   P2022 / 42703 — column does not exist
 *   P2021 / 42P01 — table does not exist
 * Anything else (a constraint violation, a unique conflict, a connection
 * failure) is NOT this condition and is re-thrown untouched by the caller.
 */
export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === "P2022" || code === "P2021" || code === "42703" || code === "42P01";
}
