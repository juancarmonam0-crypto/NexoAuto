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

  // ---- Phase 9B: the customer's contract terms ----------------------------
  financeType: string;
  paymentFrequency: string;
  numberOfPayments: number | null;
  paymentAmountCents: number | null;
  finalPaymentCents: number | null;
  firstPaymentDateIso: string | null;
  amountFinancedCents: number | null;
  downPaymentCents: number | null;
  salesTaxCents: number | null;
  financeChargeCents: number | null;
  totalOfPaymentsCents: number | null;
  aprBasisPoints: number | null;
  termMonths: number | null;

  // ---- Phase 9B: dealership economics (null for a role without finance:read)
  vehicleGrossCents: number | null;
  dealerCapitalStillExposedCents: number | null;
  projectedFinanceIncomeCents: number | null;
  combinedExpectedEconomicsCents: number | null;

  ratePolicyId: string | null;
  ratePolicyCeilingBasisPoints: number | null;
  ratePolicyStatement: string | null;
  riskFlags: string[];
}

export interface DealCancelledContract {
  dealId: string;
  status: string;
  vehicleId: string;
  vehicleStatus: string;
}

// ---------------------------------------------------------------------------
// PHASE 9B — DEAL STRUCTURING
//
// Every money field is a number of integer cents, and every cost-derived field
// is nullable because the server nulls it for a role without `finance:read`.
// A nullable figure means "not visible to you", never "zero".
// ---------------------------------------------------------------------------

export interface DealRatePolicyContract {
  status: string;
  aprBasisPoints: number;
  /** null = no policy configured. Never a claim of legal compliance. */
  withinConfiguredRatePolicy: boolean | null;
  policyId: string | null;
  policyJurisdiction: string | null;
  policyCeilingBasisPoints: number | null;
  policySourceReference: string | null;
  statement: string;
  disclaimer: string;
}

export interface DealStructureContract {
  mode: string;
  label: string;
  financeType: string;
  feasible: boolean;
  unavailableReason: string | null;
  contractGeneration: string;
  contractBlockedReason: string | null;

  sellingPriceCents: number;
  dealerFeesCents: number;
  salesTaxCents: number;
  tradeInAllowanceCents: number;
  tradeInPayoffCents: number;
  amountDueCents: number;
  tradeEquityCents: number;
  downPaymentCents: number;
  amountFinancedCents: number;

  aprBasisPoints: number;
  termMonths: number;
  paymentFrequency: string;
  numberOfPayments: number;
  paymentAmountCents: number;
  finalPaymentCents: number;
  financeChargeCents: number;
  totalOfPaymentsCents: number;
  totalCustomerOutlayCents: number;
  totalCustomerOutlayWithOptionCents: number | null;
  paymentQuoted: boolean;
  firstPaymentDateIso: string | null;

  /** Null for a role without `finance:read` — never a cost-of-zero result. */
  vehicleGrossCents: number | null;
  vehicleGrossRealizedAtClosing: boolean;
  dealerCashReceivedAtClosingCents: number;
  dealerCapitalStillExposedCents: number;
  projectedFinanceIncomeCents: number;
  combinedExpectedEconomicsCents: number | null;

  /** Lease contract terms. No dealership cost, so never masked. */
  lease: {
    grossCapCostCents: number;
    capCostReductionCents: number;
    adjustedCapCostCents: number;
    residualValueCents: number;
    depreciationCents: number;
    rentChargeCents: number;
    moneyFactor: number;
    purchaseOptionCents: number;
    ownershipTransfer: string;
  } | null;

  ratePolicy: DealRatePolicyContract;
  riskFlags: string[];
  riskLabels: string[];
  reasons: string[];
  /** Null when the viewer cannot see the economics, or the structure is infeasible. */
  score: {
    capitalVelocity: number;
    immediateCashRecovery: number;
    margin: number;
    capitalExposure: number;
    creditRisk: number;
    termLength: number;
    riskAdjustedFinanceIncome: number;
    total: number;
  } | null;
}

export interface DealPricingContract {
  landedCostCents: number | null;
  askingPriceCents: number;
  targetSellingPriceCents: number;
  /** Null for a role without `finance:read`: this is the price floor. */
  minimumApprovedPriceCents: number | null;
  minimumApprovedGrossCents: number | null;
  minimumApprovedRoiBasisPoints: number | null;
  targetGrossCents: number | null;
  targetRoiBasisPoints: number | null;
  askingGrossCents: number | null;
  askingRoiBasisPoints: number | null;
  bindingConstraint: string;
  negotiationAllowanceCents: number;
  agingDiscountCents: number;
  marketTargetApplied: boolean;
  belowMarketTarget: boolean;
  reasons: string[];
  warnings: string[];
}

export interface DealComparisonContract {
  /** e.g. "RECOMMENDED: EXTERNAL FINANCE". Never composed in the browser. */
  headline: string;
  recommendedMode: string | null;
  /** Server-generated explanation. No cost figure ever appears here. */
  reasons: string[];
  structures: DealStructureContract[];
  unavailable: { mode: string; reason: string }[];
  pricing: DealPricingContract | null;
  /** Echo of the inputs the engine actually used, for an auditable UI. */
  echo: {
    vehicleId: string;
    vehicleTitle: string;
    sellingPriceCents: number;
    landedCostVisible: boolean;
    asOfIso: string;
    jurisdiction: string | null;
  };
}

// ---------------------------------------------------------------------------
// PHASE 9D — the inverse solvers
//
// Same rules as above: integer cents, and every cost-derived field nullable
// because the server nulls it for a role without `finance:read`. A nullable
// figure means "not visible to you", never "zero".
// ---------------------------------------------------------------------------

export interface TargetPaymentOptionContract {
  termMonths: number;
  numberOfPayments: number;
  paymentAmountCents: number;
  amountFinancedCents: number;
  /** The most the customer could finance and still meet the target at this term. */
  maxAmountFinancedCents: number;
  /** The down payment that would bring this term to the target. */
  requiredDownPaymentCents: number;
  /** payment - target; positive means the available down payment is not enough. */
  gapCents: number;
  fits: boolean;
  financeChargeCents: number;
  totalCustomerOutlayCents: number;
  dealerCapitalStillExposedCents: number;
  /** Null for a role without `finance:read`. */
  vehicleGrossCents: number | null;
  /** The full structure, so the operator can carry it into a contract. */
  structure: DealStructureContract;
}

export interface TargetPaymentResultContract {
  mode: string;
  modeLabel: string;
  targetPaymentCents: number;
  downPaymentCents: number;
  aprBasisPoints: number;
  paymentFrequency: string;
  options: TargetPaymentOptionContract[];
  feasible: TargetPaymentOptionContract[];
  shortestFeasibleTermMonths: number | null;
  recommendedTermMonths: number | null;
  headline: string;
  reasons: string[];
  warnings: string[];
  pricing: DealPricingContract | null;
  echo: {
    vehicleId: string;
    vehicleTitle: string;
    landedCostVisible: boolean;
    asOfIso: string;
    jurisdiction: string | null;
  };
}

export interface PaymentBudgetOptionContract {
  mode: string;
  modeLabel: string;
  termMonths: number;
  numberOfPayments: number;
  paymentAmountCents: number;
  amountFinancedCents: number;
  amountDueCents: number;
  financeChargeCents: number;
  totalCustomerOutlayCents: number;
  dealerCapitalStillExposedCents: number;
  /** Null for a role without `finance:read`. */
  vehicleGrossCents: number | null;
  aprBasisPoints: number;
  withinBudget: boolean;
  structure: DealStructureContract;
}

export interface PaymentBudgetResultContract {
  maxPaymentCents: number;
  downPaymentCents: number;
  paymentFrequency: string;
  options: PaymentBudgetOptionContract[];
  /** How many structures were built in total, fitting or not. */
  optionCountBuilt: number;
  shortestFeasibleTermMonths: number | null;
  recommended: PaymentBudgetOptionContract | null;
  headline: string;
  reasons: string[];
  warnings: string[];
  unavailable: { mode: string; reason: string }[];
  pricing: DealPricingContract | null;
  echo: {
    vehicleId: string;
    vehicleTitle: string;
    landedCostVisible: boolean;
    asOfIso: string;
    jurisdiction: string | null;
  };
}
