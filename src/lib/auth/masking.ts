import type { UserRole } from "@/generated/prisma";
import { canViewFinancials } from "@/lib/auth/roles";

/**
 * Field-level financial masking — a LEAF module on purpose.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM guards.ts
 * `guards.ts` resolves the current session, which means importing
 * `next/navigation` and `next/headers`. The operations layer needs masking but
 * must stay free of the Next.js request runtime so it can be unit-tested and
 * called outside a request. This module depends only on the pure capability
 * matrix, exactly like `auth/errors.ts` does for the error class.
 *
 * WHAT IT PROTECTS
 * Acquisition cost, the price floor, landed cost, gross profit, ROI and every
 * margin derived from them. Applying this on the SERVER before a payload is
 * serialized is what stops a salesperson from reading the dealership's cost
 * basis out of a page payload.
 *
 * The key list is deliberately name-based: it also catches derived fields
 * (front-end margin, negotiating room, ROI) whose names reveal cost. A field
 * that is not on the object is never invented, so the mask only ever narrows a
 * payload.
 */

/** Keys nulled for a viewer without `finance:read`. */
const HIDDEN_FINANCIAL_KEYS = [
  // Stored acquisition cost
  "acquisitionPriceCents",
  "auctionFeesCents",
  "transportationCents",
  "inspectionCents",
  "otherAcquisitionCents",
  "reconOverrideCents",
  // The internal price floor
  "minimumApprovedCents",
  "minimumApprovedPriceCents",
  // Derived cost and profit
  "landedCostCents",
  "landedCost",
  "estimatedGrossProfitCents",
  "actualGrossProfitCents",
  "expectedProfitCents",
  // Derived ratios and margins: each one reveals the cost basis
  "estimatedRoiBasisPoints",
  "actualRoiBasisPoints",
  "expectedRoiBasisPoints",
  "frontEndMarginCents",
  "negotiatingRoomCents",
] as const;

/**
 * Strips every cost, margin and internal-floor field from a vehicle-shaped
 * object unless the viewer has `finance:read`.
 */
export function maskVehicleFinancials<T extends Record<string, unknown>>(
  vehicle: T,
  viewer: { role: UserRole },
): T {
  if (canViewFinancials(viewer.role)) return vehicle;

  const masked: Record<string, unknown> = { ...vehicle };
  for (const key of HIDDEN_FINANCIAL_KEYS) {
    if (key in masked) masked[key] = null;
  }
  return masked as T;
}

export { HIDDEN_FINANCIAL_KEYS };
