import type { SourcingEvaluation } from "@/lib/sourcing";

/**
 * The serializable application contract.
 *
 * These are the shapes that cross from the server to the browser. Two rules:
 *
 *   1. PRIMITIVES ONLY. No Date, no bigint, no Prisma model, no class instance.
 *      Dates become ISO strings at the boundary, because a Server Action result
 *      is serialized and the UI must not have to guess what survived.
 *   2. NOTHING SENSITIVE BY DEFAULT. A mutation result reports what changed, not
 *      the whole row. Cost fields are `null` when the acting role is not allowed
 *      to see them — the same masking the operations apply.
 *
 * Read workflows (inventory lists, lead lists, the public catalog) are served by
 * server components calling the operation layer directly, so they do not need a
 * result type here; the operations' own return types are the contract.
 *
 * This file is import-only types and is safe to import from a client component.
 */

// ---------------------------------------------------------------------------
// BUY
// ---------------------------------------------------------------------------

export type SourcingRecommendationCode = SourcingEvaluation["recommendation"];
export type SourcingBindingConstraint = SourcingEvaluation["bindingConstraint"];

/** The canonical sourcing verdict. Produced by the engine, never by the UI. */
export interface OpportunityEvaluationContract {
  landedCostCents: number;
  expectedProfitCents: number;
  expectedRoiBasisPoints: number | null;
  maxPurchasePriceCents: number;
  maxBidCents: number;
  bindingConstraint: SourcingBindingConstraint;
  recommendation: SourcingRecommendationCode;
  reasons: string[];
}

/** A saved opportunity, reported as its snapshot. */
export interface SourcingCandidateContract extends OpportunityEvaluationContract {
  candidateId: string;
  status: string;
  evaluatedAtIso: string | null;
}

export interface SourcingDecisionContract {
  candidateId: string;
  status: string;
}

export interface VinDecodeContract {
  status: "ok" | "unavailable" | "error";
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  bodyType?: string;
  /** Present when the decoder could not help; never a fabricated value. */
  message?: string;
}

// ---------------------------------------------------------------------------
// ACQUISITION
// ---------------------------------------------------------------------------

export interface VehicleAcquiredContract {
  vehicleId: string;
  candidateId: string;
  stockNumber: string;
  status: string;
  landedCostCents: number;
}

// ---------------------------------------------------------------------------
// CARS
// ---------------------------------------------------------------------------

/** Cost fields are null for a role without `finance:read`. */
export interface VehicleMutationContract {
  vehicleId: string;
  status: string;
  listingStatus: string;
  askingPriceCents: number | null;
  landedCostCents: number | null;
}

export interface ExpenseRecordedContract {
  expenseId: string;
  vehicleId: string | null;
  category: string;
  amountCents: number;
  incurredOnIso: string;
}

export interface ReconItemContract {
  reconItemId: string;
  vehicleId: string;
  status: string;
  estimateCents: number;
  actualCostCents: number | null;
}

export interface PhotoContract {
  photoId: string;
  vehicleId: string;
  url: string;
  isPrimary: boolean;
}

// ---------------------------------------------------------------------------
// LEADS
// ---------------------------------------------------------------------------

export interface LeadContract {
  leadId: string;
  customerId: string;
  status: string;
  vehicleId: string | null;
}

export interface LeadNoteContract {
  leadId: string;
  activityId: string;
  createdAtIso: string;
}

// ---------------------------------------------------------------------------
// SALES
// ---------------------------------------------------------------------------

export interface SaleCompletedContract {
  dealId: string;
  vehicleId: string;
  customerId: string;
  dealStatus: string;
  vehicleStatus: string;
  finalSalePriceCents: number;
  saleDateIso: string;
  daysInInventory: number | null;
  /** Null for a role without `finance:read`. */
  landedCostCents: number | null;
  actualGrossProfitCents: number | null;
  actualRoiBasisPoints: number | null;
}

export interface DealCancelledContract {
  dealId: string;
  status: string;
  vehicleId: string;
  vehicleStatus: string;
}
