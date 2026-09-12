import { prisma } from "@/lib/db";
import { authorize, authorizeAny, requireCapability } from "@/lib/auth/guards";
import type { Capability } from "@/lib/auth/roles";
import type { OperationContext } from "./context";

/**
 * The Next.js adapter for the operations layer — the ONLY file in
 * `src/lib/operations` that talks to the request runtime.
 *
 * A server action or route handler calls one of these to obtain a context, then
 * calls the operation. Authorization happens twice on purpose: `authorize()`
 * here rejects the request before any work, and the operation's own
 * `assertCapability()` re-checks it, so a future handler that forgets the guard
 * still cannot mutate data.
 *
 * Server-only: `guards.ts` imports `next/navigation`.
 */

/** Resolves the acting staff member and requires one capability. */
export async function operationContext(capability: Capability): Promise<OperationContext> {
  const user = await authorize(capability);
  return { actor: user, db: prisma };
}

/** Resolves the acting staff member and requires at least one capability. */
export async function operationContextAny(
  capabilities: readonly Capability[],
): Promise<OperationContext> {
  const user = await authorizeAny(capabilities);
  return { actor: user, db: prisma };
}

/** For read paths that only need an authenticated staff member. */
export async function operationContextForStaff(): Promise<OperationContext> {
  return operationContextAny([
    "inventory:read",
    "crm:read",
    "deals:read",
    "sourcing:read",
    "reports:read",
  ]);
}

/**
 * The adapter for SERVER COMPONENTS (pages and layouts).
 *
 * Identical context, different failure mode: a page cannot "return an error",
 * so an unauthorized visitor is REDIRECTED by the existing page guards instead
 * of receiving a thrown error that would render as a 500. Pages therefore call
 * this, and server actions call `operationContext()`.
 */
export async function pageOperationContext(capability: Capability): Promise<OperationContext> {
  const user = await requireCapability(capability);
  return { actor: user, db: prisma };
}
