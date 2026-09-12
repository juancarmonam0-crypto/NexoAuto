/**
 * CONSERVATIVE RETAIL POLICY — market evidence in, one defensible number out.
 *
 * THE DIVISION OF LABOUR THIS FILE ENFORCES
 *   MARKET DATA estimates what the vehicle is WORTH.
 *   NEXO decides what we can AFFORD TO PAY (see `src/lib/sourcing.ts`).
 * This module is the boundary between the two, and it is deliberately the only
 * place where a market number is turned into an acquisition assumption.
 *
 * WHY IT IS CONSERVATIVE
 * Everything a market API gives us is optimistic in one specific way:
 *   - an ADVERTISED price is not a SOLD price;
 *   - a predicted price is a model output, not an offer;
 *   - the cheapest way to lose money on a used car is to buy against the top of
 *     the market and sell into the middle of it.
 * So every source is discounted, and when two sources disagree we take the
 * LOWER one. That is a policy choice, it is documented here, and it is tested —
 * not a heuristic buried in a UI component.
 *
 * WHY IT IS DETERMINISTIC
 * Same snapshot + same mileage + same override = same number, always. There is
 * no randomness, no clock-dependent behaviour, no language model, and no
 * network call in this file. An LLM may one day EXPLAIN the evidence; it must
 * never produce the number, because an acquisition decision has to be
 * reproducible months later when someone asks why we paid what we paid.
 */

import { type BasisPoints, type Cents, formatCents, toCents } from "./money";
import type { MarketComparable, MarketValuationSnapshot } from "./providers/types";

/** Bump when the arithmetic below changes, so a stored result can be explained. */
export const CONSERVATIVE_RETAIL_POLICY_VERSION = "v1";

/**
 * Discount applied to a provider's own price prediction, in basis points.
 * 200 bps = 2%. A prediction is a model output; we do not pay for optimism.
 */
export const PREDICTION_HAIRCUT_BASIS_POINTS: BasisPoints = 200;

/**
 * Discount applied to the comparable ADVERTISED price distribution, in basis
 * points. 300 bps = 3%, larger than the prediction haircut because an asking
 * price is the seller's hope rather than anybody's estimate.
 */
export const COMPARABLE_ASKING_HAIRCUT_BASIS_POINTS: BasisPoints = 300;

/**
 * How many comparable vehicles must survive the relevance filter before their
 * distribution is trusted at all. Below this, a couple of hopeful listings
 * would move the acquisition price.
 */
export const MIN_COMPARABLES_FOR_DISTRIBUTION = 3;

/**
 * Mileage relevance band: a comparable is only used when its odometer is within
 * 25% of the subject's (never narrower than 10,000 miles, so a low-mileage
 * subject still has a market to compare against).
 */
export const MILEAGE_RELEVANCE_BAND_BASIS_POINTS: BasisPoints = 2_500;
export const MILEAGE_RELEVANCE_MIN_BAND = 10_000;

/**
 * Two independent sources are called "in agreement" when they land within this
 * share of each other. Agreement is what raises confidence; it never raises the
 * price.
 */
export const SOURCE_AGREEMENT_BAND_BASIS_POINTS: BasisPoints = 1_000;

/** Conservative rounding: never round a retail assumption UP. */
export const RETAIL_ROUNDING_CENTS = 100;

export type RetailSource = "manual" | "market-comparables" | "market-prediction" | "none";

export interface ComparableSummary {
  total: number;
  /**
   * How many comparables CARRIED a usable asking price. A listing with no price,
   * a zero price or a negative price is counted in NEITHER `priced` nor `used`:
   * it is evidence that exists but cannot move a valuation.
   */
  priced: number;
  /** How many priced comparables survived the mileage relevance filter. */
  used: number;
  filteredByMileage: number;
  medianAskingCents: Cents | null;
  lowAskingCents: Cents | null;
  highAskingCents: Cents | null;
  /** The band actually applied to this subject, for display. */
  mileageBand: number;
}

export interface ConservativeRetailEvidence {
  predictedPriceCents: Cents | null;
  comparableSummary: ComparableSummary | null;
  /** The discounted figure each source produced, before the conservative MIN. */
  predictionCandidateCents: Cents | null;
  comparableCandidateCents: Cents | null;
}

export interface ConservativeRetailResult {
  /** The number to feed the economics engine. Null means "use the manual flow". */
  retailCents: Cents | null;
  source: RetailSource;
  confidence: "low" | "medium" | "high" | null;
  /** What the MARKET alone suggested, preserved even when overridden. */
  marketEstimateCents: Cents | null;
  /** True when the operator's number is the one in use. */
  overridden: boolean;
  policyVersion: string;
  evidence: ConservativeRetailEvidence;
  reasons: string[];
  warnings: string[];
}

/** A discount applied to a source, rounded UP so the result is never optimistic. */
function discountCents(priceCents: Cents, basisPoints: BasisPoints): Cents {
  const price = toCents(priceCents);
  const haircut = Math.ceil((price * Math.max(0, Math.round(basisPoints))) / 10_000);
  return Math.max(0, price - haircut);
}

/** Round a money assumption DOWN to whole dollars. Conservatism, in one line. */
function roundDownToStep(valueCents: Cents, step: number = RETAIL_ROUNDING_CENTS): Cents {
  const safeStep = Math.max(1, Math.round(step));
  return Math.max(0, Math.floor(toCents(valueCents) / safeStep) * safeStep);
}

function median(sortedValues: readonly number[]): number | null {
  if (sortedValues.length === 0) return null;
  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[middle]!;
  return Math.round((sortedValues[middle - 1]! + sortedValues[middle]!) / 2);
}

/**
 * The mileage band for one subject: 25% of its odometer, never less than 10,000
 * miles, so a 4,000-mile car is not compared only against other 4,000-mile cars.
 */
export function mileageRelevanceBand(mileage: number): number {
  const safeMileage = Math.max(0, Math.round(mileage));
  const proportional = Math.round((safeMileage * MILEAGE_RELEVANCE_BAND_BASIS_POINTS) / 10_000);
  return Math.max(MILEAGE_RELEVANCE_MIN_BAND, proportional);
}

/**
 * Summarizes comparables for a subject: keeps the ones that are relevant (priced
 * and within the mileage band), and reports the distribution of what is left.
 */
export function summarizeComparables(
  comparables: readonly MarketComparable[],
  subjectMileage: number,
): ComparableSummary {
  const band = mileageRelevanceBand(subjectMileage);
  let priced = 0;
  let filteredByMileage = 0;
  const usedPrices: number[] = [];

  for (const comparable of comparables) {
    const price = comparable.askingPriceCents;
    if (price === undefined || price === null || price <= 0) continue;
    priced += 1;

    const mileage = comparable.mileage;
    if (mileage !== undefined && mileage !== null) {
      if (Math.abs(Math.round(mileage) - Math.round(subjectMileage)) > band) {
        filteredByMileage += 1;
        continue;
      }
    }
    usedPrices.push(toCents(price));
  }

  const sorted = [...usedPrices].sort((a, b) => a - b);
  return {
    total: comparables.length,
    priced,
    used: sorted.length,
    filteredByMileage,
    medianAskingCents: median(sorted),
    lowAskingCents: sorted.length === 0 ? null : sorted[0]!,
    highAskingCents: sorted.length === 0 ? null : sorted[sorted.length - 1]!,
    mileageBand: band,
  };
}

export interface ConservativeRetailInput {
  /** Null when the market could not be reached — the manual flow then applies. */
  snapshot: MarketValuationSnapshot | null;
  /** The subject vehicle's odometer. */
  mileage: number;
  /** The operator's own number, when they have set one. */
  manualRetailCents?: Cents | null;
}

/**
 * Turns market evidence into the single retail figure the economics engine uses.
 *
 * THE POLICY, IN ORDER:
 *   1. A manual override wins outright and is labelled as such. The market
 *      estimate is still computed and preserved for comparison, so overriding
 *      never destroys what the market said.
 *   2. Otherwise, discount each available source:
 *        prediction  - PREDICTION_HAIRCUT_BASIS_POINTS
 *        comparable median asking - COMPARABLE_ASKING_HAIRCUT_BASIS_POINTS
 *      The comparable median is only used when at least
 *      MIN_COMPARABLES_FOR_DISTRIBUTION relevant comparables survive.
 *   3. Take the LOWER of the sources that are available. Disagreement is
 *      resolved against us, never in our favour.
 *   4. Round DOWN to whole dollars.
 *   5. If no source produced a number, return `none` and let Analyze fall back
 *      to the operator's manual expected retail. Never a guess.
 */
export function deriveConservativeRetail(input: ConservativeRetailInput): ConservativeRetailResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const snapshot = input.snapshot;

  const comparableSummary =
    snapshot === null ? null : summarizeComparables(snapshot.comparables, input.mileage);

  const predictedPriceCents =
    snapshot?.predictedPriceCents !== undefined && snapshot?.predictedPriceCents !== null
      ? toCents(snapshot.predictedPriceCents)
      : null;

  const predictionCandidateCents =
    predictedPriceCents === null ? null : discountCents(predictedPriceCents, PREDICTION_HAIRCUT_BASIS_POINTS);

  const comparableCandidateCents =
    comparableSummary !== null &&
    comparableSummary.used >= MIN_COMPARABLES_FOR_DISTRIBUTION &&
    comparableSummary.medianAskingCents !== null
      ? discountCents(comparableSummary.medianAskingCents, COMPARABLE_ASKING_HAIRCUT_BASIS_POINTS)
      : null;

  const candidates: { source: "market-prediction" | "market-comparables"; cents: Cents }[] = [];
  if (predictionCandidateCents !== null) {
    candidates.push({ source: "market-prediction", cents: predictionCandidateCents });
  }
  if (comparableCandidateCents !== null) {
    candidates.push({ source: "market-comparables", cents: comparableCandidateCents });
  }

  const best = candidates.reduce<{ source: RetailSource; cents: Cents } | null>(
    (lowest, candidate) => (lowest === null || candidate.cents < lowest.cents ? candidate : lowest),
    null,
  );
  const marketEstimateCents = best === null ? null : roundDownToStep(best.cents);

  // Confidence is about AGREEMENT, not about the size of the number.
  let confidence: "low" | "medium" | "high" | null = null;
  if (marketEstimateCents !== null) {
    if (predictionCandidateCents !== null && comparableCandidateCents !== null) {
      const higher = Math.max(predictionCandidateCents, comparableCandidateCents);
      const lower = Math.min(predictionCandidateCents, comparableCandidateCents);
      const gapBasisPoints = higher === 0 ? 10_000 : Math.round(((higher - lower) * 10_000) / higher);
      confidence =
        gapBasisPoints <= SOURCE_AGREEMENT_BAND_BASIS_POINTS
          ? "high"
          : gapBasisPoints <= 2 * SOURCE_AGREEMENT_BAND_BASIS_POINTS
            ? "medium"
            : "low";
      reasons.push(
        `The prediction and the comparable distribution are within ${(gapBasisPoints / 100).toFixed(1)}% of each other, so confidence is ${confidence}.`,
      );
    } else if (predictionCandidateCents !== null) {
      confidence = "medium";
      reasons.push(
        "Only the provider's price prediction was usable, so confidence is medium.",
      );
    } else {
      confidence = "low";
      reasons.push(
        "Only comparables were usable (no price prediction was returned), so confidence is low.",
      );
    }
  }

  const reasonsForMarket: string[] = [...reasons];
  if (predictedPriceCents !== null) {
    reasonsForMarket.push(
      `The provider predicted ${formatCents(predictedPriceCents)}; after a ${(PREDICTION_HAIRCUT_BASIS_POINTS / 100).toFixed(2)}% prediction haircut that is ${formatCents(predictionCandidateCents ?? 0)}.`,
    );
  } else {
    warnings.push("The provider returned no price prediction for this vehicle.");
  }

  if (comparableSummary !== null) {
    if (comparableSummary.used >= MIN_COMPARABLES_FOR_DISTRIBUTION && comparableSummary.medianAskingCents !== null) {
      reasonsForMarket.push(
        `The comparable median ADVERTISED price is ${formatCents(comparableSummary.medianAskingCents)} across ${comparableSummary.used} relevant listings; after a ${(COMPARABLE_ASKING_HAIRCUT_BASIS_POINTS / 100).toFixed(2)}% advertised-price haircut that is ${formatCents(comparableCandidateCents ?? 0)}.`,
      );
    } else {
      warnings.push(
        `Only ${comparableSummary.used} comparable${comparableSummary.used === 1 ? "" : "s"} survived the mileage filter (${comparableSummary.filteredByMileage} were filtered out and ${comparableSummary.priced} carried a price); ${MIN_COMPARABLES_FOR_DISTRIBUTION} are required before the distribution is used, so it was ignored.`,
      );
    }
  }

  if (marketEstimateCents !== null && best !== null) {
    reasonsForMarket.push(
      `The conservative policy takes the LOWER usable source, so the market estimate is ${formatCents(marketEstimateCents)} (${best.source === "market-prediction" ? "provider prediction" : "comparable distribution"}).`,
    );
  }

  // ---- manual override wins, but never erases the market number
  const manual =
    input.manualRetailCents === undefined || input.manualRetailCents === null
      ? null
      : toCents(input.manualRetailCents);

  if (manual !== null && manual > 0) {
    const reasonsManual = [
      `The operator overrode the market estimate with ${formatCents(manual)}, and the override is what the economics use.`,
    ];
    if (marketEstimateCents !== null) {
      const difference = manual - marketEstimateCents;
      reasonsManual.push(
        `The market estimate of ${formatCents(marketEstimateCents)} is preserved for comparison: the override is ${difference >= 0 ? "above" : "below"} it by ${formatCents(Math.abs(difference))}.`,
      );
    } else {
      reasonsManual.push("No market estimate was available, so nothing was overridden.");
    }
    return {
      retailCents: manual,
      source: "manual",
      confidence: null,
      marketEstimateCents,
      overridden: true,
      policyVersion: CONSERVATIVE_RETAIL_POLICY_VERSION,
      evidence: { predictedPriceCents, comparableSummary, predictionCandidateCents, comparableCandidateCents },
      reasons: reasonsManual,
      warnings,
    };
  }

  if (marketEstimateCents === null) {
    return {
      retailCents: null,
      source: "none",
      confidence: null,
      marketEstimateCents: null,
      overridden: false,
      policyVersion: CONSERVATIVE_RETAIL_POLICY_VERSION,
      evidence: { predictedPriceCents, comparableSummary, predictionCandidateCents, comparableCandidateCents },
      reasons: [
        "No usable market evidence was available (no price prediction and not enough relevant comparables), so Nexo will not guess a retail value. Enter the expected retail manually to run the acquisition analysis.",
      ],
      warnings,
    };
  }

  return {
    retailCents: marketEstimateCents,
    source: best?.source ?? "none",
    confidence,
    marketEstimateCents,
    overridden: false,
    policyVersion: CONSERVATIVE_RETAIL_POLICY_VERSION,
    evidence: { predictedPriceCents, comparableSummary, predictionCandidateCents, comparableCandidateCents },
    reasons: reasonsForMarket,
    warnings,
  };
}
