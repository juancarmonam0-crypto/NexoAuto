/**
 * Authorization error — a LEAF module on purpose.
 *
 * Why this file exists separately from guards.ts:
 * `action-result.ts` needs to recognise an authorization failure, and that
 * module is imported by client components (forms). Importing it from guards.ts
 * would drag `next/headers`, `next/navigation` and Prisma toward the browser
 * bundle. This module imports nothing, so it is safe on both sides of the
 * server/client boundary.
 *
 * Do not add imports here.
 */
export class AuthorizationError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}
