import { type BasisPoints, type Cents, formatCents, toCents } from "./money";

/**
 * Acquisition (auction / marketplace / trade-in) sourcing intelligence.
 *
 * DETERMINISTIC. Pure integer arithmetic. No AI, no external data source, and
 * no pretence that we have access to Manheim, Copart, IAA, Carfax, AutoCheck,
 * Facebook Marketplace or any valuation feed. A downstream provider can supply
 * the *inputs* (retail estimate, expected fees, transport); the arithmetic and
 * the recommendation are always computed here so the dealer can see exactly
 * which assumption drove the answer.
 */

export type SourcingDecision = "BUY" | "WATCH" | "PASS";

export interface SourcingEvaluationInput {
  /** Seller asking price, or the current auction bid. */
  askingPriceCents: Cents;
  expectedAuctionFeesCents?: Cents;
  transportEstimateCents?: Cents;
  estimatedReconCents?: Cents;
  otherCostsCents?: Cents;
  /** Expected retail sale price. 0 means "not estimated yet". */
  estimatedRetailCents: Cents;
  minGrossProfitCents?: Cents;
  minRoiBasisPoints?: BasisPoints;
}

export interface SourcingEvaluation {
  landedCostCents: Cents;
  expectedProfitCents: Cents;
  expectedRoiBasisPoints: BasisPoints | null;

  /** Total of fees + transport + recon + other (everything except the buy price). */
  addedCostsCents: Cents;

  maxPurchasePriceCents: Cents;
  maxBidCents: Cents;
  /** Which constraint set the ceiling. */
  bindingConstraint: "gross-profit-floor" | "roi-floor" | "roi-floor-only" | "none";

  /** Maximum price implied by the minimum gross profit requirement. */
  maxPriceFromGrossFloorCents: Cents;
  /** Maximum price implied by the minimum ROI requirement. */
  maxPriceFromRoiFloorCents: Cents | null;

  /** asking price - maximum purchase price. Negative means headroom. */
  overMaxByCents: Cents;

  recommendation: SourcingDecision;
  reasons: string[];
}

export const SOURCING_ROUNDING_CENTS = 100; // round ceilings to whole dollars

function floorTo(value: number, step: number): number {
  if (step <= 1) return Math.max(0, Math.floor(value));
  return Math.max(0, Math.floor(value / step) * step);
}

/**
 * Highest price that still satisfies BOTH thresholds.
 *
 *   profit = retail - (price + addedCosts) >= minGrossProfit
 *     => price <= retail - minGrossProfit - addedCosts
 *
 *   roi = profit / (price + addedCosts) >= minRoi
 *     => price + addedCosts <= retail / (1 + minRoi)
 *     => price <= retail / (1 + minRoi) - addedCosts
 */
export function computeMaxPurchasePrice(input: {
  estimatedRetailCents: Cents;
  addedCostsCents: Cents;
  minGrossProfitCents: Cents;
  minRoiBasisPoints: BasisPoints;
}): {
  maxPurchasePriceCents: Cents;
  maxPriceFromGrossFloorCents: Cents;
  maxPriceFromRoiFloorCents: Cents | null;
  bindingConstraint: SourcingEvaluation["bindingConstraint"];
} {
  const retail = toCents(input.estimatedRetailCents);
  const added = toCents(input.addedCostsCents);
  const minGross = toCents(input.minGrossProfitCents);
  const minRoi = Math.max(0, Math.round(input.minRoiBasisPoints));

  const maxPriceFromGrossFloorCents = floorTo(
    retail - minGross - added,
    SOURCING_ROUNDING_CENTS,
  );

  let maxPriceFromRoiFloorCents: number | null = null;
  if (minRoi > 0) {
    // retail / (1 + roi) with exact integer arithmetic, then round down.
    const landedCeiling = Math.floor((retail * 10_000) / (10_000 + minRoi));
    maxPriceFromRoiFloorCents = floorTo(landedCeiling - added, SOURCING_ROUNDING_CENTS);
  }

  let maxPurchasePriceCents: number;
  let bindingConstraint: SourcingEvaluation["bindingConstraint"];

  if (maxPriceFromRoiFloorCents === null) {
    maxPurchasePriceCents = maxPriceFromGrossFloorCents;
    bindingConstraint = maxPurchasePriceCents > 0 ? "gross-profit-floor" : "none";
  } else if (maxPriceFromGrossFloorCents <= maxPriceFromRoiFloorCents) {
    maxPurchasePriceCents = maxPriceFromGrossFloorCents;
    bindingConstraint = maxPurchasePriceCents > 0 ? "gross-profit-floor" : "none";
  } else {
    maxPurchasePriceCents = maxPriceFromRoiFloorCents;
    bindingConstraint = maxPurchasePriceCents > 0 ? "roi-floor" : "none";
  }

  return {
    maxPurchasePriceCents: Math.max(0, maxPurchasePriceCents),
    maxPriceFromGrossFloorCents,
    maxPriceFromRoiFloorCents,
    bindingConstraint,
  };
}

export function evaluateSourcingCandidate(input: SourcingEvaluationInput): SourcingEvaluation {
  const asking = toCents(input.askingPriceCents);
  const fees = toCents(input.expectedAuctionFeesCents ?? 0);
  const transport = toCents(input.transportEstimateCents ?? 0);
  const recon = toCents(input.estimatedReconCents ?? 0);
  const other = toCents(input.otherCostsCents ?? 0);
  const retail = toCents(input.estimatedRetailCents);
  const minGross = toCents(input.minGrossProfitCents ?? 0);
  const minRoi = Math.max(0, Math.round(input.minRoiBasisPoints ?? 0));

  const addedCostsCents = fees + transport + recon + other;
  const landedCostCents = asking + addedCostsCents;
  const expectedProfitCents = retail - landedCostCents;
  const expectedRoiBasisPoints =
    landedCostCents > 0 ? Math.round((expectedProfitCents / landedCostCents) * 10_000) : null;

  const ceiling = computeMaxPurchasePrice({
    estimatedRetailCents: retail,
    addedCostsCents,
    minGrossProfitCents: minGross,
    minRoiBasisPoints: minRoi,
  });

  const overMaxByCents = asking - ceiling.maxPurchasePriceCents;
  const reasons: string[] = [];
  let recommendation: SourcingDecision;

  if (retail <= 0) {
    // Honest failure mode: we cannot score a candidate without a retail estimate.
    recommendation = "WATCH";
    reasons.push(
      "No expected retail value is on file, so this candidate cannot be scored. Add a retail estimate to get a BUY or PASS.",
    );
    reasons.push(
      `At the recorded asking price of ${formatCents(asking)} the landed cost would be ${formatCents(landedCostCents)}.`,
    );
  } else if (asking <= ceiling.maxPurchasePriceCents && expectedProfitCents >= minGross && (expectedRoiBasisPoints ?? 0) >= minRoi) {
    recommendation = "BUY";
    reasons.push(
      `Asking ${formatCents(asking)} is at or below your maximum purchase price of ${formatCents(ceiling.maxPurchasePriceCents)}.`,
    );
    reasons.push(
      `Expected profit ${formatCents(expectedProfitCents)} meets your ${formatCents(minGross)} floor, at ${((expectedRoiBasisPoints ?? 0) / 100).toFixed(1)}% ROI against a ${(minRoi / 100).toFixed(1)}% minimum.`,
    );
  } else if (expectedProfitCents > 0) {
    recommendation = "WATCH";
    if (overMaxByCents > 0) {
      reasons.push(
        `Asking ${formatCents(asking)} is ${formatCents(overMaxByCents)} above your maximum purchase price of ${formatCents(ceiling.maxPurchasePriceCents)}.`,
      );
    }
    if (expectedProfitCents < minGross) {
      reasons.push(
        `Expected profit ${formatCents(expectedProfitCents)} is below your ${formatCents(minGross)} floor.`,
      );
    }
    if ((expectedRoiBasisPoints ?? 0) < minRoi) {
      reasons.push(
        `Expected ROI ${((expectedRoiBasisPoints ?? 0) / 100).toFixed(1)}% is below your ${(minRoi / 100).toFixed(1)}% minimum.`,
      );
    }
    reasons.push(
      `Still profitable at ${formatCents(expectedProfitCents)}, so it is worth watching if the price or recon estimate improves.`,
    );
  } else {
    recommendation = "PASS";
    reasons.push(
      `At ${formatCents(asking)} the expected profit is ${formatCents(expectedProfitCents)} — this unit loses money as priced.`,
    );
    reasons.push(
      `It would need to be bought at ${formatCents(ceiling.maxPurchasePriceCents)} or less to meet your thresholds.`,
    );
  }

  if (retail > 0) {
    reasons.push(
      `Landed cost ${formatCents(landedCostCents)} = ${formatCents(asking)} price + ${formatCents(addedCostsCents)} added costs (fees ${formatCents(fees)}, transport ${formatCents(transport)}, recon ${formatCents(recon)}, other ${formatCents(other)}).`,
    );
    reasons.push(
      ceiling.bindingConstraint === "roi-floor"
        ? "Your ROI floor is the binding constraint on the maximum offer."
        : ceiling.bindingConstraint === "gross-profit-floor"
          ? "Your gross profit floor is the binding constraint on the maximum offer."
          : "Your thresholds leave no room to buy this unit profitably.",
    );
  }

  return {
    landedCostCents,
    expectedProfitCents,
    expectedRoiBasisPoints,
    addedCostsCents,
    maxPurchasePriceCents: ceiling.maxPurchasePriceCents,
    // A bid is a purchase price. Same number, named for the auction screen.
    maxBidCents: ceiling.maxPurchasePriceCents,
    bindingConstraint: ceiling.bindingConstraint,
    maxPriceFromGrossFloorCents: ceiling.maxPriceFromGrossFloorCents,
    maxPriceFromRoiFloorCents: ceiling.maxPriceFromRoiFloorCents,
    overMaxByCents,
    recommendation,
    reasons,
  };
}

/**
 * A maximum bid reduced by a safety margin, for auctions where the hammer price
 * is unknown until it lands. marginBps of the ceiling is withheld.
 */
export function maxBidWithMargin(
  maxBidCents: Cents,
  marginBasisPoints: BasisPoints = 500,
): Cents {
  const margin = Math.round((toCents(maxBidCents) * Math.max(0, marginBasisPoints)) / 10_000);
  return Math.max(0, floorTo(maxBidCents - margin, SOURCING_ROUNDING_CENTS));
}

export const SOURCING_DECISION_LABELS: Record<SourcingDecision, string> = {
  BUY: "Buy",
  WATCH: "Watch",
  PASS: "Pass",
};

export const SOURCING_DECISION_LABELS_UPPER: Record<SourcingDecision, string> = {
  BUY: "BUY",
  WATCH: "WATCH",
  PASS: "PASS",
};
