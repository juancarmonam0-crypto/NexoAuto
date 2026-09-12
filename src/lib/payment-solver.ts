/**
 * PAYMENT SOLVERS — the inverse of the canonical amortisation engine.
 *
 * WHY THIS FILE EXISTS
 * An operator does not think in principals and rates. They think "I want this
 * deal around $450 a month" or "the customer can put $2,000 down and pay $375 a
 * fortnight — what fits?". Those are INVERSE questions, and the Phase 9B engine
 * only answers the forward one. This module answers them without adding a
 * second amortisation implementation.
 *
 * THE ONE RULE THAT MAKES THAT POSSIBLE
 * `maxPrincipalForPaymentCents` is a BINARY SEARCH over the canonical forward
 * function `computeLevelPaymentCents`. It does not invert the annuity formula by
 * hand and it does not approximate: it asks the one engine "what would the
 * payment be at this principal?" repeatedly until it finds the largest principal
 * whose payment does not exceed the target. Search over the single source of
 * truth, never a re-derivation of it.
 *
 * WHY BINARY SEARCH IS EXACT HERE
 * `computeLevelPaymentCents` is monotonically non-decreasing in the principal, so
 * the predicate `payment(p) <= target` is monotone and a bisection finds the
 * boundary exactly, in ~31 steps for any realistic principal. The result is
 * verified by construction: the returned principal is one the forward engine
 * itself confirmed.
 *
 * DETERMINISM
 * The candidate terms are a fixed, documented list; ties break on term length
 * and then on the canonical payment-mode order. Same inputs, same answer, on
 * every machine.
 *
 * WHAT THIS IS NOT
 * Not underwriting, not lender approval, not an affordability or credit
 * judgement. It answers one question only: *given a stated down payment and a
 * stated maximum payment, which deal structures mathematically fit?* It never
 * reads, stores or infers income, debt, credit standing, immigration status,
 * citizenship, nationality, race or ethnicity — no such field exists anywhere in
 * this product.
 */

import { type BasisPoints, type Cents, formatCents, toCents } from "./money";
import {
  type DealPaymentMode,
  type DealScoringWeights,
  type DealStructure,
  DEAL_PAYMENT_MODE_LABELS,
  rankDealStructures,
  structureDeal,
} from "./deal-structuring";
import {
  type PaymentFrequency,
  computeLevelPaymentCents,
  numberOfPaymentsFor,
  periodsPerYear,
} from "./finance-engine";
import type { FinanceRatePolicy } from "./rate-policy";

/**
 * The terms a payment target is searched across.
 *
 * A fixed list, not a continuum, so the operator sees the terms a dealership
 * actually quotes — and so the answer is reproducible.
 */
export const SOLVER_TERM_CANDIDATES_MONTHS = [12, 18, 24, 30, 36, 42, 48, 60, 72, 84] as const;

/** Modes that produce a periodic payment, i.e. the ones a solver can search. */
export const FINANCED_PAYMENT_MODES: readonly DealPaymentMode[] = [
  "EXTERNAL_FINANCE",
  "BUY_HERE_PAY_HERE",
  "LEASE",
  "LEASE_TO_OWN",
];

export interface SolverRatePolicyInput {
  policies?: readonly FinanceRatePolicy[];
  jurisdiction: string;
  asOf: string | Date;
  vehicleModelYear?: number | null;
}

export interface SolverSharedInput {
  sellingPriceCents: Cents;
  /** null when the acting role may not see the cost basis. */
  landedCostCents: Cents | null;
  dealerFeesCents?: Cents;
  salesTaxBasisPoints?: BasisPoints;
  tradeInAllowanceCents?: Cents;
  tradeInPayoffCents?: Cents;
  paymentFrequency?: PaymentFrequency;
  firstPaymentDate?: string | null;
  lease?: {
    residualValueCents: Cents;
    capCostReductionCents?: Cents;
    moneyFactorAprBasisPoints?: BasisPoints;
    purchaseOptionCents?: Cents;
  } | null;
  ratePolicy?: SolverRatePolicyInput | null;
  scoring?: Partial<DealScoringWeights>;
}

/**
 * The largest principal whose level payment does not exceed the target.
 *
 * A bisection over the canonical forward engine.
 *
 * THE UPPER BOUND MATTERS, AND `target x periods` IS NOT ENOUGH. That figure is
 * the principal at 0% APR *before rounding*, but the forward engine rounds the
 * payment to the cent: at 0% the payment is `round(P / n)`, which still equals
 * the target for every principal up to `n x target + n/2 - 1`. Seeding the
 * search with `target x periods` therefore returned a principal that was not
 * maximal — `P + 1` still paid the target — which this bound fixes. Higher rates
 * support strictly less principal, so the 0% case is the binding one and this
 * bound is safe for every rate.
 *
 * (A test caught this: the returned principal was 1,200,000 where the true
 * boundary at 0% over 60 months was 1,200,029.)
 */
export function maxPrincipalForPaymentCents(
  targetPaymentCents: Cents,
  aprBasisPoints: BasisPoints,
  numberOfPayments: number,
  frequency: PaymentFrequency = "MONTHLY",
): Cents {
  const target = toCents(targetPaymentCents);
  const periods = Math.round(numberOfPayments);
  if (target === 0 || periods < 1) return 0;

  let low = 0;
  let high = Math.max(0, Math.round(target) * periods + Math.ceil(periods / 2));
  const paymentAt = (principal: number) =>
    computeLevelPaymentCents(principal, aprBasisPoints, periods, frequency);

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (paymentAt(mid) <= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

/* -------------------------------------------------------------------------- */
/* How much money down would bring a term to the target?                        */
/* -------------------------------------------------------------------------- */

/**
 * The down payment that brings one candidate term to the payment target, and the
 * principal-equivalent that leaves.
 *
 * A LOAN AND A LEASE DO NOT RESPOND TO MONEY DOWN THE SAME WAY.
 * On a loan only the financed principal shrinks, so the answer comes straight
 * from `maxPrincipalForPaymentCents`. On a lease the rent charge is levied on
 * `adjusted cap cost + residual`, so a larger cap cost reduction cuts BOTH the
 * depreciation and the rent — the payment falls faster than a loan's.
 *
 * Using the loan inversion for a lease produced a required down payment of
 * $12,996 for a 12-month term that FIT with the customer's existing $2,000 down
 * (a test caught it). So the lease case bisects the cap cost reduction through
 * the canonical lease engine instead: no second formula, and the answer is one
 * the engine itself confirmed.
 */
function requiredDownPaymentForTarget(params: {
  buildAt: (downPaymentCents: number) => DealStructure;
  isLease: boolean;
  targetPaymentCents: Cents;
  aprBasisPoints: BasisPoints;
  numberOfPayments: number;
  frequency: PaymentFrequency;
  amountDueCents: Cents;
  tradeInAllowanceCents: Cents;
  grossCapCostCents: Cents;
}): { requiredDownPaymentCents: Cents; maxAmountFinancedCents: Cents } {
  if (!params.isLease) {
    const maxAmountFinancedCents = maxPrincipalForPaymentCents(
      params.targetPaymentCents,
      params.aprBasisPoints,
      params.numberOfPayments,
      params.frequency,
    );
    // Financing less is always allowed, so the down payment needed is whatever
    // covers the rest of the amount due.
    return {
      maxAmountFinancedCents,
      requiredDownPaymentCents: Math.max(
        0,
        params.amountDueCents - params.tradeInAllowanceCents - maxAmountFinancedCents,
      ),
    };
  }

  const capCostCeiling = Math.max(0, params.grossCapCostCents);
  if (params.buildAt(capCostCeiling).paymentAmountCents > params.targetPaymentCents) {
    // Even putting the entire capitalised cost down does not reach the target:
    // the residual's rent charge alone exceeds it. Report the ceiling honestly
    // rather than a number that cannot work.
    return { requiredDownPaymentCents: capCostCeiling, maxAmountFinancedCents: 0 };
  }

  let low = 0;
  let high = capCostCeiling;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (params.buildAt(mid).paymentAmountCents <= params.targetPaymentCents) high = mid;
    else low = mid + 1;
  }

  return {
    requiredDownPaymentCents: low,
    maxAmountFinancedCents: params.buildAt(low).amounts.amountFinancedCents,
  };
}

/* -------------------------------------------------------------------------- */
/* TARGET MONTHLY PAYMENT                                                      */
/* -------------------------------------------------------------------------- */

export interface TargetPaymentInput extends SolverSharedInput {
  mode: DealPaymentMode;
  aprBasisPoints: BasisPoints;
  /** Cash the customer puts in up front. */
  downPaymentCents: Cents;
  /** The periodic payment the operator wants to land at or under. */
  targetPaymentCents: Cents;
  termCandidatesMonths?: readonly number[];
}

export interface TargetPaymentOption {
  termMonths: number;
  numberOfPayments: number;
  /** The payment at the AVAILABLE down payment. */
  paymentAmountCents: Cents;
  amountFinancedCents: Cents;
  /** The most the customer could finance and still meet the target at this term. */
  maxAmountFinancedCents: Cents;
  /** The down payment that would bring this term to the target. */
  requiredDownPaymentCents: Cents;
  /** payment - target. Positive means the available down payment is not enough. */
  gapCents: Cents;
  fits: boolean;
  financeChargeCents: Cents;
  totalCustomerOutlayCents: Cents;
  dealerCapitalStillExposedCents: Cents;
  vehicleGrossCents: Cents | null;
  /** The full engine structure, so the caller can render or persist it. */
  structure: DealStructure;
}

export interface TargetPaymentResult {
  mode: DealPaymentMode;
  modeLabel: string;
  targetPaymentCents: Cents;
  downPaymentCents: Cents;
  aprBasisPoints: BasisPoints;
  paymentFrequency: PaymentFrequency;
  /** Every candidate term, feasible or not, shortest first. */
  options: TargetPaymentOption[];
  feasible: TargetPaymentOption[];
  shortestFeasibleTermMonths: number | null;
  recommended: TargetPaymentOption | null;
  headline: string;
  reasons: string[];
  warnings: string[];
}

/**
 * Solves "what term gets me to this payment?" for one mode.
 *
 * For each candidate term the engine computes the actual payment at the
 * available down payment, and separately the largest principal that would meet
 * the target — so the operator can either extend the term or add down payment,
 * with the exact figure for each.
 */
export function solveTargetPayment(input: TargetPaymentInput): TargetPaymentResult {
  const frequency = input.paymentFrequency ?? "MONTHLY";
  const target = toCents(input.targetPaymentCents);
  const down = toCents(input.downPaymentCents);
  const apr = Math.max(0, Math.round(input.aprBasisPoints));
  const candidates = [...(input.termCandidatesMonths ?? SOLVER_TERM_CANDIDATES_MONTHS)].sort(
    (a, b) => a - b,
  );

  const warnings: string[] = [];
  const reasons: string[] = [];
  const options: TargetPaymentOption[] = [];

  for (const termMonths of candidates) {
    // A builder at this term, so the required-down-payment search can ask the
    // canonical engine what a DIFFERENT amount down would do.
    const buildAt = (downPaymentCents: number) =>
      structureDeal({
        mode: input.mode,
        sellingPriceCents: input.sellingPriceCents,
        landedCostCents: input.landedCostCents,
        dealerFeesCents: input.dealerFeesCents,
        salesTaxBasisPoints: input.salesTaxBasisPoints,
        tradeInAllowanceCents: input.tradeInAllowanceCents,
        tradeInPayoffCents: input.tradeInPayoffCents,
        downPaymentCents,
        aprBasisPoints: apr,
        termMonths,
        paymentFrequency: frequency,
        firstPaymentDate: input.firstPaymentDate ?? null,
        lease: input.lease ?? null,
        ratePolicy: input.ratePolicy ?? null,
        scoring: input.scoring,
      });

    const structure = buildAt(down);

    if (!structure.feasible || structure.numberOfPayments < 1) {
      warnings.push(
        `${termMonths} months: ${structure.unavailableReason ?? "this structure could not be built."}`,
      );
      continue;
    }

    const requirement = requiredDownPaymentForTarget({
      buildAt,
      isLease: input.mode === "LEASE" || input.mode === "LEASE_TO_OWN",
      targetPaymentCents: target,
      aprBasisPoints: structure.aprBasisPoints,
      numberOfPayments: structure.numberOfPayments,
      frequency,
      amountDueCents: structure.amounts.amountDueCents,
      tradeInAllowanceCents: structure.amounts.tradeInAllowanceCents,
      grossCapCostCents: structure.lease?.grossCapCostCents ?? 0,
    });

    const paymentAmountCents = structure.paymentAmountCents;
    options.push({
      termMonths,
      numberOfPayments: structure.numberOfPayments,
      paymentAmountCents,
      amountFinancedCents: structure.amounts.amountFinancedCents,
      maxAmountFinancedCents: requirement.maxAmountFinancedCents,
      requiredDownPaymentCents: requirement.requiredDownPaymentCents,
      gapCents: paymentAmountCents - target,
      fits: paymentAmountCents > 0 && paymentAmountCents <= target,
      financeChargeCents: structure.financeChargeCents,
      totalCustomerOutlayCents: structure.totalCustomerOutlayCents,
      dealerCapitalStillExposedCents: structure.dealerCapitalStillExposedCents,
      vehicleGrossCents: structure.vehicleGrossCents,
      structure,
    });
  }

  const feasible = options.filter((option) => option.fits);
  const reference = feasible[0] ?? options[0] ?? null;

  let headline: string;
  if (feasible.length > 0) {
    const shortest = feasible.reduce((best, option) =>
      option.termMonths < best.termMonths ? option : best,
    );
    headline = `FITS AT ${shortest.termMonths} MONTHS — ${formatCents(shortest.paymentAmountCents)} PER ${frequencyLabel(frequency)}`;
    reasons.push(
      `A ${shortest.termMonths}-month term at ${formatCents(shortest.paymentAmountCents)} per ${frequencyLabel(frequency)} is at or under the ${formatCents(target)} target with ${formatCents(down)} down.`,
    );
    if (feasible.length > 1) {
      const longest = feasible[feasible.length - 1]!;
      reasons.push(
        `${feasible.length} of ${options.length} candidate terms fit; the longest is ${longest.termMonths} months at ${formatCents(longest.paymentAmountCents)}.`,
      );
    }
  } else if (options.length > 0) {
    const cheapest = options.reduce((best, option) =>
      option.paymentAmountCents < best.paymentAmountCents ? option : best,
    );
    headline = "NO FEASIBLE TERM AT THIS DOWN PAYMENT";
    reasons.push(
      `The lowest payment any candidate term reaches is ${formatCents(cheapest.paymentAmountCents)} at ${cheapest.termMonths} months, which is ${formatCents(cheapest.gapCents)} above the ${formatCents(target)} target.`,
    );
    reasons.push(
      `At ${cheapest.termMonths} months the deal needs ${formatCents(cheapest.requiredDownPaymentCents)} down instead of ${formatCents(down)} to reach the target.`,
    );
  } else {
    headline = "NO STRUCTURE COULD BE BUILT";
    reasons.push(
      "No candidate term produced a structure: the mode needs terms the inputs did not supply.",
    );
  }

  return {
    mode: input.mode,
    modeLabel: DEAL_PAYMENT_MODE_LABELS[input.mode],
    targetPaymentCents: target,
    downPaymentCents: down,
    aprBasisPoints: reference?.structure.aprBasisPoints ?? apr,
    paymentFrequency: frequency,
    options,
    feasible,
    shortestFeasibleTermMonths:
      feasible.length === 0
        ? null
        : feasible.reduce((best, option) => Math.min(best, option.termMonths), Number.POSITIVE_INFINITY),
    recommended:
      feasible.length === 0
        ? null
        : feasible.reduce((best, option) =>
            // Shortest term first: the same payment is reached with less interest
            // and less time at risk.
            option.termMonths < best.termMonths ? option : best,
          ),
    headline,
    reasons,
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* FIT A PAYMENT BUDGET                                                        */
/* -------------------------------------------------------------------------- */

export interface PaymentBudgetInput extends SolverSharedInput {
  /** Cash the customer can put in up front. */
  downPaymentCents: Cents;
  /** The most the customer can pay per period. */
  maxPaymentCents: Cents;
  /** Which modes the operator is willing to consider. */
  modes?: readonly DealPaymentMode[];
  /** A rate per mode; a mode without one is reported as unavailable. */
  aprBasisPointsByMode?: Partial<Record<DealPaymentMode, BasisPoints>>;
  termCandidatesMonths?: readonly number[];
}

export interface PaymentBudgetOption {
  mode: DealPaymentMode;
  modeLabel: string;
  termMonths: number;
  numberOfPayments: number;
  paymentAmountCents: Cents;
  amountFinancedCents: Cents;
  amountDueCents: Cents;
  financeChargeCents: Cents;
  totalCustomerOutlayCents: Cents;
  dealerCapitalStillExposedCents: Cents;
  vehicleGrossCents: Cents | null;
  aprBasisPoints: BasisPoints;
  withinBudget: boolean;
  structure: DealStructure;
}

export interface PaymentBudgetResult {
  maxPaymentCents: Cents;
  downPaymentCents: Cents;
  paymentFrequency: PaymentFrequency;
  /** Every option built, ranked, whether or not it fits the budget. */
  allOptions: PaymentBudgetOption[];
  /** Only the options inside the budget, best first. */
  options: PaymentBudgetOption[];
  shortestFeasibleTermMonths: number | null;
  recommended: PaymentBudgetOption | null;
  headline: string;
  reasons: string[];
  warnings: string[];
  unavailable: { mode: DealPaymentMode; reason: string }[];
}

/**
 * Answers "which structures fit this payment budget?".
 *
 * Every candidate (mode x term) is built by the canonical engine and kept only
 * when its payment is inside the stated budget. The survivors are ranked by the
 * SAME scoring and ranking the Deal Desk uses, so the recommendation here and
 * the recommendation there can never disagree.
 */
export function fitPaymentBudget(input: PaymentBudgetInput): PaymentBudgetResult {
  const frequency = input.paymentFrequency ?? "MONTHLY";
  const down = toCents(input.downPaymentCents);
  const maxPayment = toCents(input.maxPaymentCents);
  const modes = input.modes ?? FINANCED_PAYMENT_MODES;
  const candidates = [...(input.termCandidatesMonths ?? SOLVER_TERM_CANDIDATES_MONTHS)].sort(
    (a, b) => a - b,
  );

  const warnings: string[] = [];
  const unavailable: { mode: DealPaymentMode; reason: string }[] = [];
  const structures: DealStructure[] = [];
  const built: PaymentBudgetOption[] = [];

  for (const mode of modes) {
    const apr = input.aprBasisPointsByMode?.[mode];
    if (apr === undefined) {
      unavailable.push({
        mode,
        reason: `No rate was supplied for ${DEAL_PAYMENT_MODE_LABELS[mode]}, so its payment cannot be quoted.`,
      });
      continue;
    }

    for (const termMonths of candidates) {
      const structure = structureDeal({
        mode,
        sellingPriceCents: input.sellingPriceCents,
        landedCostCents: input.landedCostCents,
        dealerFeesCents: input.dealerFeesCents,
        salesTaxBasisPoints: input.salesTaxBasisPoints,
        tradeInAllowanceCents: input.tradeInAllowanceCents,
        tradeInPayoffCents: input.tradeInPayoffCents,
        downPaymentCents: down,
        aprBasisPoints: apr,
        termMonths,
        paymentFrequency: frequency,
        firstPaymentDate: input.firstPaymentDate ?? null,
        lease: input.lease ?? null,
        ratePolicy: input.ratePolicy ?? null,
        scoring: input.scoring,
      });

      if (!structure.feasible || structure.numberOfPayments < 1) continue;

      built.push({
        mode,
        modeLabel: DEAL_PAYMENT_MODE_LABELS[mode],
        termMonths,
        numberOfPayments: structure.numberOfPayments,
        paymentAmountCents: structure.paymentAmountCents,
        amountFinancedCents: structure.amounts.amountFinancedCents,
        amountDueCents: structure.amounts.amountDueCents,
        financeChargeCents: structure.financeChargeCents,
        totalCustomerOutlayCents: structure.totalCustomerOutlayCents,
        dealerCapitalStillExposedCents: structure.dealerCapitalStillExposedCents,
        vehicleGrossCents: structure.vehicleGrossCents,
        aprBasisPoints: structure.aprBasisPoints,
        withinBudget: structure.paymentAmountCents > 0 && structure.paymentAmountCents <= maxPayment,
        structure,
      });
      structures.push(structure);
    }
  }

  const withinBudget = built.filter((option) => option.withinBudget);
  // Rank through the canonical comparison so the order and the recommendation
  // are produced by the same engine the Deal Desk uses.
  const rankedStructures = rankDealStructures(
    withinBudget.map((option) => option.structure),
  );
  const rankIndex = new Map(rankedStructures.map((structure, index) => [structure, index]));
  const options = [...withinBudget].sort((a, b) => {
    const ai = rankIndex.get(a.structure) ?? Number.POSITIVE_INFINITY;
    const bi = rankIndex.get(b.structure) ?? Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    // Deterministic fallback when neither was rankable (no visible cost basis):
    // cheapest payment first, then shortest term, then mode order.
    if (a.paymentAmountCents !== b.paymentAmountCents) {
      return a.paymentAmountCents - b.paymentAmountCents;
    }
    if (a.termMonths !== b.termMonths) return a.termMonths - b.termMonths;
    return modes.indexOf(a.mode) - modes.indexOf(b.mode);
  });

  const shortestFeasibleTermMonths =
    options.length === 0
      ? null
      : options.reduce((best, option) => Math.min(best, option.termMonths), Number.POSITIVE_INFINITY);

  // The recommendation is the top-ranked option; when nothing is rankable the
  // cheapest payment among the shortest terms wins, and the reason says so.
  const rankable = options.find((option) => option.structure.score !== null) ?? null;
  const recommended = rankable ?? options[0] ?? null;

  const reasons: string[] = [];
  const headline =
    recommended === null
      ? "NO FEASIBLE STRUCTURE"
      : `FITS: ${recommended.modeLabel.toUpperCase()} — ${recommended.termMonths} MONTHS AT ${formatCents(recommended.paymentAmountCents)} PER ${frequencyLabel(frequency)}`;

  if (recommended === null) {
    const cheapest = built.reduce<PaymentBudgetOption | null>(
      (best, option) => (best === null || option.paymentAmountCents < best.paymentAmountCents ? option : best),
      null,
    );
    reasons.push(
      `Nothing fits ${formatCents(maxPayment)} per ${frequencyLabel(frequency)} with ${formatCents(down)} down across the modes and terms considered.`,
    );
    if (cheapest) {
      reasons.push(
        `The closest option is ${cheapest.modeLabel} over ${cheapest.termMonths} months at ${formatCents(cheapest.paymentAmountCents)} per ${frequencyLabel(frequency)} — ${formatCents(cheapest.paymentAmountCents - maxPayment)} above the budget.`,
      );
    }
    if (built.length === 0) {
      reasons.push(
        "No structure could be built at all: check that a rate and a term are available for the selected modes.",
      );
    }
  } else {
    reasons.push(
      `${options.length} of ${built.length} built structures fit ${formatCents(maxPayment)} per ${frequencyLabel(frequency)} with ${formatCents(down)} down.`,
    );
    reasons.push(
      `The shortest feasible term is ${shortestFeasibleTermMonths} months; the recommended option finances ${formatCents(recommended.amountFinancedCents)} and the customer pays ${formatCents(recommended.totalCustomerOutlayCents)} in total.`,
    );
    if (recommended.dealerCapitalStillExposedCents > 0) {
      reasons.push(
        `This structure leaves ${formatCents(recommended.dealerCapitalStillExposedCents)} of capital at work in the deal.`,
      );
    } else {
      reasons.push("This structure leaves no dealer capital exposed after closing.");
    }
    if (recommended.structure.score === null) {
      reasons.push(
        "Options are ordered by payment and term because the cost basis is not visible to your role, so no return-based ranking is shown.",
      );
    } else {
      reasons.push(...recommended.structure.reasons.slice(0, 2));
    }
  }

  return {
    maxPaymentCents: maxPayment,
    downPaymentCents: down,
    paymentFrequency: frequency,
    allOptions: built,
    options,
    shortestFeasibleTermMonths,
    recommended,
    headline,
    reasons,
    warnings,
    unavailable,
  };
}

function frequencyLabel(frequency: PaymentFrequency): string {
  switch (frequency) {
    case "MONTHLY":
      return "month";
    case "SEMIMONTHLY":
      return "half-month";
    case "BIWEEKLY":
      return "two weeks";
    case "WEEKLY":
      return "week";
  }
}

/** Payments per year, re-exported so a caller can explain a frequency. */
export function paymentsPerYear(frequency: PaymentFrequency): number {
  return periodsPerYear(frequency);
}

/** How many payments a term produces at a frequency — the UI's own arithmetic. */
export function paymentsForTerm(termMonths: number, frequency: PaymentFrequency): number {
  return numberOfPaymentsFor(termMonths, frequency);
}
