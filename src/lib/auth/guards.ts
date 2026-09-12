import { redirect } from "next/navigation";
import type { UserRole } from "@/generated/prisma";
import { AuthorizationError } from "@/lib/auth/errors";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import {
  type Capability,
  canViewFinancials,
  capabilitiesFor,
  hasAnyCapability,
  hasCapability,
} from "@/lib/auth/roles";

/**
 * Authorization guards — the actual security boundary.
 *
 * Two flavours, deliberately separate:
 *   - require*()  : for pages and layouts. Redirects when unauthorized.
 *   - authorize() : for server actions and route handlers. Throws, so the
 *                   caller's error handling produces a real error response
 *                   instead of a 200 with an HTML login page.
 *
 * A missing session NEVER falls through to data access.
 */

/** Re-exported so existing imports of AuthorizationError from this module keep
 * working. The class itself lives in the leaf module ./errors so that
 * client-importable code can reference it without pulling in server-only
 * dependencies. */
export { AuthorizationError };

export interface StaffContext {
  user: SessionUser;
  capabilities: readonly Capability[];
  canViewFinancials: boolean;
}

export async function getStaffContext(): Promise<StaffContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return {
    user,
    capabilities: capabilitiesFor(user.role),
    canViewFinancials: canViewFinancials(user.role),
  };
}

/** Page guard: any signed-in staff member. */
export async function requireStaff(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  return user;
}

/** Page guard: a specific capability. */
export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireStaff();
  if (!hasCapability(user.role, capability)) redirect("/admin/denied");
  return user;
}

/** Page guard: at least one of the given capabilities. */
export async function requireAnyCapability(capabilities: readonly Capability[]): Promise<SessionUser> {
  const user = await requireStaff();
  if (!hasAnyCapability(user.role, capabilities)) redirect("/admin/denied");
  return user;
}

/** Page guard: front-end money and margin figures. */
export async function requireFinancialAccess(): Promise<SessionUser> {
  const user = await requireStaff();
  if (!canViewFinancials(user.role)) redirect("/admin/denied");
  return user;
}

/** Action guard: throws AuthorizationError instead of redirecting. */
export async function authorize(capability: Capability): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("Your session has expired. Please sign in again.");
  if (!hasCapability(user.role, capability)) throw new AuthorizationError();
  return user;
}

export async function authorizeAny(capabilities: readonly Capability[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("Your session has expired. Please sign in again.");
  if (!hasAnyCapability(user.role, capabilities)) throw new AuthorizationError();
  return user;
}

/**
 * Financial-field masking now lives in the leaf module `./masking` so that
 * server code which is not a Next.js request (the operations layer, unit tests)
 * can use it without pulling in `next/navigation`. Re-exported here so existing
 * imports keep working.
 */
export { maskVehicleFinancials } from "@/lib/auth/masking";
