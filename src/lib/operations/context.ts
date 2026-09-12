import type { Prisma, PrismaClient, UserRole } from "@/generated/prisma";
import { AuthorizationError } from "@/lib/auth/errors";
import { type Capability, canViewFinancials, hasCapability } from "@/lib/auth/roles";

/**
 * Operation context — how a business operation learns WHO is acting and which
 * database handle to use.
 *
 * WHY THIS EXISTS INSTEAD OF READING THE SESSION DIRECTLY
 * `guards.ts` resolves the actor from an httpOnly cookie, which requires a live
 * Next.js request. That makes business logic untestable and couples it to the
 * framework. Operations therefore take the actor as an argument:
 *
 *   - the Next.js adapter (`runtime.ts`) resolves the real session and passes it
 *   - tests pass a fixture actor and an injected database handle
 *
 * AUTHORIZATION IS ENFORCED HERE, NOT IN THE CALLER. Every operation calls
 * `assertCapability()` as its first statement, so a missing guard in a future
 * route handler cannot become a data breach. The page/action guards remain the
 * first line; this is the second, independent one.
 *
 * The actor interface is declared structurally rather than imported from
 * `session.ts`, because that module pulls in `next/headers` and Prisma. A
 * `SessionUser` satisfies `OperationActor` with no conversion.
 */

export interface OperationActor {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface OperationContext {
  actor: OperationActor;
  /**
   * The full Prisma client. Operations that must stay atomic open their own
   * `$transaction`, so the handle has to expose it.
   */
  db: PrismaClient;
}

/** Throws unless the acting role holds the capability. */
export function assertCapability(
  ctx: OperationContext,
  capability: Capability,
  message = "You do not have permission to perform this action.",
): void {
  if (!hasCapability(ctx.actor.role, capability)) {
    throw new AuthorizationError(message);
  }
}

/** Non-throwing capability probe, for shaping a payload rather than blocking. */
export function actorCan(ctx: OperationContext, capability: Capability): boolean {
  return hasCapability(ctx.actor.role, capability);
}

/** True when the acting role may see cost, margin and profit figures. */
export function actorSeesFinancials(ctx: OperationContext): boolean {
  return canViewFinancials(ctx.actor.role);
}
