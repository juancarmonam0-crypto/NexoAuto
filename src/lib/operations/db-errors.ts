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
