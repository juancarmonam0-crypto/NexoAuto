/**
 * Deal structuring — the canonical answer to "how do we sell this car?".
 *
 * WHAT THIS FILE IS
 * Two engines and one comparison:
 *
 *   computeRecommendedPricing()  landed cost + floors + market -> a price ladder
 *   structureDeal()              one payment mode -> a complete, costed contract
 *   compareDealStructures()      every mode -> a deterministic, explained ranking
 *
 * WHAT IT IS NOT
 * Not a lender, not an approval, not a credit decision, not a payment processor.
 * No credit bureau, no servicing ledger, no ACH. Every number is integer cents
 * and every recommendation states the arithmetic behind it.
 *
 * THE SEPARATION THAT MUST NEVER BREAK
 *   VEHICLE GROSS      = sale price - landed cost        (a VEHICLE metric)
 *   FINANCE INCOME     = the finance charge on the note  (a FINANCE metric)
 * They are reported as separate fields everywhere and are never stored merged.
 * `combinedExpectedEconomicsCents` exists ONLY so structures can be ranked
 * against each other; it is presentation-only and must never be recorded as, or
 * reported as, "gross profit" or "profit".
 *
 * FINANCE CHARGES ARE NEVER HIDDEN IN THE SALE PRICE
 * `sellingPriceCents` is the vehicle price. The finance charge lives in
 * `financeChargeCents` and only there. A structure that "raised the price to
 * bury the interest" cannot be expressed through this API.
 */

import { type BasisPoints, type Cents, formatCents, toCents } from "./money";
import { computeEstimatedGrossProfit, computeRoiBasisPoints } from "./economics";
import {
  type AmortizationResult,
  type ContractAmounts,
  type LeaseScheduleResult,
  type PaymentFrequency,
  buildAmortizationSchedule,
  buildLeaseSchedule,
  computeContractAmounts,
  numberOfPaymentsFor,
  periodsPerYear,
} from "./finance-engine";
import {
  type FinanceRatePolicy,
  type RatePolicyEvaluation,
  evaluateFinanceRate,
} from "./rate-policy";

/* -------------------------------------------------------------------------- */
/* VEHICLE PRICE ENGINE                                                        */
/* -------------------------------------------------------------------------- */

/** Prices are rounded UP to this step so a floor is never undershot. */
export const PRICING_ROUNDING_CENTS = 100;

export interface AgingPolicy {
  /** Days in inventory before any ageing discount applies. */
  afterDays: number;
  /** Discount applied per full 30 days past `afterDays`, in basis points. */
  discountBasisPointsPer30Days: BasisPoints;
  /** Hard cap on the total ageing discount, in basis points. */
  maxDiscountBasisPoints: BasisPoints;
}

export interface PricingPolicy {
  targetGrossProfitCents?: Cents | null;
  minGrossProfitCents: Cents;
  targetRoiBasisPoints?: BasisPoints | null;
  minRoiBasisPoints: BasisPoints;
  /** Optional external retail reference; it CAPS the recommended asking price. */
  marketTargetCents?: Cents | null;
  /** Room left above the target for negotiation, in basis points of the target. */
  negotiationAllowanceBasisPoints?: BasisPoints;
  aging?: AgingPolicy | null;
  roundingCents?: Cents;
}

export type PricingBindingConstraint =
  | "gross-profit-floor"
  | "roi-floor"
  | "market-target"
  | "aging-adjustment"
  | "negotiation-allowance"
  | "none";

export interface PricingTier {
  priceCents: Cents;
  grossProfitCents: Cents;
  roiBasisPoints: BasisPoints | null;
}

export interface RecommendedPricing {
  landedCostCents: Cents;
  minimumApproved: PricingTier;
  target: PricingTier;
  asking: PricingTier;
  bindingConstraint: PricingBindingConstraint;
  negotiationAllowanceCents: Cents;
  agingDiscountCents: Cents;
  /** True when the market reference capped the asking price. */
  marketTargetApplied: boolean;
  /** True when the market reference sits BELOW the minimum approved price. */
  belowMarketTarget: boolean;
  reasons: string[];
  warnings: string[];
}

function ceilTo(value: number, step: number): number {
  const safeStep = Math.max(1, Math.round(step));
  if (safeStep <= 1) return Math.max(0, Math.ceil(value));
  return Math.max(0, Math.ceil(value / safeStep) * safeStep);
}

function tier(priceCents: Cents, landedCostCents: Cents): PricingTier {
  const grossProfitCents = computeEstimatedGrossProfit(priceCents, landedCostCents);
  return {
    priceCents,
    grossProfitCents,
    roiBasisPoints: computeRoiBasisPoints(grossProfitCents, landedCostCents),
  };
}

/**
 * Derives the price ladder from cost and the dealer's own floors.
 *
 *   minimum approved = max(landed + min gross, landed x (1 + min ROI))
 *   target           = landed + target gross   (or landed x (1 + target ROI))
 *   asking           = target + negotiation room - ageing discount, capped by
 *                      the market reference and floored at minimum approved
 *
 * Both floors are always satisfied at or above the minimum approved price, and
 * the asking price is never allowed to fall below it.
 */
export function computeRecommendedPricing(input: {
  landedCostCents: Cents;
  policy: PricingPolicy;
  daysInInventory?: number | null;
}): RecommendedPricing {
  const landedCostCents = toCents(input.landedCostCents);
  const policy = input.policy;
  const step = Math.max(1, Math.round(policy.roundingCents ?? PRICING_ROUNDING_CENTS));
  const warnings: string[] = [];
  const reasons: string[] = [];

  const minGross = toCents(policy.minGrossProfitCents ?? 0);
  const minRoi = Math.max(0, Math.round(policy.minRoiBasisPoints ?? 0));
  const targetGross = policy.targetGrossProfitCents == null ? null : toCents(policy.targetGrossProfitCents);
  const targetRoi = policy.targetRoiBasisPoints == null ? null : Math.max(0, Math.round(policy.targetRoiBasisPoints));

  const grossFloorRawCents = landedCostCents + minGross;
  // price >= landed x (1 + roi) with exact integer arithmetic, rounded up.
  const roiFloorRawCents =
    minRoi > 0 ? Math.ceil((landedCostCents * (10_000 + minRoi)) / 10_000) : 0;

  const floorBinding: PricingBindingConstraint =
    roiFloorRawCents > grossFloorRawCents ? "roi-floor" : "gross-profit-floor";

  const minimumApprovedCents = ceilTo(Math.max(grossFloorRawCents, roiFloorRawCents), step);

  const targetRawCents =
    targetGross !== null
      ? landedCostCents + targetGross
      : targetRoi !== null
        ? Math.ceil((landedCostCents * (10_000 + targetRoi)) / 10_000)
        : minimumApprovedCents;

  const targetCents = ceilTo(Math.max(targetRawCents, minimumApprovedCents), step);

  const allowanceBasisPoints = Math.max(0, Math.round(policy.negotiationAllowanceBasisPoints ?? 0));
  const negotiationAllowanceCents = Math.round((targetCents * allowanceBasisPoints) / 10_000);
  const askingBeforeAgingCents = ceilTo(targetCents + negotiationAllowanceCents, step);

  // Ageing: linear, capped, and never below the approved floor.
  let agingDiscountCents = 0;
  let agingDiscountBasisPoints = 0;
  const daysInInventory = input.daysInInventory ?? null;
  const aging = policy.aging ?? null;
  if (aging !== null && daysInInventory !== null && daysInInventory > aging.afterDays) {
    const fullPeriods = Math.floor((daysInInventory - aging.afterDays) / 30);
    agingDiscountBasisPoints = Math.min(
      Math.max(0, Math.round(aging.maxDiscountBasisPoints)),
      fullPeriods * Math.max(0, Math.round(aging.discountBasisPointsPer30Days)),
    );
    agingDiscountCents = Math.round((askingBeforeAgingCents * agingDiscountBasisPoints) / 10_000);
  }

  const afterAgingCents = Math.max(minimumApprovedCents, askingBeforeAgingCents - agingDiscountCents);

  const marketTargetCents = policy.marketTargetCents == null ? null : toCents(policy.marketTargetCents);
  let askingCents = afterAgingCents;
  let marketTargetApplied = false;
  let belowMarketTarget = false;

  if (marketTargetCents !== null) {
    if (marketTargetCents < minimumApprovedCents) {
      // The market will not pay what the floors require. Say so; do not hide it
      // by quietly pricing above the market.
      belowMarketTarget = true;
      askingCents = minimumApprovedCents;
      warnings.push(
        `The market reference of ${formatCents(marketTargetCents)} sits below the minimum approved price of ${formatCents(minimumApprovedCents)}: this unit cannot meet both at the same price.`,
      );
    } else if (marketTargetCents < afterAgingCents) {
      marketTargetApplied = true;
      askingCents = marketTargetCents;
    }
  }

  let bindingConstraint: PricingBindingConstraint;
  if (marketTargetApplied) bindingConstraint = "market-target";
  else if (belowMarketTarget) bindingConstraint = "market-target";
  else if (agingDiscountBasisPoints > 0) bindingConstraint = "aging-adjustment";
  else if (negotiationAllowanceCents > 0) bindingConstraint = "negotiation-allowance";
  else if (landedCostCents > 0) bindingConstraint = floorBinding;
  else bindingConstraint = "none";

  const minimumApproved = tier(minimumApprovedCents, landedCostCents);
  const target = tier(targetCents, landedCostCents);
  const asking = tier(askingCents, landedCostCents);

  reasons.push(
    `Landed cost ${formatCents(landedCostCents)} plus a ${formatCents(minGross)} minimum gross sets the floor at ${formatCents(grossFloorRawCents)}.`,
  );
  if (minRoi > 0) {
    reasons.push(
      `A ${(minRoi / 100).toFixed(2)}% minimum return sets the floor at ${formatCents(roiFloorRawCents)}; the ${floorBinding === "roi-floor" ? "return" : "gross profit"} requirement is the binding floor.`,
    );
  }
  reasons.push(
    `Minimum approved price ${formatCents(minimumApprovedCents)} (${formatCents(minimumApproved.grossProfitCents)} gross${minimumApproved.roiBasisPoints === null ? "" : `, ${(minimumApproved.roiBasisPoints / 100).toFixed(2)}% return`}).`,
  );
  reasons.push(
    `Target price ${formatCents(targetCents)} yields ${formatCents(target.grossProfitCents)} gross${target.roiBasisPoints === null ? "" : ` and ${(target.roiBasisPoints / 100).toFixed(2)}% return`}.`,
  );
  if (negotiationAllowanceCents > 0) {
    reasons.push(
      `Asking price adds ${formatCents(negotiationAllowanceCents)} of negotiation room (${(allowanceBasisPoints / 100).toFixed(2)}%) above the target.`,
    );
  }
  if (agingDiscountBasisPoints > 0) {
    reasons.push(
      `Ageing discount of ${formatCents(agingDiscountCents)} applied for ${daysInInventory} days in inventory (${(agingDiscountBasisPoints / 100).toFixed(2)}%).`,
    );
  }
  if (marketTargetApplied) {
    reasons.push(
      `The market reference of ${formatCents(marketTargetCents!)} caps the asking price at ${formatCents(askingCents)}.`,
    );
  }
  reasons.push(
    `Recommended asking price ${formatCents(askingCents)} yields ${formatCents(asking.grossProfitCents)} gross${asking.roiBasisPoints === null ? "" : ` and ${(asking.roiBasisPoints / 100).toFixed(2)}% return`}.`,
  );

  // NOTE: there is deliberately no "target is below the minimum gross" warning
  // here. The target is clamped to at least the minimum approved price, whose
  // gross profit is at or above the floor by construction, so such a warning
  // could never fire — dead code that would imply a check the engine does not
  // perform.

  return {
    landedCostCents,
    minimumApproved,
    target,
    asking,
    bindingConstraint,
    negotiationAllowanceCents,
    agingDiscountCents,
    marketTargetApplied,
    belowMarketTarget,
    reasons,
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* PAYMENT MODES                                                               */
/* -------------------------------------------------------------------------- */

export const DEAL_PAYMENT_MODES = [
  "CASH",
  "EXTERNAL_FINANCE",
  "BUY_HERE_PAY_HERE",
  "LEASE",
  "LEASE_TO_OWN",
] as const;

export type DealPaymentMode = (typeof DEAL_PAYMENT_MODES)[number];

export const DEAL_PAYMENT_MODE_LABELS: Record<DealPaymentMode, string> = {
  CASH: "Cash",
  EXTERNAL_FINANCE: "External finance",
  BUY_HERE_PAY_HERE: "Buy here, pay here",
  LEASE: "Lease",
  LEASE_TO_OWN: "Lease to own",
};

/**
 * The subset of the Prisma `FinanceType` enum this engine maps onto.
 *
 * Kept as a local union so the engine stays a PURE module with no database
 * import. `src/lib/operations/sales.ts` asserts at compile time that this union
 * is assignable to the generated `FinanceType`, so the mirror cannot drift.
 */
export type DealFinanceType = "CASH" | "FINANCE" | "BUY_HERE_PAY_HERE" | "LEASE" | "LEASE_TO_OWN";

export function financeTypeForMode(mode: DealPaymentMode): DealFinanceType {
  switch (mode) {
    case "CASH":
      return "CASH";
    case "EXTERNAL_FINANCE":
      return "FINANCE";
    case "BUY_HERE_PAY_HERE":
      return "BUY_HERE_PAY_HERE";
    case "LEASE":
      return "LEASE";
    case "LEASE_TO_OWN":
      return "LEASE_TO_OWN";
  }
}

/* -------------------------------------------------------------------------- */
/* RISK                                                                        */
/* -------------------------------------------------------------------------- */

export const DEAL_RISK_FLAGS = [
  "ZERO_DOWN_PAYMENT",
  "LOW_DOWN_PAYMENT",
  "HIGH_APR",
  "LONG_TERM",
  "DEALER_HELD_RECEIVABLE",
  "LEASE_RESIDUAL_RISK",
  "NEGATIVE_EQUITY_TRADE",
  "UNDERWATER_GROSS",
  "BALLOON_FINAL_PAYMENT",
  "NEGATIVE_AMORTIZATION",
  "ABOVE_CONFIGURED_RATE_POLICY",
  "NO_CONFIGURED_RATE_POLICY",
  "LEASE_TAX_TREATMENT_NOT_COMPUTED",
  "LEASE_TO_OWN_CONTRACT_BLOCKED",
] as const;

export type DealRiskFlag = (typeof DEAL_RISK_FLAGS)[number];

export const DEAL_RISK_LABELS: Record<DealRiskFlag, string> = {
  ZERO_DOWN_PAYMENT: "No down payment",
  LOW_DOWN_PAYMENT: "Thin down payment",
  HIGH_APR: "High rate",
  LONG_TERM: "Long term",
  DEALER_HELD_RECEIVABLE: "Dealer carries the receivable",
  LEASE_RESIDUAL_RISK: "Dealer carries residual value risk",
  NEGATIVE_EQUITY_TRADE: "Negative equity in the trade-in",
  UNDERWATER_GROSS: "No gross profit at this price",
  BALLOON_FINAL_PAYMENT: "Balloon final payment",
  NEGATIVE_AMORTIZATION: "Payment does not cover interest",
  ABOVE_CONFIGURED_RATE_POLICY: "Above the configured rate policy",
  NO_CONFIGURED_RATE_POLICY: "No rate policy configured",
  LEASE_TAX_TREATMENT_NOT_COMPUTED: "Lease tax not computed",
  LEASE_TO_OWN_CONTRACT_BLOCKED: "Contract generation blocked",
};

/** Flags severe enough that the structure must not be presented as sound. */
export const BLOCKING_DEAL_RISK_FLAGS: readonly DealRiskFlag[] = ["NEGATIVE_AMORTIZATION"];

/** Thresholds behind the flags. Documented so a dealer can argue with them. */
export const RISK_THRESHOLDS = {
  /** Down payment below this share of the amount due is "thin". */
  lowDownPaymentBasisPoints: 1_000,
  /** APR at or above this is flagged as high (18%). */
  highAprBasisPoints: 1_800,
  /** Terms at or above this many months are flagged as long. */
  longTermMonths: 72,
} as const;

/* -------------------------------------------------------------------------- */
/* STRUCTURING                                                                 */
/* -------------------------------------------------------------------------- */

export interface DealStructureInput {
  mode: DealPaymentMode;
  /** The VEHICLE price. Never includes the finance charge. */
  sellingPriceCents: Cents;
  /**
   * The vehicle's landed cost, or NULL when the acting role may not see it.
   *
   * Null is NOT zero. A masked viewer gets a structure with the customer's
   * contract fully costed and every dealer-economics field genuinely absent
   * (`vehicleGrossCents: null`, no score, no ranking) — never a gross profit
   * computed against a cost of zero, which would be a fabricated number.
   */
  landedCostCents: Cents | null;
  dealerFeesCents?: Cents;
  salesTaxBasisPoints?: BasisPoints;
  tradeInAllowanceCents?: Cents;
  tradeInPayoffCents?: Cents;
  downPaymentCents?: Cents;
  /** Contract APR. For a lease this is the money-factor equivalent. */
  aprBasisPoints?: BasisPoints;
  termMonths?: number;
  paymentFrequency?: PaymentFrequency;
  /** ISO date of the first scheduled payment, when it is known. */
  firstPaymentDate?: string | null;
  lease?: {
    residualValueCents: Cents;
    capCostReductionCents?: Cents;
    moneyFactorAprBasisPoints?: BasisPoints;
    purchaseOptionCents?: Cents;
  } | null;
  ratePolicy?: {
    policies?: readonly FinanceRatePolicy[];
    jurisdiction: string;
    asOf: string | Date;
    vehicleModelYear?: number | null;
  } | null;
  scoring?: Partial<DealScoringWeights>;
}

export interface DealScoreDimensions {
  capitalVelocity: number;
  immediateCashRecovery: number;
  margin: number;
  capitalExposure: number;
  creditRisk: number;
  termLength: number;
  riskAdjustedFinanceIncome: number;
}

export interface DealScore extends DealScoreDimensions {
  /** Weighted total, 0..1000. */
  total: number;
  weights: DealScoringWeights;
}

export interface DealScoringWeights {
  capitalVelocity: number;
  immediateCashRecovery: number;
  margin: number;
  capitalExposure: number;
  creditRisk: number;
  termLength: number;
  riskAdjustedFinanceIncome: number;
}

/**
 * Default weights, in basis points, summing to 10,000.
 *
 * Capital velocity and immediate cash recovery dominate ON PURPOSE: releasing
 * the vehicle's capital is worth more to a micro-dealer than a large finance
 * charge collected over five risky years. Finance income is counted only after
 * the credit risk on it is discounted, which is why a 24% buy-here-pay-here
 * note does not automatically win.
 */
export const DEFAULT_DEAL_SCORING_WEIGHTS: DealScoringWeights = {
  capitalVelocity: 2_500,
  immediateCashRecovery: 2_000,
  margin: 2_000,
  capitalExposure: 1_000,
  creditRisk: 1_000,
  termLength: 500,
  riskAdjustedFinanceIncome: 1_000,
};

export interface LeaseSummary {
  grossCapCostCents: Cents;
  capCostReductionCents: Cents;
  adjustedCapCostCents: Cents;
  residualValueCents: Cents;
  depreciationCents: Cents;
  rentChargeCents: Cents;
  moneyFactor: number;
  purchaseOptionCents: Cents;
  /** How ownership transfers, or why that cannot be stated yet. */
  ownershipTransfer: "NOT_DEFINED" | "AT_FINAL_PAYMENT" | "PURCHASE_OPTION";
}

export interface DealStructure {
  mode: DealPaymentMode;
  label: string;
  financeType: DealFinanceType;
  feasible: boolean;
  /** Why the structure cannot be built, when `feasible` is false. */
  unavailableReason: string | null;
  /** Whether a contract document may be generated from this structure. */
  contractGeneration: "ALLOWED" | "BLOCKED";
  contractBlockedReason: string | null;

  amounts: ContractAmounts;
  aprBasisPoints: BasisPoints;
  termMonths: number;
  paymentFrequency: PaymentFrequency;
  numberOfPayments: number;
  paymentAmountCents: Cents;
  finalPaymentCents: Cents;
  financeChargeCents: Cents;
  totalOfPaymentsCents: Cents;
  totalCustomerOutlayCents: Cents;
  /** Lease only: outlay including the purchase option, i.e. owning it. */
  totalCustomerOutlayWithOptionCents: Cents | null;
  firstPaymentDate: string | null;
  /** False when no payment could be quoted (e.g. terms not yet agreed). */
  paymentQuoted: boolean;

  vehicleGrossCents: Cents | null;
  vehicleGrossRealizedAtClosing: boolean;
  dealerCashReceivedAtClosingCents: Cents;
  dealerCapitalStillExposedCents: Cents;
  /** The finance charge the dealer expects to earn. NEVER merged with gross. */
  projectedFinanceIncomeCents: Cents;
  /**
   * Presentation-only aggregate for ranking. Never stored, never "profit", and
   * null whenever the viewer cannot see the cost basis.
   */
  combinedExpectedEconomicsCents: Cents | null;

  lease: LeaseSummary | null;
  ratePolicy: RatePolicyEvaluation;
  riskFlags: DealRiskFlag[];
  riskLabels: string[];
  reasons: string[];
  score: DealScore | null;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1_000, Math.round(value)));
}

function resolveWeights(override?: Partial<DealScoringWeights>): DealScoringWeights {
  const merged = { ...DEFAULT_DEAL_SCORING_WEIGHTS, ...(override ?? {}) };
  return {
    capitalVelocity: Math.max(0, Math.round(merged.capitalVelocity)),
    immediateCashRecovery: Math.max(0, Math.round(merged.immediateCashRecovery)),
    margin: Math.max(0, Math.round(merged.margin)),
    capitalExposure: Math.max(0, Math.round(merged.capitalExposure)),
    creditRisk: Math.max(0, Math.round(merged.creditRisk)),
    termLength: Math.max(0, Math.round(merged.termLength)),
    riskAdjustedFinanceIncome: Math.max(0, Math.round(merged.riskAdjustedFinanceIncome)),
  };
}

/** Dealer-held exposure: only a structure the dealership finances keeps capital out. */
function computeExposure(params: {
  mode: DealPaymentMode;
  amountFinancedCents: Cents;
  thirdPartyProceedsCents: Cents;
  adjustedCapCostCents: Cents;
  capCostReductionCents: Cents;
}): Cents {
  if (params.mode === "LEASE" || params.mode === "LEASE_TO_OWN") {
    // The dealer keeps the vehicle on its books: the whole adjusted cap cost,
    // less whatever the customer put in up front, is capital still at work.
    return Math.max(0, params.adjustedCapCostCents - params.capCostReductionCents);
  }
  return Math.max(0, params.amountFinancedCents - params.thirdPartyProceedsCents);
}

function scoreStructure(params: {
  mode: DealPaymentMode;
  landedCostCents: Cents;
  vehicleGrossCents: Cents;
  dealerCashReceivedAtClosingCents: Cents;
  dealerCapitalStillExposedCents: Cents;
  projectedFinanceIncomeCents: Cents;
  termMonths: number;
  downPaymentRatioBasisPoints: number;
  weights: DealScoringWeights;
}): DealScore {
  const landed = Math.max(1, params.landedCostCents);
  const exposed = params.dealerCapitalStillExposedCents;
  const cash = params.dealerCashReceivedAtClosingCents;

  const capitalVelocity =
    exposed === 0 ? 1_000 : clampScore((1_000 * Math.max(0, cash)) / Math.max(1, cash + exposed));

  const immediateCashRecovery = clampScore((1_000 * Math.max(0, cash)) / landed);

  const roi = computeRoiBasisPoints(params.vehicleGrossCents, landed);
  const margin = roi === null ? 0 : clampScore(roi / 10);

  const capitalExposure = clampScore(1_000 - (1_000 * exposed) / landed);

  const dealerHeld = exposed > 0;
  let creditRisk = 1_000;
  if (dealerHeld) {
    const termPenalty = Math.min(400, Math.round(params.termMonths * 4));
    const downPenalty = params.downPaymentRatioBasisPoints < 1_000 ? 300 : params.downPaymentRatioBasisPoints < 2_000 ? 150 : 0;
    const residualPenalty = params.mode === "LEASE" || params.mode === "LEASE_TO_OWN" ? 200 : 0;
    creditRisk = clampScore(1_000 - termPenalty - downPenalty - residualPenalty);
  }

  const termLength = clampScore(1_000 - Math.max(0, params.termMonths - 36) * (1_000 / 60));

  // Finance income counts only after the risk of collecting it is discounted.
  const adjustedFinanceIncome = (params.projectedFinanceIncomeCents * creditRisk) / 1_000;
  const riskAdjustedFinanceIncome = clampScore((1_000 * adjustedFinanceIncome) / landed);

  const dimensions: DealScoreDimensions = {
    capitalVelocity,
    immediateCashRecovery,
    margin,
    capitalExposure,
    creditRisk,
    termLength,
    riskAdjustedFinanceIncome,
  };

  const total = clampScore(
    (dimensions.capitalVelocity * params.weights.capitalVelocity +
      dimensions.immediateCashRecovery * params.weights.immediateCashRecovery +
      dimensions.margin * params.weights.margin +
      dimensions.capitalExposure * params.weights.capitalExposure +
      dimensions.creditRisk * params.weights.creditRisk +
      dimensions.termLength * params.weights.termLength +
      dimensions.riskAdjustedFinanceIncome * params.weights.riskAdjustedFinanceIncome) /
      10_000,
  );

  return { ...dimensions, total, weights: params.weights };
}

/**
 * Builds ONE fully costed structure for ONE payment mode.
 *
 * The engine never throws for a missing business input: it returns a structure
 * with `feasible: false` and a reason, so a comparison can honestly say which
 * modes are unavailable and why.
 */
export function structureDeal(input: DealStructureInput): DealStructure {
  const mode = input.mode;
  const label = DEAL_PAYMENT_MODE_LABELS[mode];
  // Null means "this viewer may not see the cost basis" — never 0.
  const landedCostKnown = input.landedCostCents !== null && input.landedCostCents !== undefined;
  const landedCostCents = landedCostKnown ? toCents(input.landedCostCents) : null;
  const paymentFrequency = input.paymentFrequency ?? "MONTHLY";
  const termMonths = Math.max(0, Math.round(input.termMonths ?? 0));
  const reasons: string[] = [];
  const riskFlags: DealFlagList = [];
  const isLeaseMode = mode === "LEASE" || mode === "LEASE_TO_OWN";
  const isCash = mode === "CASH";

  const requestedApr = input.aprBasisPoints ?? 0;
  // A cash deal has no rate, so an APR supplied alongside it is not echoed back
  // as if the customer were being charged one: the contract's rate is 0.
  const aprBasisPoints = isCash
    ? 0
    : isLeaseMode
      ? (input.lease?.moneyFactorAprBasisPoints ?? requestedApr)
      : requestedApr;

  const ratePolicy = evaluateFinanceRate({
    aprBasisPoints,
    policies: input.ratePolicy?.policies,
    jurisdiction: input.ratePolicy?.jurisdiction ?? "TX",
    asOf: input.ratePolicy?.asOf ?? new Date(0),
    vehicleModelYear: input.ratePolicy?.vehicleModelYear ?? null,
  });

  // ---- contract amounts (tax on leases is jurisdiction-specific: not invented)
  const amounts = computeContractAmounts({
    sellingPriceCents: input.sellingPriceCents,
    dealerFeesCents: input.dealerFeesCents,
    salesTaxBasisPoints: isLeaseMode ? 0 : input.salesTaxBasisPoints,
    tradeInAllowanceCents: input.tradeInAllowanceCents,
    tradeInPayoffCents: input.tradeInPayoffCents,
    // A cash deal settles in full at delivery; nothing is carried.
    downPaymentCents: isCash ? 0 : input.downPaymentCents,
  });

  // ---- feasibility
  let feasible = true;
  let unavailableReason: string | null = null;
  if (!isCash && !isLeaseMode) {
    if (termMonths <= 0) {
      feasible = false;
      unavailableReason = "A term in months is required to schedule payments.";
    } else if (aprBasisPoints <= 0 && input.aprBasisPoints === undefined) {
      feasible = false;
      unavailableReason = "A rate is required to quote payments on a financed structure.";
    }
  }
  if (isLeaseMode) {
    if (!input.lease || input.lease.residualValueCents === undefined) {
      feasible = false;
      unavailableReason = "A lease needs a contractual residual value.";
    } else if (termMonths <= 0) {
      feasible = false;
      unavailableReason = "A term in months is required to schedule lease payments.";
    }
  }

  // ---- schedule
  let numberOfPayments = 0;
  let paymentAmountCents = 0;
  let finalPaymentCents = 0;
  let financeChargeCents = 0;
  let totalOfPaymentsCents = 0;
  let amountFinancedCents = amounts.amountFinancedCents;
  let thirdPartyProceedsCents = 0;
  let downPaymentCents = amounts.downPaymentCents;
  let lease: LeaseSummary | null = null;
  let leaseSchedule: LeaseScheduleResult | null = null;
  let amortization: AmortizationResult | null = null;
  let paymentQuoted = false;
  let adjustedCapCostCents = 0;
  let capCostReductionCents = 0;

  if (isCash) {
    // Settle the balance at delivery.
    downPaymentCents = Math.max(0, amounts.amountDueCents - amounts.tradeInAllowanceCents);
    amountFinancedCents = 0;
    reasons.push(
      `Cash sale: ${formatCents(downPaymentCents)} collected at delivery, no receivable and no finance charge.`,
    );
  } else if (isLeaseMode && feasible) {
    const leaseInput = input.lease!;
    leaseSchedule = buildLeaseSchedule({
      grossCapCostCents: input.sellingPriceCents + amounts.dealerFeesCents,
      capCostReductionCents: leaseInput.capCostReductionCents ?? input.downPaymentCents ?? 0,
      residualValueCents: leaseInput.residualValueCents,
      aprBasisPoints,
      numberOfPayments: numberOfPaymentsFor(termMonths, paymentFrequency),
      paymentFrequency,
    });
    adjustedCapCostCents = leaseSchedule.adjustedCapCostCents;
    capCostReductionCents = leaseSchedule.capCostReductionCents;
    downPaymentCents = leaseSchedule.capCostReductionCents;
    amountFinancedCents = leaseSchedule.amountFinancedCents;
    numberOfPayments = leaseSchedule.numberOfPayments;
    paymentAmountCents = leaseSchedule.paymentAmountCents;
    finalPaymentCents = leaseSchedule.finalPaymentCents;
    financeChargeCents = leaseSchedule.rentChargeCents;
    totalOfPaymentsCents = leaseSchedule.totalOfPaymentsCents;
    paymentQuoted = true;
    lease = {
      grossCapCostCents: leaseSchedule.grossCapCostCents,
      capCostReductionCents: leaseSchedule.capCostReductionCents,
      adjustedCapCostCents: leaseSchedule.adjustedCapCostCents,
      residualValueCents: leaseSchedule.residualValueCents,
      depreciationCents: leaseSchedule.depreciationCents,
      rentChargeCents: leaseSchedule.rentChargeCents,
      moneyFactor: leaseSchedule.moneyFactor,
      purchaseOptionCents: leaseInput.purchaseOptionCents ?? leaseSchedule.residualValueCents,
      ownershipTransfer:
        mode === "LEASE_TO_OWN" ? "NOT_DEFINED" : leaseInput.purchaseOptionCents ? "PURCHASE_OPTION" : "PURCHASE_OPTION",
    };
    riskFlags.push("LEASE_TAX_TREATMENT_NOT_COMPUTED");
    reasons.push(
      `Lease: adjusted cap cost ${formatCents(leaseSchedule.adjustedCapCostCents)}, residual ${formatCents(leaseSchedule.residualValueCents)}, depreciation ${formatCents(leaseSchedule.depreciationCents)} and rent charge ${formatCents(leaseSchedule.rentChargeCents)} at a ${leaseSchedule.moneyFactor.toFixed(6)} money factor.`,
    );
  } else if (feasible) {
    numberOfPayments = numberOfPaymentsFor(termMonths, paymentFrequency);
    amortization = buildAmortizationSchedule({
      amountFinancedCents,
      aprBasisPoints,
      numberOfPayments,
      paymentFrequency,
    });
    paymentAmountCents = amortization.paymentAmountCents;
    finalPaymentCents = amortization.finalPaymentCents;
    financeChargeCents = amortization.financeChargeCents;
    totalOfPaymentsCents = amortization.totalOfPaymentsCents;
    paymentQuoted = amountFinancedCents > 0;
    if (mode === "EXTERNAL_FINANCE") {
      thirdPartyProceedsCents = amountFinancedCents;
      reasons.push(
        `The lender advances the ${formatCents(amountFinancedCents)} financed balance at delivery, so none of the dealer's capital stays in the vehicle.`,
      );
    } else {
      reasons.push(
        `The dealership carries the ${formatCents(amountFinancedCents)} receivable and expects ${formatCents(financeChargeCents)} of finance income over ${numberOfPayments} payments.`,
      );
      riskFlags.push("DEALER_HELD_RECEIVABLE");
    }
  }

  // ---- dealer cash and exposure
  const dealerCashReceivedAtClosingCents =
    downPaymentCents + thirdPartyProceedsCents - amounts.tradeInPayoffCents;
  const dealerCapitalStillExposedCents = feasible
    ? computeExposure({
        mode,
        amountFinancedCents,
        thirdPartyProceedsCents,
        adjustedCapCostCents,
        capCostReductionCents,
      })
    : 0;

  const vehicleGrossCents =
    landedCostCents === null ? null : computeEstimatedGrossProfit(input.sellingPriceCents, landedCostCents);
  const vehicleGrossRealizedAtClosing = mode === "CASH" || mode === "EXTERNAL_FINANCE";
  const projectedFinanceIncomeCents = financeChargeCents;
  const combinedExpectedEconomicsCents =
    vehicleGrossCents === null ? null : vehicleGrossCents + projectedFinanceIncomeCents;

  const totalCustomerOutlayCents = downPaymentCents + totalOfPaymentsCents;
  const totalCustomerOutlayWithOptionCents =
    lease === null ? null : totalCustomerOutlayCents + lease.purchaseOptionCents;

  // ---- risk flags
  const downPaymentRatioBasisPoints =
    amounts.amountDueCents > 0 ? Math.round((downPaymentCents * 10_000) / amounts.amountDueCents) : 0;
  if (downPaymentCents <= 0 && !isCash) riskFlags.push("ZERO_DOWN_PAYMENT");
  else if (downPaymentRatioBasisPoints < RISK_THRESHOLDS.lowDownPaymentBasisPoints && !isCash) {
    riskFlags.push("LOW_DOWN_PAYMENT");
  }
  if (aprBasisPoints >= RISK_THRESHOLDS.highAprBasisPoints) riskFlags.push("HIGH_APR");
  if (termMonths >= RISK_THRESHOLDS.longTermMonths) riskFlags.push("LONG_TERM");
  if (isLeaseMode) riskFlags.push("LEASE_RESIDUAL_RISK");
  if (amounts.tradeInAllowanceCents < amounts.tradeInPayoffCents) riskFlags.push("NEGATIVE_EQUITY_TRADE");
  if (vehicleGrossCents !== null && vehicleGrossCents <= 0) riskFlags.push("UNDERWATER_GROSS");
  if (amortization?.balloonFinalPayment || leaseSchedule?.balloonFinalPayment) riskFlags.push("BALLOON_FINAL_PAYMENT");
  if (amortization?.negativeAmortization) riskFlags.push("NEGATIVE_AMORTIZATION");
  if (ratePolicy.withinConfiguredRatePolicy === false) riskFlags.push("ABOVE_CONFIGURED_RATE_POLICY");
  if (ratePolicy.withinConfiguredRatePolicy === null && !isCash) riskFlags.push("NO_CONFIGURED_RATE_POLICY");

  const contractBlockedReason =
    mode === "LEASE_TO_OWN"
      ? "Lease-to-own ownership transfer and disclosure semantics are not defined, so a customer contract cannot be generated from this structure yet."
      : null;
  if (mode === "LEASE_TO_OWN") riskFlags.push("LEASE_TO_OWN_CONTRACT_BLOCKED");

  // ---- score
  // Ranking needs the cost basis. Without it there is no score and therefore no
  // ranking — the alternative would be ranking on a fabricated margin.
  const weights = resolveWeights(input.scoring);
  const score =
    feasible && landedCostCents !== null
      ? scoreStructure({
          mode,
          landedCostCents,
          vehicleGrossCents: vehicleGrossCents ?? 0,
          dealerCashReceivedAtClosingCents,
          dealerCapitalStillExposedCents,
          projectedFinanceIncomeCents,
          termMonths: isCash ? 0 : termMonths,
          downPaymentRatioBasisPoints,
          weights,
        })
      : null;

  return {
    mode,
    label,
    financeType: financeTypeForMode(mode),
    feasible,
    unavailableReason,
    contractGeneration: contractBlockedReason === null ? "ALLOWED" : "BLOCKED",
    contractBlockedReason,
    amounts: { ...amounts, downPaymentCents, amountFinancedCents },
    aprBasisPoints,
    termMonths: isCash ? 0 : termMonths,
    paymentFrequency,
    numberOfPayments,
    paymentAmountCents,
    finalPaymentCents,
    financeChargeCents,
    totalOfPaymentsCents,
    totalCustomerOutlayCents,
    totalCustomerOutlayWithOptionCents,
    firstPaymentDate: input.firstPaymentDate ?? null,
    paymentQuoted,
    vehicleGrossCents,
    vehicleGrossRealizedAtClosing,
    dealerCashReceivedAtClosingCents,
    dealerCapitalStillExposedCents,
    projectedFinanceIncomeCents,
    combinedExpectedEconomicsCents,
    lease,
    ratePolicy,
    riskFlags: [...riskFlags],
    riskLabels: [...riskFlags].map((flag) => DEAL_RISK_LABELS[flag]),
    reasons,
    score,
  };
}

type DealFlagList = DealRiskFlag[];

/* -------------------------------------------------------------------------- */
/* COMPARISON & RECOMMENDATION                                                 */
/* -------------------------------------------------------------------------- */

export interface DealComparison {
  structures: DealStructure[];
  /** Feasible structures, best first. */
  ranked: DealStructure[];
  recommended: DealStructure | null;
  headline: string;
  reasons: string[];
  /** Modes that could not be built, and exactly why. */
  unavailable: { mode: DealPaymentMode; reason: string }[];
}

/**
 * Ranks feasible, SCORED structures deterministically.
 *
 * Each structure carries the score it was built with, so the ranking honours
 * whatever weights the caller supplied to `compareDealStructures` (which
 * threads them into every structure it builds).
 *
 * A structure is only ranked when it carries a score, and a score only exists
 * when the engine knew the landed cost. A viewer who is masked out of the cost
 * basis therefore receives structures without a ranking rather than a ranking
 * built on a fabricated margin.
 *
 * Sort: score descending, then the mode's fixed order in DEAL_PAYMENT_MODES.
 * The tie-break matters — two structures can genuinely score identically, and
 * the answer must not depend on the order the caller passed them in.
 */
export function rankDealStructures(structures: readonly DealStructure[]): DealStructure[] {
  return [...structures]
    .filter((structure) => structure.feasible && structure.score !== null)
    .sort((a, b) => {
      const diff = (b.score?.total ?? 0) - (a.score?.total ?? 0);
      if (diff !== 0) return diff;
      return DEAL_PAYMENT_MODES.indexOf(a.mode) - DEAL_PAYMENT_MODES.indexOf(b.mode);
    });
}

export function compareDealStructures(
  inputs: readonly DealStructureInput[],
  scoring?: Partial<DealScoringWeights>,
): DealComparison {
  // The comparison-level weights reach EVERY structure: a per-input `scoring`
  // override still wins, but a caller who passes weights here gets them applied
  // rather than silently ranked on the defaults.
  const structures = inputs.map((input) =>
    input.scoring === undefined && scoring !== undefined ? { ...input, scoring } : input,
  ).map((input) => structureDeal(input));

  const ranked = rankDealStructures(structures);
  const recommended = ranked[0] ?? null;
  const runnerUp = ranked[1] ?? null;

  const unavailable = structures
    .filter((structure) => !structure.feasible)
    .map((structure) => ({
      mode: structure.mode,
      reason: structure.unavailableReason ?? "This structure could not be built.",
    }));

  const reasons: string[] = [];
  if (recommended) {
    reasons.push(...explainRecommendation(recommended, runnerUp));
  } else if (structures.some((structure) => structure.feasible)) {
    reasons.push(
      "No structure was ranked: ranking compares each structure's return on the dealership's capital, and the cost basis is not visible to your role. The customer's terms for every feasible structure are shown in full.",
    );
  } else {
    reasons.push(
      "No structure could be built from the inputs supplied. Fill in the missing terms listed against each payment mode.",
    );
  }

  return {
    structures,
    ranked,
    recommended,
    headline: recommended
      ? `RECOMMENDED: ${DEAL_PAYMENT_MODE_LABELS[recommended.mode].toUpperCase()}`
      : structures.some((structure) => structure.feasible)
        ? "NO RANKING — DEAL ECONOMICS NOT VISIBLE TO THIS ROLE"
        : "NO RECOMMENDATION — NO FEASIBLE STRUCTURE",
    reasons,
    unavailable,
  };
}

/**
 * Why the winner won, in the dealer's language.
 *
 * DELIBERATELY FREE OF COST FIGURES. These sentences are shown to every role
 * that can read a deal, including salespeople who are masked out of the
 * dealership's cost basis — so they speak in terms of capital recovered,
 * capital still at work, the customer's payment and the risk flags, and never
 * quote vehicle gross, margin or ROI. Those live in fields, which the masking
 * layer withholds per role.
 */
function explainRecommendation(winner: DealStructure, runnerUp: DealStructure | null): string[] {
  const reasons: string[] = [];

  if (winner.dealerCapitalStillExposedCents === 0) {
    reasons.push(
      "Full vehicle capital is recovered at closing, so the dealership keeps no receivable and no residual value risk.",
    );
  } else {
    reasons.push(
      `The dealership keeps ${formatCents(winner.dealerCapitalStillExposedCents)} of capital at work in this deal${winner.termMonths > 0 ? ` for ${winner.termMonths} months` : ""}.`,
    );
  }

  reasons.push(
    `Cash received at closing is ${formatCents(winner.dealerCashReceivedAtClosingCents)}${winner.dealerCapitalStillExposedCents > 0 ? ", with the balance collected over the term" : ""}.`,
  );

  if (winner.projectedFinanceIncomeCents > 0) {
    reasons.push(
      `The contract carries ${formatCents(winner.projectedFinanceIncomeCents)} of finance charge over ${winner.numberOfPayments} payments — finance income, reported separately from the vehicle's gross and never merged into it.`,
    );
  }

  if (winner.vehicleGrossRealizedAtClosing) {
    reasons.push("The vehicle's gross is realised at closing rather than collected over the term.");
  } else {
    reasons.push(
      "The vehicle's gross is NOT realised at closing: it is recovered through the payments and the residual value.",
    );
  }

  if (winner.ratePolicy.withinConfiguredRatePolicy === false) {
    reasons.push(`Note: ${winner.ratePolicy.statement}`);
  } else if (winner.ratePolicy.withinConfiguredRatePolicy === null && winner.mode !== "CASH") {
    reasons.push(winner.ratePolicy.statement);
  }

  const blocking = winner.riskFlags.filter((flag) => BLOCKING_DEAL_RISK_FLAGS.includes(flag));
  if (blocking.length > 0) {
    reasons.push(
      `Caution: ${blocking.map((flag) => DEAL_RISK_LABELS[flag]).join(", ")} — this structure should not be presented as sound.`,
    );
  } else if (winner.riskFlags.length > 0) {
    reasons.push(`Risk flags: ${winner.riskFlags.map((flag) => DEAL_RISK_LABELS[flag]).join(", ")}.`);
  }

  if (runnerUp) {
    reasons.push(
      `Ranked ahead of ${DEAL_PAYMENT_MODE_LABELS[runnerUp.mode]} because capital recovery, immediate cash and margin are weighted above finance income.`,
    );
  }

  return reasons;
}

/** The comparison's columns, exactly as a dealer would read them. */
export function dealStructureColumns(structure: DealStructure): {
  cashReceivedAtClosingCents: Cents;
  vehicleGrossCents: Cents | null;
  capitalStillExposedCents: Cents;
  estimatedFinanceIncomeCents: Cents;
  combinedExpectedEconomicsCents: Cents | null;
  termMonths: number;
  paymentAmountCents: Cents;
  paymentFrequency: PaymentFrequency;
  paymentsPerYear: number;
  riskFlags: DealRiskFlag[];
} {
  return {
    cashReceivedAtClosingCents: structure.dealerCashReceivedAtClosingCents,
    vehicleGrossCents: structure.vehicleGrossCents,
    capitalStillExposedCents: structure.dealerCapitalStillExposedCents,
    estimatedFinanceIncomeCents: structure.projectedFinanceIncomeCents,
    combinedExpectedEconomicsCents: structure.combinedExpectedEconomicsCents,
    termMonths: structure.termMonths,
    paymentAmountCents: structure.paymentAmountCents,
    paymentFrequency: structure.paymentFrequency,
    paymentsPerYear: periodsPerYear(structure.paymentFrequency),
    riskFlags: structure.riskFlags,
  };
}

/** Term options a dealer actually quotes, for a payment-mode picker. */
export const DEAL_TERM_OPTIONS_MONTHS = [12, 24, 36, 48, 60, 72, 84] as const;
export type DealTermMonths = (typeof DEAL_TERM_OPTIONS_MONTHS)[number];
