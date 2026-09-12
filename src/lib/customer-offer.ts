/**
 * CUSTOMER OFFER ENGINE — the SELL side of Nexo's intelligence.
 *
 * The BUY side answers "how much can Nexo pay for this car?".
 * This module answers the question the operator actually asks in front of a
 * customer: "what is the best deal Nexo can responsibly OFFER, given what this
 * customer can put down and pay per month?"
 *
 *   NEXO KNOWS THE MATH. THE OPERATOR DECIDES THE BUSINESS.
 *
 * WHAT THIS IS NOT
 * Not underwriting, not a credit decision, not an affordability judgement, not
 * lender approval. The customer STATES a down payment and a maximum payment; this
 * module answers only which structures mathematically fit those stated numbers
 * while preserving the dealership's configured economics. It reads no income, no
 * debt, no credit data, no bureau data, and no protected characteristic — none of
 * those fields exist anywhere in this product, and none was added. An LLM plays
 * no part: every number and the verdict are deterministic and reproducible.
 *
 * WHAT IT REUSES (no formula is re-implemented here)
 *   - `computeRecommendedPricing`  -> the canonical economic floor (minimum acceptable sale price)
 *   - `computeContractAmounts`     -> the contract arithmetic (tax, fees, trade-in, amount financed)
 *   - `computeLevelPaymentCents`   -> the canonical forward payment
 *   - `structureDeal`              -> the whole costed structure (gross, finance income, exposure, policy)
 *   - `rankDealStructures`         -> the canonical business ranking
 *   - the rate-policy boundary     -> WITHIN/ABOVE/NO CONFIGURED POLICY, never a legal claim
 *
 * HOW IT SEARCHES
 * Every inverse is a BISECTION OVER THE CANONICAL FORWARD CHAIN, exactly like the
 * Phase 9 payment solver: the engine is asked "what would this cost at that price
 * / with that much down?" repeatedly until the boundary is found. There is no
 * inverted annuity formula and no second amortisation implementation in this file.
 *
 * VEHICLE GROSS AND FINANCE INCOME ARE NEVER MERGED. They are separate fields on
 * every option and separate lines in the result. There is deliberately no
 * "total profit" anywhere in this module.
 */

import { computeRoiBasisPoints } from "./economics";
import { type BasisPoints, type Cents, formatBasisPoints, formatCents, toCents } from "./money";
import {
  type DealPaymentMode,
  type DealScoringWeights,
  type DealStructure,
  DEAL_PAYMENT_MODE_LABELS,
  computeRecommendedPricing,
  rankDealStructures,
  structureDeal,
} from "./deal-structuring";
import {
  type PaymentFrequency,
  computeContractAmounts,
  computeLevelPaymentCents,
  numberOfPaymentsFor,
} from "./finance-engine";
import type { FinanceRatePolicy } from "./rate-policy";

/* -------------------------------------------------------------------------- */
/* Blocks and verdicts                                                        */
/* -------------------------------------------------------------------------- */

/** Why an offer cannot be accepted as asked. Deterministic and enumerated. */
export const OFFER_BLOCKERS = [
  "PAYMENT_TARGET_TOO_LOW",
  "DOWN_PAYMENT_TOO_LOW",
  "TERM_NOT_ALLOWED",
  "PRICE_BELOW_ECONOMIC_MINIMUM",
  "RATE_POLICY_VIOLATION",
  "UNSUPPORTED_FINANCE_MODE",
  "VEHICLE_COST_UNKNOWN",
  "NO_ALLOWED_TERMS",
  "STRUCTURE_NOT_BUILDABLE",
] as const;

export type OfferBlocker = (typeof OFFER_BLOCKERS)[number];

export const OFFER_BLOCKER_LABELS: Record<OfferBlocker, string> = {
  PAYMENT_TARGET_TOO_LOW: "The payment target is too low for this vehicle",
  DOWN_PAYMENT_TOO_LOW: "The down payment is too low for this payment target",
  TERM_NOT_ALLOWED: "No allowed term reaches the payment target",
  PRICE_BELOW_ECONOMIC_MINIMUM: "The sale price is below the dealership's economic minimum",
  RATE_POLICY_VIOLATION: "The rate is above the configured rate policy",
  UNSUPPORTED_FINANCE_MODE: "This finance mode cannot be structured from the data available",
  VEHICLE_COST_UNKNOWN: "The cost basis is not visible to your role, so the economic minimum cannot be verified",
  NO_ALLOWED_TERMS: "No payment terms are allowed for this offer",
  STRUCTURE_NOT_BUILDABLE: "No structure could be built from these inputs",
};

/**
 * ACCEPT — fits the customer's stated numbers, the dealership's economic floor
 *          and the configured rate policy.
 * ADJUST — a deal is possible, but something has to change (more down, a longer
 *          allowed term, a different price, a different rate, a manager's eyes on
 *          the margin). The result says which variable blocks it.
 * REJECT — the engine cannot build a structure at all under the current rules.
 *
 * REJECT is deliberately rare: more money down mathematically reduces a payment,
 * so the engine would rather hand the operator the exact adjustment than refuse.
 * It is reserved for an unsupported finance mode, no allowed terms, or a mode the
 * structure builder cannot cost.
 */
export type OfferVerdict = "ACCEPT" | "ADJUST" | "REJECT";

export const OFFER_VERDICT_LABELS: Record<OfferVerdict, string> = {
  ACCEPT: "DEAL RECOMMENDED",
  ADJUST: "ADJUST TO MAKE IT WORK",
  REJECT: "NO VALID STRUCTURE",
};

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

export interface CustomerOfferInput {
  /** Canonical landed cost, or null when the acting role may not see it. */
  landedCostCents: Cents | null;
  askingPriceCents: Cents;
  /** The vehicle's recorded target retail price, when it has one. */
  targetRetailPriceCents?: Cents | null;
  /** The dealership's configured floors (DealerSettings). */
  minGrossProfitCents: Cents;
  minRoiBasisPoints: BasisPoints;
  daysInInventory?: number | null;

  dealerFeesCents?: Cents;
  salesTaxBasisPoints?: BasisPoints;
  tradeInAllowanceCents?: Cents;
  tradeInPayoffCents?: Cents;

  /** What the customer says they can put down. */
  downPaymentCents: Cents;
  /** What the customer says they can pay per period. Null = no stated target. */
  maxPaymentCents: Cents | null;

  mode: DealPaymentMode;
  aprBasisPoints: BasisPoints;
  /** The terms the dealership allows this offer to use. */
  allowedTermsMonths: readonly number[];

  /** A negotiated price the operator proposes. Validated against the floor. */
  proposedSalePriceCents?: Cents | null;

  paymentFrequency?: PaymentFrequency;
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

/* -------------------------------------------------------------------------- */
/* Output                                                                     */
/* -------------------------------------------------------------------------- */

export interface CustomerOfferOption {
  termMonths: number;
  numberOfPayments: number;
  /** The sale price this option is priced at. */
  salePriceCents: Cents;
  /**
   * The highest sale price whose payment still fits the target at this term,
   * floored at the economic minimum. Null when no payment target was stated.
   */
  maxSalePriceForTargetCents: Cents | null;
  downPaymentCents: Cents;
  amountFinancedCents: Cents;
  paymentAmountCents: Cents;
  /** Finance/rent charge on the contract — NOT dealership cost. */
  financeChargeCents: Cents;
  totalCustomerOutlayCents: Cents;
  /** sale price - canonical landed cost. Null when the cost is not visible. */
  vehicleGrossCents: Cents | null;
  /** Return on the dealership's capital at this price. Null without a cost basis. */
  vehicleRoiBasisPoints: BasisPoints | null;
  /**
   * The finance charge Nexo expects to earn when the dealership carries the
   * note. A SEPARATE metric from vehicle gross; never added to it.
   */
  projectedFinanceIncomeCents: Cents;
  dealerCashReceivedAtClosingCents: Cents;
  dealerCapitalStillExposedCents: Cents;
  aprBasisPoints: BasisPoints;
  fitsPaymentTarget: boolean;
  /** True only when the price is VERIFIED at or above the economic floor. */
  meetsEconomicFloor: boolean;
  /** null = no configured rate policy, which is not the same as "within". */
  withinRatePolicy: boolean | null;
  /** The rate-policy status string, so a caller need not reach into `structure`. */
  ratePolicyStatus: string;
  /** The rate-policy sentence, verbatim from the engine. */
  ratePolicyStatement: string;
  /** The full engine structure, so the caller can display or apply it whole. */
  structure: DealStructure;
}

/** What would have to change for a deal to work. */
export interface MinimumViableOffer {
  termMonths: number;
  salePriceCents: Cents;
  downPaymentCents: Cents;
  amountFinancedCents: Cents;
  paymentAmountCents: Cents;
  vehicleGrossCents: Cents | null;
  /** Why this is the smallest change, in the operator's words. */
  reason: string;
}

export interface CustomerOfferResult {
  verdict: OfferVerdict;
  verdictLabel: string;
  mode: DealPaymentMode;
  modeLabel: string;

  askingPriceCents: Cents;
  /** The lowest sale price that still satisfies the configured economics. */
  minimumSalePriceCents: Cents | null;
  /** The price the dealership is aiming for. */
  targetSellingPriceCents: Cents | null;
  /** The price the recommendation is built on. */
  recommendedSalePriceCents: Cents | null;

  downPaymentCents: Cents;
  maxPaymentCents: Cents | null;
  aprBasisPoints: BasisPoints;
  paymentFrequency: PaymentFrequency;

  recommended: CustomerOfferOption | null;
  /** Every candidate term considered, shortest first. */
  options: CustomerOfferOption[];
  /** Options that fit the payment target, the price floor and the rate policy. */
  feasible: CustomerOfferOption[];
  minimumViable: MinimumViableOffer | null;

  blockers: OfferBlocker[];
  blockerLabels: string[];
  reasons: string[];
  warnings: string[];

  pricePolicy: {
    floorCents: Cents | null;
    targetCents: Cents | null;
    bindingConstraint: string | null;
    reasons: string[];
  };
}

/* -------------------------------------------------------------------------- */
/* Forward helpers — every one of them searches the canonical chain            */
/* -------------------------------------------------------------------------- */

/** The payment this contract would carry at a given sale price and term. */
function paymentAtPrice(params: {
  salePriceCents: Cents;
  termMonths: number;
  downPaymentCents: Cents;
  aprBasisPoints: BasisPoints;
  frequency: PaymentFrequency;
  dealerFeesCents: Cents;
  salesTaxBasisPoints: BasisPoints;
  tradeInAllowanceCents: Cents;
  tradeInPayoffCents: Cents;
}): { paymentCents: Cents; amountFinancedCents: Cents; numberOfPayments: number } {
  const amounts = computeContractAmounts({
    sellingPriceCents: params.salePriceCents,
    dealerFeesCents: params.dealerFeesCents,
    salesTaxBasisPoints: params.salesTaxBasisPoints,
    tradeInAllowanceCents: params.tradeInAllowanceCents,
    tradeInPayoffCents: params.tradeInPayoffCents,
    downPaymentCents: params.downPaymentCents,
  });
  const numberOfPayments = numberOfPaymentsFor(params.termMonths, params.frequency);
  const paymentCents = computeLevelPaymentCents(
    amounts.amountFinancedCents,
    params.aprBasisPoints,
    numberOfPayments,
    params.frequency,
  );
  return { paymentCents, amountFinancedCents: amounts.amountFinancedCents, numberOfPayments };
}

/**
 * The highest sale price at or below `ceilingCents` whose payment does not exceed
 * `targetPaymentCents`, floored at `minimumCents`.
 *
 * The payment is monotone non-decreasing in the sale price, so a bisection finds
 * the boundary exactly — and it asks the canonical forward chain, never an
 * inverted formula. Returns null when even the FLOOR price exceeds the target,
 * which is the honest answer: nothing at or above the economic minimum fits.
 */
function highestPriceFittingPayment(params: {
  minimumCents: Cents;
  ceilingCents: Cents;
  targetPaymentCents: Cents;
  termMonths: number;
  downPaymentCents: Cents;
  aprBasisPoints: BasisPoints;
  frequency: PaymentFrequency;
  dealerFeesCents: Cents;
  salesTaxBasisPoints: BasisPoints;
  tradeInAllowanceCents: Cents;
  tradeInPayoffCents: Cents;
}): Cents | null {
  const at = (salePriceCents: number) =>
    paymentAtPrice({ ...params, salePriceCents }).paymentCents;

  if (at(params.minimumCents) > params.targetPaymentCents) return null;

  let low = Math.max(0, Math.round(params.minimumCents));
  let high = Math.max(low, Math.round(params.ceilingCents));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (at(mid) <= params.targetPaymentCents) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * The smallest down payment, at a given price and term, whose payment does not
 * exceed the target — found by bisecting the canonical forward chain. Returns
 * null when even paying the entire amount due up front cannot reach the target,
 * which should be impossible for a positive number of payments, and is reported
 * honestly rather than asserted away.
 */
function requiredDownPaymentForTarget(params: {
  salePriceCents: Cents;
  termMonths: number;
  targetPaymentCents: Cents;
  currentDownPaymentCents: Cents;
  aprBasisPoints: BasisPoints;
  frequency: PaymentFrequency;
  dealerFeesCents: Cents;
  salesTaxBasisPoints: BasisPoints;
  tradeInAllowanceCents: Cents;
  tradeInPayoffCents: Cents;
}): Cents | null {
  const amounts = computeContractAmounts({
    sellingPriceCents: params.salePriceCents,
    dealerFeesCents: params.dealerFeesCents,
    salesTaxBasisPoints: params.salesTaxBasisPoints,
    tradeInAllowanceCents: params.tradeInAllowanceCents,
    tradeInPayoffCents: params.tradeInPayoffCents,
    downPaymentCents: 0,
  });
  // Paying the whole amount due leaves nothing financed, so the payment is zero.
  const ceiling = Math.max(params.currentDownPaymentCents, amounts.amountDueCents - amounts.tradeInAllowanceCents);

  const paymentAtDown = (downPaymentCents: number) =>
    paymentAtPrice({ ...params, downPaymentCents }).paymentCents;

  if (paymentAtDown(ceiling) > params.targetPaymentCents) return null;
  if (paymentAtDown(params.currentDownPaymentCents) <= params.targetPaymentCents) {
    return params.currentDownPaymentCents;
  }

  let low = Math.max(0, Math.round(params.currentDownPaymentCents));
  let high = Math.max(low, Math.round(ceiling));
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (paymentAtDown(mid) <= params.targetPaymentCents) high = mid;
    else low = mid + 1;
  }
  return low;
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Builds every candidate offer for one vehicle, one customer budget and one
 * payment mode, then recommends the best one under the dealership's own rules.
 *
 * SALE PRICE LOGIC: the offer never prices ABOVE what the operator proposed (a
 * customer offer above the sticker would be nonsense), and it never prices BELOW
 * the canonical economic floor (that is the whole point of the floor). So for
 * each allowed term the price is the highest one that both fits the payment
 * target and stays at or above the floor.
 */
export function recommendCustomerOffer(input: CustomerOfferInput): CustomerOfferResult {
  const frequency = input.paymentFrequency ?? "MONTHLY";
  const mode = input.mode;
  const modeLabel = DEAL_PAYMENT_MODE_LABELS[mode];
  const askingPriceCents = toCents(input.askingPriceCents);
  const downPaymentCents = toCents(input.downPaymentCents);
  const maxPaymentCents = input.maxPaymentCents === null ? null : toCents(input.maxPaymentCents);
  const aprBasisPoints = Math.max(0, Math.round(input.aprBasisPoints));

  const dealerFeesCents = toCents(input.dealerFeesCents ?? 0);
  const salesTaxBasisPoints = Math.max(0, Math.round(input.salesTaxBasisPoints ?? 0));
  const tradeInAllowanceCents = toCents(input.tradeInAllowanceCents ?? 0);
  const tradeInPayoffCents = toCents(input.tradeInPayoffCents ?? 0);

  const reasons: string[] = [];
  const warnings: string[] = [];
  const blockers = new Set<OfferBlocker>();

  const terms = [...new Set(input.allowedTermsMonths.map((term) => Math.round(term)))]
    .filter((term) => term > 0)
    .sort((a, b) => a - b);
  if (terms.length === 0) blockers.add("NO_ALLOWED_TERMS");

  // ---- 1. THE CANONICAL ECONOMIC FLOOR (reused, never re-derived)
  let minimumSalePriceCents: Cents | null = null;
  let targetSellingPriceCents: Cents | null = null;
  let bindingConstraint: string | null = null;
  const priceReasons: string[] = [];

  if (input.landedCostCents === null) {
    blockers.add("VEHICLE_COST_UNKNOWN");
    warnings.push(
      "The cost basis is not visible to your role, so the dealership's minimum acceptable sale price cannot be computed. The payment maths below is still exact, but the margin on this offer cannot be confirmed here.",
    );
  } else {
    const ladder = computeRecommendedPricing({
      landedCostCents: input.landedCostCents,
      policy: {
        minGrossProfitCents: input.minGrossProfitCents,
        minRoiBasisPoints: input.minRoiBasisPoints,
        marketTargetCents: input.targetRetailPriceCents ?? null,
      },
      daysInInventory: input.daysInInventory ?? null,
    });
    minimumSalePriceCents = ladder.minimumApproved.priceCents;
    targetSellingPriceCents = ladder.target.priceCents;
    bindingConstraint = ladder.bindingConstraint;
    priceReasons.push(...ladder.reasons);
    reasons.push(
      `The dealership's minimum acceptable sale price is ${formatCents(minimumSalePriceCents)} (${formatCents(ladder.minimumApproved.grossProfitCents)} gross${ladder.minimumApproved.roiBasisPoints === null ? "" : `, ${(ladder.minimumApproved.roiBasisPoints / 100).toFixed(2)}% return`}); the target price is ${formatCents(targetSellingPriceCents)}.`,
    );
  }

  // ---- 2. WHAT PRICE ARE WE OFFERING AT?
  const proposed = input.proposedSalePriceCents === undefined || input.proposedSalePriceCents === null
    ? null
    : toCents(input.proposedSalePriceCents);
  const basePriceCents = proposed ?? (askingPriceCents > 0 ? askingPriceCents : targetSellingPriceCents ?? 0);

  if (minimumSalePriceCents !== null && basePriceCents < minimumSalePriceCents) {
    blockers.add("PRICE_BELOW_ECONOMIC_MINIMUM");
    warnings.push(
      `${formatCents(basePriceCents)} is below the minimum acceptable sale price of ${formatCents(minimumSalePriceCents)}, so this offer cannot meet the dealership's economics.`,
    );
  }

  // The ceiling for any payment-driven price search: never above what the
  // operator proposed, because raising the price to hit a payment target would
  // be quoting the customer more than they were asked for.
  const priceCeilingCents = Math.max(0, proposed ?? (askingPriceCents > 0 ? askingPriceCents : basePriceCents));

  // ---- 3. ONE OPTION PER ALLOWED TERM
  const options: CustomerOfferOption[] = [];

  for (const termMonths of terms) {
    let salePriceCents = priceCeilingCents;
    let maxSalePriceForTargetCents: Cents | null = null;

    // THE PRICE IS ONLY EVER LOWERED TO FIT A PAYMENT WHEN THE FLOOR IS KNOWN.
    // Without a visible cost basis the floor is unknown, and quietly shaving the
    // price to reach a monthly number could breach the dealership's minimum
    // without anyone seeing it. A masked viewer therefore gets the honest payment
    // for the price they proposed, not a silently discounted one.
    if (maxPaymentCents !== null && minimumSalePriceCents !== null && mode !== "CASH") {
      maxSalePriceForTargetCents = highestPriceFittingPayment({
        minimumCents: minimumSalePriceCents,
        ceilingCents: priceCeilingCents,
        targetPaymentCents: maxPaymentCents,
        termMonths,
        downPaymentCents,
        aprBasisPoints,
        frequency,
        dealerFeesCents,
        salesTaxBasisPoints,
        tradeInAllowanceCents,
        tradeInPayoffCents,
      });
      if (maxSalePriceForTargetCents === null) {
        // Nothing at or above the floor fits this target at this term.
        blockers.add("PAYMENT_TARGET_TOO_LOW");
        // Never price ABOVE what the operator proposed: when their number sits
        // below the floor the option shows THEIR price, flagged as below the
        // floor, rather than quietly quoting a higher one.
        salePriceCents = Math.min(priceCeilingCents, minimumSalePriceCents);
      } else {
        salePriceCents = Math.min(priceCeilingCents, maxSalePriceForTargetCents);
      }
    }

    const structure = structureDeal({
      mode,
      sellingPriceCents: salePriceCents,
      landedCostCents: input.landedCostCents,
      dealerFeesCents,
      salesTaxBasisPoints,
      tradeInAllowanceCents,
      tradeInPayoffCents,
      downPaymentCents,
      aprBasisPoints,
      termMonths,
      paymentFrequency: frequency,
      firstPaymentDate: input.firstPaymentDate ?? null,
      lease: input.lease ?? null,
      ratePolicy: input.ratePolicy ?? null,
      scoring: input.scoring,
    });

    // A CASH sale is a VALID structure with no schedule at all: `structureDeal`
    // reports `numberOfPayments: 0` and a zero payment for it, which is the truth,
    // not a failure. Only a structure that actually FINANCES money while having no
    // schedule is broken. (Dropping cash here made the entire cash path
    // unreachable: a cash offer at or above the floor came back as REJECT with no
    // options. A test caught it.)
    const financesSomething = structure.amounts.amountFinancedCents > 0;
    if (!structure.feasible || (financesSomething && structure.numberOfPayments < 1)) {
      blockers.add("UNSUPPORTED_FINANCE_MODE");
      warnings.push(
        `${termMonths} months: ${structure.unavailableReason ?? "this structure could not be built."}`,
      );
      continue;
    }

    const fitsPaymentTarget = maxPaymentCents === null || structure.paymentAmountCents <= maxPaymentCents;
    const meetsEconomicFloor =
      minimumSalePriceCents !== null && salePriceCents >= minimumSalePriceCents && structure.vehicleGrossCents !== null
        ? structure.vehicleGrossCents >= 0
        : false;
    const withinRatePolicy = structure.ratePolicy.withinConfiguredRatePolicy;

    if (withinRatePolicy === false) {
      blockers.add("RATE_POLICY_VIOLATION");
      warnings.push(`${termMonths} months: ${structure.ratePolicy.statement}`);
    }

    options.push({
      termMonths,
      numberOfPayments: structure.numberOfPayments,
      salePriceCents,
      maxSalePriceForTargetCents,
      downPaymentCents: structure.amounts.downPaymentCents,
      amountFinancedCents: structure.amounts.amountFinancedCents,
      paymentAmountCents: structure.paymentAmountCents,
      financeChargeCents: structure.financeChargeCents,
      totalCustomerOutlayCents: structure.totalCustomerOutlayCents,
      vehicleGrossCents: structure.vehicleGrossCents,
      vehicleRoiBasisPoints:
        structure.vehicleGrossCents === null || input.landedCostCents === null
          ? null
          : computeRoiBasisPoints(structure.vehicleGrossCents, input.landedCostCents),
      projectedFinanceIncomeCents: structure.projectedFinanceIncomeCents,
      dealerCashReceivedAtClosingCents: structure.dealerCashReceivedAtClosingCents,
      dealerCapitalStillExposedCents: structure.dealerCapitalStillExposedCents,
      aprBasisPoints: structure.aprBasisPoints,
      fitsPaymentTarget,
      meetsEconomicFloor,
      withinRatePolicy,
      ratePolicyStatus: structure.ratePolicy.status,
      ratePolicyStatement: structure.ratePolicy.statement,
      structure,
    });
  }

  // ---- 4. FEASIBLE = fits the payment, is verified against the floor, and is
  //         inside the configured rate policy (when one is configured at all).
  //
  // A CASH offer is a valid structure with NO periodic payment at all, so the
  // "a payment must exist" rule is deliberately not applied to it: a cash deal at
  // or above the floor is exactly the offer the customer asked for.
  const isCashMode = mode === "CASH";
  const feasible = options.filter(
    (option) =>
      option.fitsPaymentTarget &&
      option.meetsEconomicFloor &&
      option.withinRatePolicy !== false &&
      (isCashMode || option.paymentAmountCents > 0),
  );

  // ---- 5. RANK WITH THE CANONICAL ENGINE (capital velocity, cash recovery,
  //         margin, exposure, credit risk, term length, risk-adjusted income).
  const rankedStructures = rankDealStructures(feasible.map((option) => option.structure));
  const rankIndex = new Map(rankedStructures.map((structure, index) => [structure, index]));
  const rankedOptions = [...feasible].sort((a, b) => {
    const ai = rankIndex.get(a.structure) ?? Number.POSITIVE_INFINITY;
    const bi = rankIndex.get(b.structure) ?? Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    // Deterministic fallback when nothing was rankable (a masked viewer has no
    // score): the SHORTEST term wins, because the same payment over less time is
    // less interest and less capital at risk.
    return a.termMonths - b.termMonths;
  });
  const recommended = rankedOptions[0] ?? null;

  if (recommended !== null && rankIndex.size === 0) {
    reasons.push(
      "Options are ordered by term length because the cost basis is not visible to your role, so no return-based ranking is shown.",
    );
  }

  // ---- 6. WHAT WOULD HAVE TO CHANGE?
  let minimumViable: MinimumViableOffer | null = null;
  // A CASH offer has no periodic payment to fit, so "put more money down" is not
  // the adjustment for it — the PRICE is, and that is already reported as
  // `minimumSalePriceCents` plus the PRICE_BELOW_ECONOMIC_MINIMUM blocker.
  if (
    recommended === null &&
    maxPaymentCents !== null &&
    minimumSalePriceCents !== null &&
    terms.length > 0 &&
    mode !== "CASH"
  ) {
    // The price is held at the economic floor — the cheapest honest price — and
    // the engine looks for the least extra money down that reaches the target,
    // preferring the shortest term that needs no more than any other.
    let best: { termMonths: number; downPaymentCents: Cents } | null = null;
    for (const termMonths of terms) {
      const required = requiredDownPaymentForTarget({
        salePriceCents: minimumSalePriceCents,
        termMonths,
        targetPaymentCents: maxPaymentCents,
        currentDownPaymentCents: downPaymentCents,
        aprBasisPoints,
        frequency,
        dealerFeesCents,
        salesTaxBasisPoints,
        tradeInAllowanceCents,
        tradeInPayoffCents,
      });
      if (required === null) continue;
      if (best === null || required < best.downPaymentCents) {
        best = { termMonths, downPaymentCents: required };
      }
    }

    if (best !== null && best.downPaymentCents > downPaymentCents) {
      blockers.add("DOWN_PAYMENT_TOO_LOW");
      const viableStructure = structureDeal({
        mode,
        sellingPriceCents: minimumSalePriceCents,
        landedCostCents: input.landedCostCents,
        dealerFeesCents,
        salesTaxBasisPoints,
        tradeInAllowanceCents,
        tradeInPayoffCents,
        downPaymentCents: best.downPaymentCents,
        aprBasisPoints,
        termMonths: best.termMonths,
        paymentFrequency: frequency,
        firstPaymentDate: input.firstPaymentDate ?? null,
        lease: input.lease ?? null,
        ratePolicy: input.ratePolicy ?? null,
        scoring: input.scoring,
      });
      if (viableStructure.feasible) {
        minimumViable = {
          termMonths: best.termMonths,
          salePriceCents: minimumSalePriceCents,
          downPaymentCents: best.downPaymentCents,
          amountFinancedCents: viableStructure.amounts.amountFinancedCents,
          paymentAmountCents: viableStructure.paymentAmountCents,
          vehicleGrossCents: viableStructure.vehicleGrossCents,
          reason: `At the minimum acceptable sale price of ${formatCents(minimumSalePriceCents)}, ${formatCents(best.downPaymentCents)} down over ${best.termMonths} months brings the payment to ${formatCents(viableStructure.paymentAmountCents)} — ${formatCents(best.downPaymentCents - downPaymentCents)} more down than the customer offered.`,
        };
        reasons.push(minimumViable.reason);
      }
    } else if (best === null) {
      blockers.add("TERM_NOT_ALLOWED");
      reasons.push(
        "None of the allowed terms can reach this payment target at the minimum acceptable sale price, even with the whole balance paid down.",
      );
    }
  }

  // ---- 7. THE VERDICT (deterministic; never a model's opinion)
  let verdict: OfferVerdict;
  if (recommended !== null && recommended.fitsPaymentTarget && recommended.meetsEconomicFloor && recommended.withinRatePolicy !== false) {
    verdict = "ACCEPT";
    reasons.push(
      `${modeLabel} over ${recommended.termMonths} months at ${formatCents(recommended.paymentAmountCents)} per period fits the customer's ${maxPaymentCents === null ? "stated budget (no maximum was given)" : formatCents(maxPaymentCents)} target, holds the sale price at or above the economic minimum, and is ${recommended.withinRatePolicy === null ? "not subject to a configured rate policy" : "within the configured rate policy"}.`,
    );
    reasons.push(
      `Vehicle gross ${formatCents(recommended.vehicleGrossCents ?? 0)} at a sale price of ${formatCents(recommended.salePriceCents)}.`,
    );
    if (recommended.projectedFinanceIncomeCents > 0) {
      reasons.push(
        `Projected finance income is ${formatCents(recommended.projectedFinanceIncomeCents)} — a SEPARATE revenue stream from the vehicle gross above, never added to it.`,
      );
    }
    reasons.push(
      recommended.dealerCapitalStillExposedCents === 0
        ? "No dealership capital stays exposed after closing."
        : `${formatCents(recommended.dealerCapitalStillExposedCents)} of dealership capital stays at work in this deal.`,
    );
  } else if (options.length > 0 || minimumViable !== null) {
    verdict = "ADJUST";
    reasons.push(
      minimumViable !== null
        ? `The customer's stated budget does not work as asked. ${minimumViable.reason}`
        : "A deal is possible, but something has to change before this offer meets both the customer's number and the dealership's rules.",
    );
  } else {
    verdict = "REJECT";
    reasons.push(
      "No structure can be built for this offer under the current rules. Check the finance mode, the allowed terms, and that the vehicle has the data the structure needs.",
    );
  }

  // A manual price under the floor can never be ACCEPTed, whatever the payments
  // look like — say so rather than letting a good monthly number hide it.
  if (verdict === "ACCEPT" && blockers.has("PRICE_BELOW_ECONOMIC_MINIMUM")) {
    verdict = "ADJUST";
    reasons.push(
      "The proposed sale price is below the dealership's economic minimum, so this cannot be accepted as written.",
    );
  }

  return {
    verdict,
    verdictLabel: OFFER_VERDICT_LABELS[verdict],
    mode,
    modeLabel,
    askingPriceCents,
    minimumSalePriceCents,
    targetSellingPriceCents,
    recommendedSalePriceCents: recommended?.salePriceCents ?? null,
    downPaymentCents,
    maxPaymentCents,
    aprBasisPoints,
    paymentFrequency: frequency,
    recommended,
    options,
    feasible,
    minimumViable,
    blockers: [...blockers],
    blockerLabels: [...blockers].map((blocker) => OFFER_BLOCKER_LABELS[blocker]),
    reasons,
    warnings,
    pricePolicy: {
      floorCents: minimumSalePriceCents,
      targetCents: targetSellingPriceCents,
      bindingConstraint,
      reasons: priceReasons,
    },
  };
}

/** The APR a structure would carry, formatted for an operator. */
export function describeOfferApr(aprBasisPoints: BasisPoints): string {
  return formatBasisPoints(aprBasisPoints, 2);
}

/** Terms a customer offer may use by default. Explicit, not open-ended. */
export const DEFAULT_OFFER_TERMS_MONTHS = [12, 24, 36, 42, 48, 60, 72, 84] as const;
