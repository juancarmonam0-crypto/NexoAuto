import { describe, expect, it } from "vitest";
import type { SourcingEvaluationInput } from "@/lib/sourcing";
import {
  computeMaxPurchasePrice,
  evaluateSourcingCandidate,
  maxBidWithMargin,
  SOURCING_DECISION_LABELS,
  SOURCING_DECISION_LABELS_UPPER,
  SOURCING_ROUNDING_CENTS,
} from "@/lib/sourcing";

describe("sourcing — computeMaxPurchasePrice constraints", () => {
  it("derives the ceiling from the gross profit floor", () => {
    const result = computeMaxPurchasePrice({
      estimatedRetailCents: 2_000_000,
      addedCostsCents: 0,
      minGrossProfitCents: 150_000,
      minRoiBasisPoints: 0,
    });
    expect(result.maxPriceFromGrossFloorCents).toBe(1_850_000);
    expect(result.maxPriceFromRoiFloorCents).toBeNull(); // no ROI floor requested
    expect(result.maxPurchasePriceCents).toBe(1_850_000);
    expect(result.bindingConstraint).toBe("gross-profit-floor");
  });

  it("derives the ceiling from the ROI floor: price <= retail / (1 + roi)", () => {
    const result = computeMaxPurchasePrice({
      estimatedRetailCents: 2_000_000,
      addedCostsCents: 0,
      minGrossProfitCents: 0,
      minRoiBasisPoints: 1_000, // 10%
    });
    // 2,000,000 / 1.10 = 1,818,181.81 -> floored to whole dollars
    expect(result.maxPriceFromRoiFloorCents).toBe(1_818_100);
    expect(result.maxPurchasePriceCents).toBe(1_818_100);
    expect(result.bindingConstraint).toBe("roi-floor");
  });

  it("takes the lower of the two ceilings and names the binding one", () => {
    const grossIsLower = computeMaxPurchasePrice({
      estimatedRetailCents: 2_000_000,
      addedCostsCents: 0,
      minGrossProfitCents: 400_000, // -> 1,600,000
      minRoiBasisPoints: 1_000, // -> 1,818,100
    });
    expect(grossIsLower.maxPurchasePriceCents).toBe(1_600_000);
    expect(grossIsLower.bindingConstraint).toBe("gross-profit-floor");

    const roiIsLower = computeMaxPurchasePrice({
      estimatedRetailCents: 2_000_000,
      addedCostsCents: 0,
      minGrossProfitCents: 50_000, // -> 1,950,000
      minRoiBasisPoints: 1_000, // -> 1,818,100
    });
    expect(roiIsLower.maxPurchasePriceCents).toBe(1_818_100);
    expect(roiIsLower.bindingConstraint).toBe("roi-floor");
  });

  it("subtracts added costs (fees, transport, recon, other) from the ceiling", () => {
    const result = computeMaxPurchasePrice({
      estimatedRetailCents: 2_000_000,
      addedCostsCents: 250_000,
      minGrossProfitCents: 150_000,
      minRoiBasisPoints: 0,
    });
    expect(result.maxPriceFromGrossFloorCents).toBe(1_600_000); // 2,000,000 - 150,000 - 250,000
  });

  it("never returns a negative ceiling for an impossible acquisition", () => {
    const result = computeMaxPurchasePrice({
      estimatedRetailCents: 100_000,
      addedCostsCents: 500_000,
      minGrossProfitCents: 150_000,
      minRoiBasisPoints: 1_000,
    });
    expect(result.maxPurchasePriceCents).toBe(0);
    expect(result.maxPriceFromGrossFloorCents).toBe(0);
    expect(result.maxPriceFromRoiFloorCents).toBe(0);
    expect(result.bindingConstraint).toBe("none");
  });

  it("rounds ceilings down to whole dollars so an offer is a clean number", () => {
    expect(SOURCING_ROUNDING_CENTS).toBe(100);
    const result = computeMaxPurchasePrice({
      estimatedRetailCents: 1_000_050,
      addedCostsCents: 0,
      minGrossProfitCents: 0,
      minRoiBasisPoints: 0,
    });
    expect(result.maxPurchasePriceCents).toBe(1_000_000);
  });
});

describe("sourcing — BUY", () => {
  const BUY_INPUT = {
    askingPriceCents: 1_500_000,
    expectedAuctionFeesCents: 50_000,
    transportEstimateCents: 40_000,
    estimatedReconCents: 60_000,
    otherCostsCents: 10_000,
    estimatedRetailCents: 2_000_000,
    minGrossProfitCents: 150_000,
    minRoiBasisPoints: 1_000,
  };

  it("recommends BUY when price, gross and ROI all clear the thresholds", () => {
    const result = evaluateSourcingCandidate(BUY_INPUT);
    expect(result.recommendation).toBe("BUY");
    expect(result.addedCostsCents).toBe(160_000);
    expect(result.landedCostCents).toBe(1_660_000);
    expect(result.expectedProfitCents).toBe(340_000);
    expect(result.expectedRoiBasisPoints).toBe(2048);
    expect(result.maxPurchasePriceCents).toBe(1_658_100);
    expect(result.bindingConstraint).toBe("roi-floor");
    expect(result.overMaxByCents).toBe(-158_100); // headroom, not an overage
  });

  it("treats the maximum bid as the maximum purchase price", () => {
    const result = evaluateSourcingCandidate(BUY_INPUT);
    expect(result.maxBidCents).toBe(result.maxPurchasePriceCents);
  });

  it("buys at exactly the maximum purchase price (inclusive boundary)", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: 1_850_000,
      estimatedRetailCents: 2_000_000,
      minGrossProfitCents: 150_000,
      minRoiBasisPoints: 0,
    });
    expect(result.maxPurchasePriceCents).toBe(1_850_000);
    expect(result.expectedProfitCents).toBe(150_000);
    expect(result.recommendation).toBe("BUY");
  });

  it("explains the arithmetic in its reasons", () => {
    const result = evaluateSourcingCandidate(BUY_INPUT);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.reasons.join(" ")).toMatch(/maximum purchase price/);
    expect(result.reasons.join(" ")).toMatch(/ROI floor is the binding constraint/);
  });
});

describe("sourcing — WATCH", () => {
  it("watches a unit that is still profitable but above the ceiling and under the gross floor", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: 1_750_000,
      estimatedRetailCents: 2_000_000,
      minGrossProfitCents: 300_000,
      minRoiBasisPoints: 0,
    });
    expect(result.maxPurchasePriceCents).toBe(1_700_000);
    expect(result.expectedProfitCents).toBe(250_000); // profitable, so not a PASS
    expect(result.recommendation).toBe("WATCH");
    expect(result.overMaxByCents).toBe(50_000);
    const reasons = result.reasons.join(" ");
    expect(reasons).toMatch(/above your maximum purchase price/);
    expect(reasons).toMatch(/below your \$3,000 floor/);
  });

  it("watches a profitable unit that misses only the ROI floor", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: 1_900_000,
      estimatedRetailCents: 2_000_000,
      minGrossProfitCents: 0,
      minRoiBasisPoints: 1_000,
    });
    expect(result.expectedProfitCents).toBe(100_000);
    expect(result.expectedRoiBasisPoints).toBe(526);
    expect(result.recommendation).toBe("WATCH");
    expect(result.reasons.join(" ")).toMatch(/below your 10\.0% minimum/);
  });

  it("watches rather than guesses when no retail estimate exists", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: 500_000,
      estimatedRetailCents: 0,
      minGrossProfitCents: 150_000,
      minRoiBasisPoints: 1_000,
    });
    expect(result.recommendation).toBe("WATCH");
    expect(result.maxPurchasePriceCents).toBe(0);
    expect(result.bindingConstraint).toBe("none");
    expect(result.reasons.join(" ")).toMatch(/cannot be scored/);
  });
});

describe("sourcing — PASS", () => {
  it("passes on a unit that loses money at the asking price", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: 1_200_000,
      estimatedRetailCents: 1_000_000,
    });
    expect(result.expectedProfitCents).toBe(-200_000);
    expect(result.maxPurchasePriceCents).toBe(1_000_000);
    expect(result.recommendation).toBe("PASS");
    expect(result.reasons.join(" ")).toMatch(/loses money as priced/);
  });

  it("passes when profit is exactly zero", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: 2_000_000,
      estimatedRetailCents: 2_000_000,
      minGrossProfitCents: 150_000,
    });
    expect(result.expectedProfitCents).toBe(0);
    expect(result.recommendation).toBe("PASS");
  });

  it("passes on an impossible acquisition and offers no bid at all", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: 5_000_000,
      estimatedRetailCents: 100_000,
      estimatedReconCents: 500_000,
      minGrossProfitCents: 150_000,
      minRoiBasisPoints: 1_000,
    });
    expect(result.landedCostCents).toBe(5_500_000);
    expect(result.expectedProfitCents).toBe(-5_400_000);
    expect(result.maxPurchasePriceCents).toBe(0);
    expect(result.recommendation).toBe("PASS");
  });
});

describe("sourcing — individual cost components", () => {
  const BASE = { askingPriceCents: 1_000_000, estimatedRetailCents: 2_000_000 };

  it("raises landed cost and lowers the ceiling by the full amount of each added cost", () => {
    const base = evaluateSourcingCandidate(BASE);
    expect(base.addedCostsCents).toBe(0);
    expect(base.landedCostCents).toBe(1_000_000);
    expect(base.maxPurchasePriceCents).toBe(2_000_000);

    const components: Array<{ label: string; amount: number; input: SourcingEvaluationInput }> = [
      { label: "auction fees", amount: 50_000, input: { ...BASE, expectedAuctionFeesCents: 50_000 } },
      { label: "transport", amount: 40_000, input: { ...BASE, transportEstimateCents: 40_000 } },
      { label: "recon", amount: 60_000, input: { ...BASE, estimatedReconCents: 60_000 } },
      { label: "other", amount: 10_000, input: { ...BASE, otherCostsCents: 10_000 } },
    ];

    for (const { label, amount, input } of components) {
      const result = evaluateSourcingCandidate(input);
      expect(result.addedCostsCents, `${label} should add to added costs`).toBe(amount);
      expect(result.landedCostCents, `${label} should raise landed cost`).toBe(1_000_000 + amount);
      expect(result.maxPurchasePriceCents, `${label} should lower the ceiling`).toBe(2_000_000 - amount);
      // Asking did not change, so the profit absorbs the whole added cost.
      expect(result.expectedProfitCents, `${label} should reduce profit`).toBe(base.expectedProfitCents - amount);
    }
  });

  it("sums all four added costs together", () => {
    const result = evaluateSourcingCandidate({
      ...BASE,
      expectedAuctionFeesCents: 50_000,
      transportEstimateCents: 40_000,
      estimatedReconCents: 60_000,
      otherCostsCents: 10_000,
    });
    expect(result.addedCostsCents).toBe(160_000);
    expect(result.landedCostCents).toBe(1_160_000);
  });

  it("treats an inspection cost as part of the same added-cost pool", () => {
    // There is no separate inspection input; recon/other carry it. Documented
    // by asserting that 'other' behaves as a generic bucket.
    const withInspectionViaOther = evaluateSourcingCandidate({ ...BASE, otherCostsCents: 25_000 });
    expect(withInspectionViaOther.addedCostsCents).toBe(25_000);
    expect(withInspectionViaOther.maxPurchasePriceCents).toBe(1_975_000);
  });
});

describe("sourcing — zero-cost and invalid-input edges", () => {
  it("returns a null ROI when nothing at all is paid for the unit", () => {
    const result = evaluateSourcingCandidate({ askingPriceCents: 0, estimatedRetailCents: 2_000_000 });
    expect(result.landedCostCents).toBe(0);
    expect(result.expectedProfitCents).toBe(2_000_000);
    expect(result.expectedRoiBasisPoints).toBeNull();
    expect(result.recommendation).toBe("BUY");
  });

  // Documented behaviour: an undefined ROI is compared as 0, so a zero-cost unit
  // with an ROI floor is WATCH rather than BUY. Asserted so a future change to
  // that rule is a deliberate decision, not an accident.
  it("watches a zero-cost unit when an ROI floor is in force because ROI is undefined", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: 0,
      estimatedRetailCents: 2_000_000,
      minRoiBasisPoints: 1_000,
    });
    expect(result.expectedRoiBasisPoints).toBeNull();
    expect(result.recommendation).toBe("WATCH");
  });

  it("cannot score a candidate with neither a price nor a retail estimate", () => {
    const result = evaluateSourcingCandidate({ askingPriceCents: 0, estimatedRetailCents: 0 });
    expect(result.recommendation).toBe("WATCH");
    expect(result.expectedRoiBasisPoints).toBeNull();
    expect(result.maxPurchasePriceCents).toBe(0);
  });

  it("coerces negative and fractional inputs instead of producing nonsense", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: -5_000,
      estimatedRetailCents: 1_000_000.4,
      estimatedReconCents: -1,
    });
    expect(result.landedCostCents).toBe(0);
    expect(result.expectedProfitCents).toBe(1_000_000);
  });

  it("treats a negative ROI floor as no floor", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: 1_000_000,
      estimatedRetailCents: 2_000_000,
      minRoiBasisPoints: -500,
    });
    expect(result.maxPriceFromRoiFloorCents).toBeNull();
    expect(result.maxPurchasePriceCents).toBe(2_000_000);
  });
});

describe("sourcing — conservative rounding boundary", () => {
  // The ceiling is floored to whole dollars, so an asking price that
  // mathematically satisfies both floors can still land within the last dollar
  // below the true ceiling and be scored WATCH instead of BUY. The direction is
  // safe: the engine never reports BUY for a price above the recommended
  // ceiling. Asserted here so the behaviour is pinned and visible.
  it("scores WATCH, not BUY, for a price within one dollar above the floored ceiling", () => {
    const result = evaluateSourcingCandidate({
      askingPriceCents: 1_818_150,
      estimatedRetailCents: 2_000_000,
      minGrossProfitCents: 0,
      minRoiBasisPoints: 1_000,
    });
    // Both threshold checks independently pass...
    expect(result.expectedProfitCents).toBe(181_850);
    expect(result.expectedRoiBasisPoints).toBe(1_000);
    // ...but the price is above the floored recommended ceiling.
    expect(result.maxPurchasePriceCents).toBe(1_818_100);
    expect(result.overMaxByCents).toBe(50);
    expect(result.recommendation).toBe("WATCH");
  });

  it("never recommends BUY above the ceiling it publishes", () => {
    const added = 60_000;
    for (const asking of [1_818_100, 1_818_101, 1_818_500, 1_819_000, 1_900_000]) {
      const result = evaluateSourcingCandidate({
        askingPriceCents: asking,
        estimatedReconCents: added,
        estimatedRetailCents: 2_000_000,
        minGrossProfitCents: 0,
        minRoiBasisPoints: 1_000,
      });
      if (result.recommendation === "BUY") {
        expect(asking).toBeLessThanOrEqual(result.maxPurchasePriceCents);
      }
    }
  });
});

describe("sourcing — maxBidWithMargin", () => {
  it("withholds the default 5% safety margin", () => {
    expect(maxBidWithMargin(1_000_000)).toBe(950_000);
    expect(maxBidWithMargin(1_000_000, 500)).toBe(950_000);
  });

  it("withholds a caller-supplied margin", () => {
    expect(maxBidWithMargin(1_000_000, 1_000)).toBe(900_000);
    expect(maxBidWithMargin(1_000_000, 0)).toBe(1_000_000);
  });

  it("never returns a negative bid and rounds down to whole dollars", () => {
    expect(maxBidWithMargin(0, 500)).toBe(0);
    expect(maxBidWithMargin(100, 10_000)).toBe(0);
    expect(maxBidWithMargin(1_000, 0)).toBe(1_000);
    expect(maxBidWithMargin(1_000_050, 0)).toBe(1_000_000);
    expect(maxBidWithMargin(1_000, -5_000)).toBe(1_000); // negative margin clamped to 0
  });
});

describe("sourcing — decision labels", () => {
  it("has a label for every decision", () => {
    expect(SOURCING_DECISION_LABELS).toEqual({ BUY: "Buy", WATCH: "Watch", PASS: "Pass" });
    expect(SOURCING_DECISION_LABELS_UPPER).toEqual({ BUY: "BUY", WATCH: "WATCH", PASS: "PASS" });
  });
});
