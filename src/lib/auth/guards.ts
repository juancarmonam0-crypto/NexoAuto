import { redirect } from "next/navigation";
import type { UserRole } from "@/generated/prisma";
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

export class AuthorizationError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

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
 * Strips every cost, margin and internal-floor field from a vehicle-shaped
 * object unless the viewer has `finance:read`.
 *
 * This is applied on the server before data is serialized to a client
 * component, so a salesperson cannot read the dealership's cost basis out of
 * the page payload.
 */
export function maskVehicleFinancials<T extends Record<string, unknown>>(
  vehicle: T,
  viewer: { role: UserRole },
): T {
  if (canViewFinancials(viewer.role)) return vehicle;

  const masked: Record<string, unknown> = { ...vehicle };
  const hidden = [
    "acquisitionPriceCents",
    "auctionFeesCents",
    "transportationCents",
    "inspectionCents",
    "otherAcquisitionCents",
    "reconOverrideCents",
    "minimumApprovedCents",
    "minimumApprovedPriceCents",
  ];
  for (const key of hidden) {
    if (key in masked) masked[key] = null;
  }
  const nestedHidden = ["landedCostCents", "landedCost", "estimatedGrossProfitCents", "actualGrossProfitCents", "expectedProfitCents"];
  for (const key of nestedHidden) {
    if (key in masked) masked[key] = null;
  }
  return masked as T;
}
