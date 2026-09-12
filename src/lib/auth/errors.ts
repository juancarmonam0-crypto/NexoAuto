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
/**
 * Why authorization failed.
 *
 * The distinction matters to the UI and is not cosmetic: `unauthenticated`
 * means "sign in", `forbidden` means "you are signed in and still may not do
 * this". One leads to the login page, the other to an access-denied message.
 */
export type AuthorizationErrorReason = "unauthenticated" | "forbidden";

export class AuthorizationError extends Error {
  readonly code = "UNAUTHORIZED";
  readonly reason: AuthorizationErrorReason;
  constructor(
    message = "You do not have permission to perform this action.",
    reason: AuthorizationErrorReason = "forbidden",
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.reason = reason;
  }
}
