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

// ---------------------------------------------------------------------------
// MARKET INTELLIGENCE (MarketCheck-powered VIN analysis)
//
// ONE round trip returns the market evidence, the conservative retail policy's
// verdict AND the canonical sourcing evaluation, so Analyze never has to be
// chained client-side and the browser never sees a provider payload.
//
// The economics are IDENTICAL to the manual path: the same `evaluateOpportunity`
// produces them. Market data only supplies the expected retail input.
// ---------------------------------------------------------------------------

export interface MarketComparableContract {
  source: string;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  mileage: number | null;
  askingPriceCents: number | null;
  distanceMiles: number | null;
  dealerName: string | null;
  dealerType: string | null;
  listingUrl: string | null;
  listedDaysAgo: number | null;
}

export interface MarketValuationContract {
  provider: string;
  /** When the evidence was retrieved FROM THE PROVIDER. */
  generatedAtIso: string;
  /** False when this snapshot came out of Nexo's cache rather than the provider. */
  retrievedLive: boolean;
  cacheTtlMinutes: number;
  predictedPriceCents: number | null;
  predictedLowCents: number | null;
  predictedHighCents: number | null;
  /** What the provider said exists, which can exceed what it returned. */
  comparableCountReported: number;
  comparables: MarketComparableContract[];
  notes: string[];
}

export interface ConservativeRetailContract {
  /** The figure the economics engine uses. Null means "no market evidence". */
  retailCents: number | null;
  source: string;
  confidence: string | null;
  /** The market-only number, preserved even when the operator overrode it. */
  marketEstimateCents: number | null;
  overridden: boolean;
  policyVersion: string;
  reasons: string[];
  warnings: string[];
  evidence: {
    predictedPriceCents: number | null;
    comparableMedianAskingCents: number | null;
    comparableLowAskingCents: number | null;
    comparableHighAskingCents: number | null;
    comparablesUsed: number;
    comparablesFilteredByMileage: number;
    comparablesTotal: number;
    mileageBand: number;
  };
}

export interface MarketAnalysisContract {
  /** Null when the market layer could not answer; the manual flow then applies. */
  market: MarketValuationContract | null;
  /** Operator-facing reason the market layer is unavailable. Never a guess. */
  marketUnavailableReason: string | null;
  retail: ConservativeRetailContract;
  /** The canonical sourcing evaluation — the same engine the manual path uses. */
  evaluation: OpportunityEvaluationContract | null;
  echo: {
    vin: string | null;
    mileage: number | null;
    askingPriceCents: number;
    expectedRetailCents: number | null;
    retailSource: string;
    asOfIso: string;
    jurisdiction: string | null;
  };
}

// ---------------------------------------------------------------------------
// CUSTOMER OFFER ENGINE (sell side)
//
// The sell-side counterpart of the acquisition analysis: what Nexo can
// responsibly OFFER a customer, given a stated down payment and maximum payment,
// while preserving the dealership's configured economics.
//
// Same rules as everywhere else: integer cents, and every cost-derived field
// nullable because the server nulls it for a role without `finance:read`. Vehicle
// gross and projected finance income are ALWAYS separate fields — there is no
// combined "profit" in this contract by design.
// ---------------------------------------------------------------------------

export interface CustomerOfferOptionContract {
  termMonths: number;
  numberOfPayments: number;
  salePriceCents: number;
  /** Highest sale price still fitting the target at this term; null when no target. */
  maxSalePriceForTargetCents: number | null;
  downPaymentCents: number;
  amountFinancedCents: number;
  paymentAmountCents: number;
  financeChargeCents: number;
  totalCustomerOutlayCents: number;
  /** Null for a role without `finance:read`. */
  vehicleGrossCents: number | null;
  /** Null for a role without `finance:read`. */
  vehicleRoiBasisPoints: number | null;
  /** A SEPARATE revenue stream from vehicle gross; never added to it. */
  projectedFinanceIncomeCents: number;
  dealerCashReceivedAtClosingCents: number;
  dealerCapitalStillExposedCents: number;
  aprBasisPoints: number;
  fitsPaymentTarget: boolean;
  meetsEconomicFloor: boolean;
  /** null = no configured rate policy, which is not the same as "within". */
  withinRatePolicy: boolean | null;
  ratePolicyStatus: string;
  ratePolicyStatement: string;
  riskLabels: string[];
  structure: DealStructureContract;
}

export interface MinimumViableOfferContract {
  termMonths: number;
  salePriceCents: number;
  downPaymentCents: number;
  amountFinancedCents: number;
  paymentAmountCents: number;
  /** Null for a role without `finance:read`. */
  vehicleGrossCents: number | null;
  reason: string;
}

export interface CustomerOfferContract {
  verdict: string;
  verdictLabel: string;
  mode: string;
  modeLabel: string;

  askingPriceCents: number;
  /** The dealership's economic floor. Null for a role without `finance:read`. */
  minimumSalePriceCents: number | null;
  targetSellingPriceCents: number | null;
  recommendedSalePriceCents: number | null;

  downPaymentCents: number;
  maxPaymentCents: number | null;
  aprBasisPoints: number;
  paymentFrequency: string;

  recommended: CustomerOfferOptionContract | null;
  options: CustomerOfferOptionContract[];
  feasible: CustomerOfferOptionContract[];
  minimumViable: MinimumViableOfferContract | null;

  blockers: string[];
  blockerLabels: string[];
  reasons: string[];
  warnings: string[];
  /** Masked entirely for a role without `finance:read` (it quotes landed cost). */
  pricePolicy: {
    floorCents: number | null;
    targetCents: number | null;
    bindingConstraint: string | null;
    reasons: string[];
  } | null;

  echo: {
    vehicleId: string;
    vehicleTitle: string;
    landedCostVisible: boolean;
    asOfIso: string;
    jurisdiction: string | null;
  };
}
