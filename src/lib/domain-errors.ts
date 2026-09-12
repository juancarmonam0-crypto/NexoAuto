/**
 * Domain errors — a LEAF module on purpose.
 *
 * These are the *expected*, business-meaningful failures an operation can
 * produce. They exist so callers can react programmatically (an HTTP status, a
 * specific form banner) instead of matching on message text.
 *
 * Two deliberate properties:
 *   1. No imports. Like `auth/errors.ts`, this module must stay safe to pull
 *      into a client bundle and into unit tests without dragging in Prisma or
 *      Next.js.
 *   2. Messages are written for the operator, not the developer, because they
 *      are surfaced verbatim through `describeActionError()`. Internal detail
 *      (stack traces, SQL) never belongs here.
 *
 * Shape failures (missing field, wrong type, negative money) are NOT modelled
 * here: those are zod's job at the boundary. These errors describe a request
 * that was well-formed but cannot be satisfied by the current business state.
 */

/** Base class so `instanceof DomainError` catches every expected failure. */
export class DomainError extends Error {
  readonly code: string = "DOMAIN_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/** The referenced record does not exist (or is not visible to this operator). */
export class NotFoundError extends DomainError {
  override readonly code = "NOT_FOUND";
  constructor(message = "That record no longer exists.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * The request is valid but clashes with the current state of the world:
 * a duplicate VIN, a vehicle that already has a live deal, a sourcing
 * candidate that was already purchased.
 */
export class ConflictError extends DomainError {
  override readonly code = "CONFLICT";
  constructor(message = "That change conflicts with the current state of the record.") {
    super(message);
    this.name = "ConflictError";
  }
}
