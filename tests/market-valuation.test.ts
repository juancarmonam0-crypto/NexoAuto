import { describe, expect, it } from "vitest";
import {
  COMPARABLE_ASKING_HAIRCUT_BASIS_POINTS,
  CONSERVATIVE_RETAIL_POLICY_VERSION,
  MIN_COMPARABLES_FOR_DISTRIBUTION,
  MILEAGE_RELEVANCE_BAND_BASIS_POINTS,
  MILEAGE_RELEVANCE_MIN_BAND,
  PREDICTION_HAIRCUT_BASIS_POINTS,
  RETAIL_ROUNDING_CENTS,
  SOURCE_AGREEMENT_BAND_BASIS_POINTS,
  type ConservativeRetailInput,
  type ConservativeRetailResult,
  deriveConservativeRetail,
  mileageRelevanceBand,
  summarizeComparables,
} from "@/lib/market-valuation";
import type { MarketComparable, MarketValuationSnapshot } from "@/lib/providers/types";

/**
 * The market-intelligence POLICY layer.
 *
 * `deriveConservativeRetail` is the single place where market evidence becomes
 * the retail figure the economics engine uses, so this file pins the policy
 * itself rather than the implementation's internals:
 *
 *   - every source is DISCOUNTED, and the discount rounds against us;
 *   - the answer is rounded DOWN to a whole dollar;
 *   - when two sources disagree we take the LOWER one;
 *   - a number is only produced when the evidence is strong enough;
 *   - a manual override wins but never destroys the market number.
 *
 * Every money assertion is on INTEGER CENTS and is hand-computed in the comment
 * above it, so a change in the arithmetic fails here with the reason attached
 * instead of silently moving an acquisition price.
 *
 * Fixtures: a 2021 Toyota Corolla LE with 67,000 miles — a realistic used-car
 * subject whose relevance band (25% of 67,000 = 16,750 miles) admits comparables
 * between 50,250 and 83,750 miles.
 */

const COROLLA_MILEAGE = 67_000;
/** 25% of 67,000 miles = 16,750 — the relevance band for every fixture below. */
const COROLLA_BAND = 16_750;

function comparable(overrides: Partial<MarketComparable> = {}): MarketComparable {
  return {
    source: "marketcheck",
    year: 2020,
    make: "Toyota",
    model: "Corolla",
    trim: "LE",
    mileage: 66_000,
    // $18,500 advertised — a believable ask for a 2020/2021 Corolla LE.
    askingPriceCents: 1_850_000,
    distanceMiles: 42,
    dealerName: "Example Motors",
    dealerType: "independent",
    listingUrl: "https://example.test/listing/1",
    listedDaysAgo: 21,
    ...overrides,
  };
}

/**
 * Three relevant listings with a believable spread of asks: $18,990 / $18,500 /
 * $17,990. Median $18,500, low $17,990, high $18,990.
 */
function canonicalComparables(): MarketComparable[] {
  return [
    comparable({ mileage: 62_000, askingPriceCents: 1_899_000 }),
    comparable({ mileage: 67_500, askingPriceCents: 1_850_000 }),
    comparable({ mileage: 71_000, askingPriceCents: 1_799_000 }),
  ];
}

function snapshot(overrides: Partial<MarketValuationSnapshot> = {}): MarketValuationSnapshot {
  return {
    vin: "5YFEPMAE9MP123456",
    provider: "marketcheck",
    generatedAt: new Date("2025-01-15T12:00:00.000Z"),
    retrievedLive: true,
    // $19,000 predicted for the subject Corolla.
    predictedPriceCents: 1_900_000,
    predictedLowCents: 1_780_000,
    predictedHighCents: 2_040_000,
    comparableCountReported: 12,
    comparables: canonicalComparables(),
    notes: ["Advertised asking prices, not sold prices."],
    ...overrides,
  };
}

/**
 * Every money value the policy can return must be a whole number of cents: the
 * engine downstream does exact integer arithmetic and a float here would leak
 * into a contract. Asserted for every result in this file.
 */
function expectIntegerCents(result: ConservativeRetailResult): void {
  const values: Array<[string, number | null]> = [
    ["retailCents", result.retailCents],
    ["marketEstimateCents", result.marketEstimateCents],
    ["evidence.predictedPriceCents", result.evidence.predictedPriceCents],
    ["evidence.predictionCandidateCents", result.evidence.predictionCandidateCents],
    ["evidence.comparableCandidateCents", result.evidence.comparableCandidateCents],
    ["comparableSummary.medianAskingCents", result.evidence.comparableSummary?.medianAskingCents ?? null],
    ["comparableSummary.lowAskingCents", result.evidence.comparableSummary?.lowAskingCents ?? null],
    ["comparableSummary.highAskingCents", result.evidence.comparableSummary?.highAskingCents ?? null],
  ];
  for (const [label, value] of values) {
    if (value !== null) {
      expect(Number.isInteger(value), `${label} must be whole cents, received ${String(value)}`).toBe(true);
    }
  }
}

/** Shape invariants that hold in EVERY branch, including the "no number" ones. */
function expectPolicyShape(result: ConservativeRetailResult): void {
  expect(result.policyVersion.length, "policyVersion is reported").toBeGreaterThan(0);
  expect(result.policyVersion, "policyVersion identifies a policy revision").toMatch(/^v\d+$/);

  expect(Array.isArray(result.reasons), "reasons is an array").toBe(true);
  expect(result.reasons.length, "every branch explains itself").toBeGreaterThan(0);
  for (const reason of result.reasons) {
    expect(typeof reason, `reason is a string: ${String(reason)}`).toBe("string");
    expect(reason.length, "no empty reason sentences").toBeGreaterThan(0);
  }

  expect(Array.isArray(result.warnings), "warnings is an array").toBe(true);
  for (const warning of result.warnings) {
    expect(typeof warning, `warning is a string: ${String(warning)}`).toBe("string");
    expect(warning.length, "no empty warnings").toBeGreaterThan(0);
  }
}

/** Runs the policy and applies the money/shape invariants every result must hold. */
function evaluate(input: ConservativeRetailInput): ConservativeRetailResult {
  const result = deriveConservativeRetail(input);
  expectIntegerCents(result);
  expectPolicyShape(result);
  return result;
}

describe("market-valuation — policy constants", () => {
  it("pins the published conservatism constants", () => {
    // These numbers ARE the policy. Pinning them means a silent relaxation of
    // the haircuts (e.g. charging less discount) fails a test rather than
    // quietly paying more for inventory.
    expect(PREDICTION_HAIRCUT_BASIS_POINTS).toBe(200); // 2.00% off a prediction
    expect(COMPARABLE_ASKING_HAIRCUT_BASIS_POINTS).toBe(300); // 3.00% off asking prices
    expect(MIN_COMPARABLES_FOR_DISTRIBUTION).toBe(3);
    expect(MILEAGE_RELEVANCE_BAND_BASIS_POINTS).toBe(2_500); // 25% of the odometer
    expect(MILEAGE_RELEVANCE_MIN_BAND).toBe(10_000);
    expect(SOURCE_AGREEMENT_BAND_BASIS_POINTS).toBe(1_000); // 10%
    expect(RETAIL_ROUNDING_CENTS).toBe(100); // whole dollars
    expect(CONSERVATIVE_RETAIL_POLICY_VERSION).toBe("v1");
  });
});

describe("market-valuation — A. discount arithmetic (the conservatism itself)", () => {
  it("rounds the prediction haircut UP, so the discounted price is never optimistic", () => {
    // Synthetic prediction chosen so the 2% haircut is fractional: the exact
    // haircut is 1,849,963 x 200 / 10,000 = 36,999.26 cents. Rounding the
    // DISCOUNT up (36,999.26 -> 37,000) leaves 1,849,963 - 37,000 = 1,812,963.
    // Rounding half-to-even/nearest would have left 1,812,964 — one cent richer
    // and therefore one cent optimistic, which is exactly what the policy bans.
    const predictedPriceCents = 1_849_963;
    const exactHaircutCents = (predictedPriceCents * PREDICTION_HAIRCUT_BASIS_POINTS) / 10_000;

    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents, comparables: [] }),
      mileage: COROLLA_MILEAGE,
    });

    expect(Number.isInteger(exactHaircutCents), "the fixture's haircut really is fractional").toBe(false);
    expect(result.evidence.predictedPriceCents).toBe(1_849_963);
    expect(result.evidence.predictionCandidateCents, "the haircut is rounded UP").toBe(
      predictedPriceCents - Math.ceil(exactHaircutCents),
    );
    expect(result.evidence.predictionCandidateCents).toBe(1_812_963);
    expect(result.evidence.predictionCandidateCents!).toBeLessThan(
      predictedPriceCents - Math.round(exactHaircutCents),
    );
    expect(result.source).toBe("market-prediction");
    // Whole-dollar rounding then takes 1,812,963 down to 1,812,900.
    expect(result.retailCents).toBe(1_812_900);
    expect(result.marketEstimateCents).toBe(1_812_900);
    expect(result.confidence).toBe("medium");
    expect(result.overridden).toBe(false);
  });

  it("rounds the final retail DOWN to a whole dollar", () => {
    // 1,925,050 - 2% (38,501, exact) = 1,886,549. The policy never rounds a
    // retail assumption UP, so floor(1,886,549 / 100) x 100 = 1,886,500: the 49
    // cents of optimism are discarded, not rounded to 1,886,600.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: 1_925_050, comparables: [] }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.predictionCandidateCents).toBe(1_886_549);
    expect(result.retailCents).toBe(1_886_500);
    expect(result.retailCents! % RETAIL_ROUNDING_CENTS).toBe(0);
    expect(result.retailCents! % 100).toBe(0);
  });

  it("keeps every returned money value an integer number of cents", () => {
    // A spread of shapes that all reach the arithmetic: fractional prediction,
    // odd-cent comparable median, a manual override and the no-evidence branch.
    const inputs: ConservativeRetailInput[] = [
      { snapshot: snapshot({ predictedPriceCents: 1_849_963 }), mileage: COROLLA_MILEAGE },
      { snapshot: snapshot({ predictedPriceCents: null }), mileage: COROLLA_MILEAGE },
      {
        snapshot: snapshot({
          predictedPriceCents: null,
          comparables: [
            comparable({ mileage: 62_000, askingPriceCents: 1_780_000 }),
            comparable({ mileage: 63_000, askingPriceCents: 1_824_999 }),
            comparable({ mileage: 67_500, askingPriceCents: 1_850_000 }),
            comparable({ mileage: 71_000, askingPriceCents: 1_899_000 }),
          ],
        }),
        mileage: COROLLA_MILEAGE,
      },
      { snapshot: snapshot(), mileage: COROLLA_MILEAGE, manualRetailCents: 1_755_555 },
      { snapshot: null, mileage: COROLLA_MILEAGE },
    ];

    for (const input of inputs) {
      const result = evaluate(input);
      if (result.retailCents !== null) {
        expect(Number.isInteger(result.retailCents), "retailCents is whole cents").toBe(true);
      }
    }
  });
});

describe("market-valuation — B. comparable distribution", () => {
  it("uses the comparable MEDIAN less the asking-price haircut when only comparables exist (odd count)", () => {
    // Three relevant listings: 1,899,000 / 1,850,000 / 1,799,000 cents.
    // Odd count -> the median is the middle value, $18,500 = 1,850,000 cents.
    // 3% of 1,850,000 is exactly 55,500, so the discounted candidate is
    // 1,850,000 - 55,500 = 1,794,500, already a whole dollar.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: null }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.comparableSummary?.used).toBe(MIN_COMPARABLES_FOR_DISTRIBUTION);
    expect(result.evidence.comparableSummary?.medianAskingCents).toBe(1_850_000);
    expect(result.evidence.comparableCandidateCents).toBe(1_794_500);
    expect(result.evidence.predictionCandidateCents).toBeNull();
    expect(result.source).toBe("market-comparables");
    expect(result.retailCents).toBe(1_794_500);
    expect(result.marketEstimateCents).toBe(1_794_500);
  });

  it("uses the ROUNDED MEAN of the middle two asks as the median for an even count", () => {
    // Four relevant listings sorted: 1,780,000 / 1,824,999 / 1,850,000 / 1,899,000.
    // Even count -> median = round((1,824,999 + 1,850,000) / 2)
    //                          = round(1,837,499.5) = 1,837,500 cents.
    // 3% of 1,837,500 is exactly 55,125, so the candidate is
    // 1,837,500 - 55,125 = 1,782,375, and the whole-dollar floor takes it to
    // 1,782,300 (75 cents dropped, never added).
    const result = evaluate({
      snapshot: snapshot({
        predictedPriceCents: null,
        comparables: [
          comparable({ mileage: 58_000, askingPriceCents: 1_780_000 }),
          comparable({ mileage: 63_000, askingPriceCents: 1_824_999 }),
          comparable({ mileage: 67_500, askingPriceCents: 1_850_000 }),
          comparable({ mileage: 71_000, askingPriceCents: 1_899_000 }),
        ],
      }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.comparableSummary?.used).toBe(4);
    expect(result.evidence.comparableSummary?.medianAskingCents).toBe(1_837_500);
    expect(result.evidence.comparableCandidateCents).toBe(1_782_375);
    expect(result.source).toBe("market-comparables");
    expect(result.retailCents).toBe(1_782_300);
  });

  it("ignores the distribution when fewer than the minimum relevant comparables survive, and returns no number", () => {
    // Two relevant listings are not a market: a couple of hopeful ads must never
    // move an acquisition price. The distribution is still REPORTED (median
    // 1,850,000) but it is not used, and with no prediction there is no number.
    const result = evaluate({
      snapshot: snapshot({
        predictedPriceCents: null,
        comparables: [
          comparable({ mileage: 65_000, askingPriceCents: 1_880_000 }),
          comparable({ mileage: 69_000, askingPriceCents: 1_820_000 }),
        ],
      }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.comparableSummary?.used).toBe(2);
    expect(result.evidence.comparableSummary?.medianAskingCents).toBe(1_850_000);
    expect(result.evidence.comparableCandidateCents).toBeNull();
    expect(result.retailCents).toBeNull();
    expect(result.marketEstimateCents).toBeNull();
    expect(result.source).toBe("none");
    expect(result.confidence).toBeNull();
    expect(result.overridden).toBe(false);
    expect(result.warnings.some((warning) => /Only 2 comparables survived the mileage filter/.test(warning))).toBe(
      true,
    );
  });

  it("warns with the surviving, filtered and price-carrying counts, and never derives a number from one listing", () => {
    // One relevant listing: the warning is the operator's only explanation of
    // why a plausible-looking comparable produced nothing. Note the module's
    // own wording: `${priced}` is the count that CARRIED a price.
    const result = evaluate({
      snapshot: snapshot({
        predictedPriceCents: null,
        comparables: [
          comparable({ mileage: 66_000, askingPriceCents: 1_850_000 }),
          comparable({ mileage: 99_000, askingPriceCents: 1_600_000 }),
        ],
      }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.comparableSummary).toEqual({
      total: 2,
      priced: 2,
      used: 1,
      filteredByMileage: 1,
      medianAskingCents: 1_850_000,
      lowAskingCents: 1_850_000,
      highAskingCents: 1_850_000,
      mileageBand: COROLLA_BAND,
    });
    expect(result.source).toBe("none");
    expect(result.retailCents).toBeNull();
    // Singular wording: "1 comparable", and the counts are spelled out.
    expect(
      result.warnings.some((warning) =>
        /Only 1 comparable survived the mileage filter \(1 were filtered out and 2 carried a price\)/.test(warning),
      ),
    ).toBe(true);
    expect(
      result.warnings.some((warning) => /3 are required before the distribution is used/.test(warning)),
    ).toBe(true);
  });

  it("ignores comparables whose asking price is missing, zero or negative", () => {
    // Only two of the five rows carry a usable price, so `used` is 2 and the
    // distribution (median 1,875,000) exists... as long as the unpriced rows did
    // not sneak in: a zero or a negative asking price is not evidence.
    const rows: MarketComparable[] = [
      comparable({ mileage: 66_000, askingPriceCents: 1_850_000 }),
      comparable({ mileage: 66_500, askingPriceCents: undefined }),
      comparable({ mileage: 67_000, askingPriceCents: 0 }),
      comparable({ mileage: 67_200, askingPriceCents: -250_000 }),
      comparable({ mileage: undefined, askingPriceCents: 1_900_000 }),
    ];
    const summary = summarizeComparables(rows, COROLLA_MILEAGE);

    expect(summary.total).toBe(5);
    expect(summary.priced, "only rows that carried a usable price").toBe(2);
    expect(summary.used).toBe(2);
    expect(summary.medianAskingCents).toBe(1_875_000); // round((1,850,000 + 1,900,000) / 2)
    expect(summary.lowAskingCents).toBe(1_850_000);
    expect(summary.highAskingCents).toBe(1_900_000);

    // Through the policy: two usable comparables, no prediction -> no number.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: null, comparables: rows }),
      mileage: COROLLA_MILEAGE,
    });
    expect(result.source).toBe("none");
    expect(result.retailCents).toBeNull();
  });

  // SEMANTICS (resolved during the market-intelligence phase): `priced` counts the
  // comparables that CARRIED a usable asking price. A row with no price, a zero
  // price or a negative price is counted in NEITHER `priced` nor `used` — it is
  // evidence that exists but cannot move a valuation. `summarizeComparables`
  // increments `priced` only after the price guard, and its warning text
  // ("${priced} carried a price") states the same meaning. The field's doc comment
  // in src/lib/market-valuation.ts now says so explicitly, so this is the settled
  // contract rather than an ambiguity.
  it("counts in `priced` only the comparables that actually carried a usable price", () => {
    const rows: MarketComparable[] = [
      comparable({ mileage: 66_000, askingPriceCents: 1_850_000 }),
      comparable({ mileage: 66_500, askingPriceCents: undefined }),
      comparable({ mileage: 67_000, askingPriceCents: 0 }),
      comparable({ mileage: 67_200, askingPriceCents: -250_000 }),
      comparable({ mileage: undefined, askingPriceCents: 1_900_000 }),
    ];

    const summary = summarizeComparables(rows, COROLLA_MILEAGE);
    // Two rows carry a usable price (1,850,000 and 1,900,000); the other three
    // cannot be evidence of anything and are counted nowhere.
    expect(summary.priced).toBe(2);
    expect(summary.used).toBe(2);
    expect(summary.total).toBe(5);
    expect(summary.medianAskingCents).toBe(1_875_000);
  });

  it("uses comparables with no mileage and filters the ones outside the band", () => {
    // Subject 67,000 miles -> band 16,750, so kept mileage is 50,250..83,750.
    //   60,000  (-7,000)          -> used
    //   undefined (no odometer)   -> used: a missing odometer is not a reason to
    //                                discard a priced listing
    //   95,000  (+28,000)         -> filtered
    //   67,000  (0)               -> used
    //   83,750  (+16,750, ON edge)-> used
    //   83,751  (+16,751, 1 over) -> filtered
    // used = 4 >= 3, so the distribution is trusted: sorted used asks are
    // 1,820,000 / 1,850,000 / 1,880,000 / 1,900,000 -> median
    // round((1,850,000 + 1,880,000) / 2) = 1,865,000; 3% = 55,950, so the
    // candidate is 1,865,000 - 55,950 = 1,809,050 -> floor -> 1,809,000.
    const result = evaluate({
      snapshot: snapshot({
        predictedPriceCents: null,
        comparables: [
          comparable({ mileage: 60_000, askingPriceCents: 1_880_000 }),
          comparable({ mileage: undefined, askingPriceCents: 1_820_000 }),
          comparable({ mileage: 95_000, askingPriceCents: 1_600_000 }),
          comparable({ mileage: 67_000, askingPriceCents: 1_900_000 }),
          comparable({ mileage: 83_750, askingPriceCents: 1_850_000 }),
          comparable({ mileage: 83_751, askingPriceCents: 1_700_000 }),
        ],
      }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.comparableSummary).toEqual({
      total: 6,
      priced: 6,
      used: 4,
      filteredByMileage: 2,
      medianAskingCents: 1_865_000,
      lowAskingCents: 1_820_000,
      highAskingCents: 1_900_000,
      mileageBand: COROLLA_BAND,
    });
    expect(result.evidence.comparableCandidateCents).toBe(1_809_050);
    expect(result.source).toBe("market-comparables");
    expect(result.retailCents).toBe(1_809_000);
  });
});

describe("market-valuation — C. the mileage relevance band", () => {
  it("floors the band at 10,000 miles for a low-mileage subject and scales it for a high-mileage one", () => {
    // 25% of 12,000 is 3,000, but a 12,000-mile car must still have a market to
    // compare against, so the band floors at MILEAGE_RELEVANCE_MIN_BAND.
    expect(mileageRelevanceBand(12_000)).toBe(MILEAGE_RELEVANCE_MIN_BAND);
    expect(mileageRelevanceBand(12_000)).toBe(10_000);
    expect(mileageRelevanceBand(40_000)).toBe(10_000); // exactly at the floor
    // Above the floor the band is exactly a quarter of the odometer.
    expect(mileageRelevanceBand(COROLLA_MILEAGE)).toBe(COROLLA_BAND);
    expect(mileageRelevanceBand(200_000)).toBe(50_000);
    expect(mileageRelevanceBand(0)).toBe(10_000);
  });

  it("rounds the proportional band and clamps a nonsensical odometer", () => {
    // 44,446 / 4 = 11,111.5 -> Math.round -> 11,112 miles of tolerance.
    expect(mileageRelevanceBand(44_446)).toBe(11_112);
    // A fractional odometer is rounded before the band is taken.
    expect(mileageRelevanceBand(66_999.6)).toBe(COROLLA_BAND);
    // A negative odometer cannot produce a negative band.
    expect(mileageRelevanceBand(-5_000)).toBe(10_000);
  });

  it("keeps a comparable exactly ON the band edge and filters one mile beyond it", () => {
    // Subject 60,000 miles -> band 15,000, so the admissible window is
    // 45,000..75,000 INCLUSIVE. The comparison is `> band`, so the edge is kept
    // and a single mile further is filtered — on both sides of the subject.
    const rows: MarketComparable[] = [
      comparable({ mileage: 75_000, askingPriceCents: 1_800_000 }), // edge above -> kept
      comparable({ mileage: 75_001, askingPriceCents: 1_500_000 }), // 1 over -> filtered
      comparable({ mileage: 45_000, askingPriceCents: 1_700_000 }), // edge below -> kept
      comparable({ mileage: 44_999, askingPriceCents: 1_400_000 }), // 1 under -> filtered
    ];
    const summary = summarizeComparables(rows, 60_000);

    expect(summary.mileageBand).toBe(15_000);
    expect(summary.filteredByMileage).toBe(2);
    expect(summary.used).toBe(2);
    // low/high come from the USED set only: 1,500,000 and 1,400,000 are gone.
    expect(summary.lowAskingCents).toBe(1_700_000);
    expect(summary.highAskingCents).toBe(1_800_000);
    expect(summary.medianAskingCents).toBe(1_750_000); // round((1,700,000 + 1,800,000) / 2)

    // Exactly on the edge keeps a listing; one mile past does not.
    expect(summarizeComparables([comparable({ mileage: 75_000, askingPriceCents: 1_800_000 })], 60_000).used).toBe(1);
    expect(summarizeComparables([comparable({ mileage: 75_001, askingPriceCents: 1_800_000 })], 60_000).used).toBe(0);
  });
});

describe("market-valuation — D. conservative choice between two sources", () => {
  it("takes the LOWER of two disagreeing sources, never the average and never the higher", () => {
    // Prediction $21,000 - 2% (42,000) = 2,058,000.
    // Comparables median $18,500 - 3% (55,500) = 1,794,500.
    // The policy resolves disagreement against us: 1,794,500 wins, which is
    // neither the average (1,926,250) nor the higher candidate (2,058,000).
    // Gap = (2,058,000 - 1,794,500) x 10,000 / 2,058,000 = 1,280 bps (12.8%),
    // above the 1,000-bps agreement band but inside twice it -> medium.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: 2_100_000 }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.predictionCandidateCents).toBe(2_058_000);
    expect(result.evidence.comparableCandidateCents).toBe(1_794_500);
    expect(result.retailCents).toBe(1_794_500);
    expect(result.marketEstimateCents).toBe(1_794_500);
    expect(result.retailCents).not.toBe(1_926_250); // not the average
    expect(result.retailCents).not.toBe(2_058_000); // not the higher
    expect(result.source).toBe("market-comparables");
    expect(result.confidence).toBe("medium");
    expect(result.reasons.some((reason) => /takes the LOWER usable source/.test(reason))).toBe(true);
    expect(result.reasons.some((reason) => /comparable distribution\)/.test(reason))).toBe(true);
  });

  it("calls two sources close together high confidence", () => {
    // Prediction $18,300 - 2% (36,600) = 1,793,400.
    // Comparables median $18,500 - 3% (55,500) = 1,794,500.
    // Gap = 1,100 x 10,000 / 1,794,500 = 6 bps (0.1%), inside the 1,000-bps
    // agreement band -> high. The retail is the lower of the two, 1,793,400.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: 1_830_000 }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.predictionCandidateCents).toBe(1_793_400);
    expect(result.evidence.comparableCandidateCents).toBe(1_794_500);
    expect(result.retailCents).toBe(1_793_400);
    expect(result.source).toBe("market-prediction");
    expect(result.confidence).toBe("high");
    expect(result.reasons.some((reason) => /confidence is high/.test(reason))).toBe(true);
  });

  it("calls two sources far apart low confidence", () => {
    // A provider whose prediction ($27,000 -> 2,646,000 after the 2% haircut)
    // runs far above the comparable distribution (1,794,500). Gap =
    // 851,500 x 10,000 / 2,646,000 = 3,218 bps (32.2%), well beyond twice the
    // 1,000-bps band -> low. Optimism in one source must not move the number:
    // the lower source still decides it.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: 2_700_000 }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.predictionCandidateCents).toBe(2_646_000);
    expect(result.retailCents).toBe(1_794_500);
    expect(result.source).toBe("market-comparables");
    expect(result.confidence).toBe("low");
    expect(result.reasons.some((reason) => /confidence is low/.test(reason))).toBe(true);
  });

  it("calls a lone prediction medium confidence", () => {
    // No comparables at all: $19,000 - 2% (38,000) = 1,862,000, a whole dollar
    // already. A model output with nothing to corroborate it is medium, not high.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: 1_900_000, comparables: [] }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.predictionCandidateCents).toBe(1_862_000);
    expect(result.evidence.comparableCandidateCents).toBeNull();
    expect(result.retailCents).toBe(1_862_000);
    expect(result.source).toBe("market-prediction");
    expect(result.confidence).toBe("medium");
    expect(result.reasons.some((reason) => /Only the provider's price prediction was usable/.test(reason))).toBe(true);
  });

  it("calls a lone comparable distribution low confidence", () => {
    // Advertised asks without any prediction: 1,850,000 - 3% (55,500) =
    // 1,794,500. Asking prices are the weakest evidence we accept, so low.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: null }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.retailCents).toBe(1_794_500);
    expect(result.evidence.predictionCandidateCents).toBeNull();
    expect(result.source).toBe("market-comparables");
    expect(result.confidence).toBe("low");
    expect(result.reasons.some((reason) => /Only comparables were usable/.test(reason))).toBe(true);
    expect(result.warnings.some((warning) => /returned no price prediction/i.test(warning))).toBe(true);
  });

  it("never lets confidence change the number", () => {
    // Same prediction in both snapshots (candidate 1,793,400), so the LOWER
    // source is the prediction either way. Only the comparables move: a market
    // that agrees closely (x) versus one 2,296 bps away (y). Confidence goes
    // from high to low and the retail does not move by a single cent.
    const agrees = evaluate({
      snapshot: snapshot({ predictedPriceCents: 1_830_000 }),
      mileage: COROLLA_MILEAGE,
    });
    const disagrees = evaluate({
      snapshot: snapshot({
        predictedPriceCents: 1_830_000,
        comparables: [
          comparable({ mileage: 62_000, askingPriceCents: 2_350_000 }),
          comparable({ mileage: 67_500, askingPriceCents: 2_400_000 }),
          comparable({ mileage: 71_000, askingPriceCents: 2_450_000 }),
        ],
      }),
      mileage: COROLLA_MILEAGE,
    });

    expect(disagrees.evidence.comparableCandidateCents).toBe(2_328_000); // 2,400,000 - 3% (72,000)
    expect(agrees.confidence).toBe("high");
    expect(disagrees.confidence).toBe("low");
    expect(disagrees.retailCents).toBe(agrees.retailCents);
    expect(agrees.retailCents).toBe(1_793_400);
    expect(disagrees.source).toBe("market-prediction");
  });
});

describe("market-valuation — E. no evidence at all", () => {
  it("returns none and no number when the snapshot is null", () => {
    // The provider could not be reached. Nothing is known, so nothing is
    // fabricated: no prediction, no summary, no number, and Analyze falls back
    // to the operator's manual expected retail.
    const result = evaluate({ snapshot: null, mileage: COROLLA_MILEAGE });

    expect(result.retailCents).toBeNull();
    expect(result.source).toBe("none");
    expect(result.confidence).toBeNull();
    expect(result.marketEstimateCents).toBeNull();
    expect(result.overridden).toBe(false);
    expect(result.evidence.predictedPriceCents).toBeNull();
    expect(result.evidence.predictionCandidateCents).toBeNull();
    expect(result.evidence.comparableCandidateCents).toBeNull();
    expect(result.evidence.comparableSummary).toBeNull();
    expect(result.reasons.some((reason) => /will not guess a retail value/.test(reason))).toBe(true);
    expect(result.warnings.some((warning) => /returned no price prediction/i.test(warning))).toBe(true);
  });

  it("returns none when the comparables array is empty and there is no prediction", () => {
    // A provider that answered but had nothing to say is still no evidence.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: null, comparables: [] }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.comparableSummary).toEqual({
      total: 0,
      priced: 0,
      used: 0,
      filteredByMileage: 0,
      medianAskingCents: null,
      lowAskingCents: null,
      highAskingCents: null,
      mileageBand: COROLLA_BAND,
    });
    expect(result.source).toBe("none");
    expect(result.retailCents).toBeNull();
    expect(result.marketEstimateCents).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.warnings.some((warning) => /Only 0 comparables survived/.test(warning))).toBe(true);
  });

  it("returns none when no comparable carries a price and there is no prediction", () => {
    // Two listings, no prices, no prediction: the rows exist but carry no
    // evidence, so the result is the same as an empty market.
    const result = evaluate({
      snapshot: snapshot({
        predictedPriceCents: null,
        comparables: [
          comparable({ mileage: 64_000, askingPriceCents: undefined }),
          comparable({ mileage: 68_000, askingPriceCents: undefined }),
        ],
      }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence.comparableSummary?.total).toBe(2);
    expect(result.evidence.comparableSummary?.priced).toBe(0);
    expect(result.evidence.comparableSummary?.used).toBe(0);
    expect(result.evidence.comparableSummary?.medianAskingCents).toBeNull();
    expect(result.evidence.comparableCandidateCents).toBeNull();
    expect(result.source).toBe("none");
    expect(result.retailCents).toBeNull();
    expect(result.marketEstimateCents).toBeNull();
    expect(result.warnings.some((warning) => /0 carried a price/.test(warning))).toBe(true);
  });
});

describe("market-valuation — F. manual override", () => {
  it("uses the operator's number, preserves the market estimate and reports the override", () => {
    // Market: prediction 1,900,000 - 2% = 1,862,000; comparables median
    // 1,850,000 - 3% = 1,794,500; the lower source gives marketEstimateCents =
    // 1,794,500 ($17,945). The operator sets $17,500, which is what the
    // economics must use — and the market number must SURVIVE the override so
    // somebody can later see what the market thought.
    const manualRetailCents = 1_750_000;
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: 1_900_000 }),
      mileage: COROLLA_MILEAGE,
      manualRetailCents,
    });

    expect(result.source).toBe("manual");
    expect(result.retailCents).toBe(manualRetailCents); // used verbatim, not rounded
    expect(result.overridden).toBe(true);
    expect(result.confidence).toBeNull();
    expect(result.marketEstimateCents).toBe(1_794_500);
    expect(result.evidence.predictedPriceCents).toBe(1_900_000);
    expect(result.evidence.comparableSummary).toEqual({
      total: 3,
      priced: 3,
      used: 3,
      filteredByMileage: 0,
      medianAskingCents: 1_850_000,
      lowAskingCents: 1_799_000,
      highAskingCents: 1_899_000,
      mileageBand: COROLLA_BAND,
    });
    expect(result.reasons.some((reason) => /overrode the market estimate/.test(reason))).toBe(true);
    expect(result.reasons.some((reason) => /is preserved for comparison/.test(reason))).toBe(true);
    // 1,794,500 - 1,750,000 = 44,500 cents = $445 below the market estimate.
    expect(result.reasons.some((reason) => /below it by \$445/.test(reason))).toBe(true);
  });

  it("reports an override ABOVE the market estimate with the correct sign", () => {
    // Same market estimate (1,794,500). $19,500 is 155,500 cents above it, so
    // the preserved-comparison sentence must say "above", not "below".
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: 1_900_000 }),
      mileage: COROLLA_MILEAGE,
      manualRetailCents: 1_950_000,
    });

    expect(result.retailCents).toBe(1_950_000);
    expect(result.marketEstimateCents).toBe(1_794_500);
    expect(result.reasons.some((reason) => /above it by \$1,555/.test(reason))).toBe(true);
  });

  it("still overrides when there is no usable market evidence, and says nothing was overridden", () => {
    // No snapshot at all, but the operator knows their market: their number is
    // used, there is no market estimate to preserve, and the reason says so.
    const result = evaluate({ snapshot: null, mileage: COROLLA_MILEAGE, manualRetailCents: 1_800_000 });

    expect(result.source).toBe("manual");
    expect(result.retailCents).toBe(1_800_000);
    expect(result.marketEstimateCents).toBeNull();
    expect(result.overridden).toBe(true);
    expect(result.confidence).toBeNull();
    expect(result.evidence.predictedPriceCents).toBeNull();
    expect(result.evidence.comparableSummary).toBeNull();
    expect(result.reasons.some((reason) => /nothing was overridden/.test(reason))).toBe(true);
    // The missing prediction is still reported as a warning.
    expect(result.warnings.some((warning) => /returned no price prediction/i.test(warning))).toBe(true);
  });

  it("does not treat a ZERO override as an override", () => {
    // Zero is not a deliberate price, it is an empty form field. The market
    // number must be used and the result must not be labelled overridden.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: 1_900_000 }),
      mileage: COROLLA_MILEAGE,
      manualRetailCents: 0,
    });

    expect(result.source).toBe("market-comparables");
    expect(result.retailCents).toBe(1_794_500);
    expect(result.overridden).toBe(false);
    expect(result.marketEstimateCents).toBe(1_794_500);
  });

  it("does not treat a NEGATIVE override as an override", () => {
    // toCents clamps a negative to 0, so it fails the `> 0` guard exactly like
    // zero does: with market evidence the market wins, without it there is none.
    const withMarket = evaluate({
      snapshot: snapshot({ predictedPriceCents: 1_900_000 }),
      mileage: COROLLA_MILEAGE,
      manualRetailCents: -500,
    });
    expect(withMarket.source).toBe("market-comparables");
    expect(withMarket.retailCents).toBe(1_794_500);
    expect(withMarket.overridden).toBe(false);

    const withoutMarket = evaluate({ snapshot: null, mileage: COROLLA_MILEAGE, manualRetailCents: -500 });
    expect(withoutMarket.source).toBe("none");
    expect(withoutMarket.retailCents).toBeNull();
    expect(withoutMarket.marketEstimateCents).toBeNull();
    expect(withoutMarket.overridden).toBe(false);
  });

  it("reports exactly what the provider gave in evidence, alongside the discounted candidates", () => {
    // Evidence is the AUDIT TRAIL: the raw provider number (2,100,000), not the
    // discounted one, plus the candidate each source produced and the summary
    // counts behind the distribution.
    const result = evaluate({
      snapshot: snapshot({ predictedPriceCents: 2_100_000 }),
      mileage: COROLLA_MILEAGE,
    });

    expect(result.evidence).toEqual({
      predictedPriceCents: 2_100_000,
      comparableSummary: {
        total: 3,
        priced: 3,
        used: 3,
        filteredByMileage: 0,
        medianAskingCents: 1_850_000,
        lowAskingCents: 1_799_000,
        highAskingCents: 1_899_000,
        mileageBand: COROLLA_BAND,
      },
      predictionCandidateCents: 2_058_000,
      comparableCandidateCents: 1_794_500,
    });
  });
});

describe("market-valuation — G. determinism and shape", () => {
  it("returns deeply equal results for an identical input", () => {
    // Same snapshot + same mileage = same number, always. The arrays are copied
    // so the two calls cannot share mutable state.
    const base = snapshot({ predictedPriceCents: 1_900_000 });
    const first = evaluate({ snapshot: base, mileage: COROLLA_MILEAGE });
    const second = evaluate({
      snapshot: { ...base, comparables: [...base.comparables] },
      mileage: COROLLA_MILEAGE,
    });

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.retailCents).toBe(1_794_500);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("reports a non-empty policy version, reasons and warnings in every branch", () => {
    // Four branches: prediction only, comparables only, manual override and no
    // evidence at all. `evaluate` applies the money/shape invariants to each.
    const branches: Array<[string, ConservativeRetailResult]> = [
      ["market-prediction", evaluate({ snapshot: snapshot({ predictedPriceCents: 1_900_000, comparables: [] }), mileage: COROLLA_MILEAGE })],
      ["market-comparables", evaluate({ snapshot: snapshot({ predictedPriceCents: null }), mileage: COROLLA_MILEAGE })],
      ["manual", evaluate({ snapshot: snapshot(), mileage: COROLLA_MILEAGE, manualRetailCents: 1_700_000 })],
      ["none", evaluate({ snapshot: null, mileage: COROLLA_MILEAGE })],
    ];

    for (const [label, result] of branches) {
      expect(result.source, `${label}: source`).toBe(label);
      expect(result.policyVersion, `${label}: policy version`).toBe(CONSERVATIVE_RETAIL_POLICY_VERSION);
      expect(result.policyVersion.length, `${label}: policy version is non-empty`).toBeGreaterThan(0);
      expect(result.reasons.length, `${label}: reasons are non-empty`).toBeGreaterThan(0);
      expect(
        result.reasons.every((reason) => typeof reason === "string" && reason.length > 0),
        `${label}: every reason is a non-empty string`,
      ).toBe(true);
    }
    // Only the branches that produced a number carry a number.
    expect(branches[0]![1].retailCents).toBe(1_862_000);
    expect(branches[1]![1].retailCents).toBe(1_794_500);
    expect(branches[2]![1].retailCents).toBe(1_700_000);
    expect(branches[3]![1].retailCents).toBeNull();
  });

  it("warns that no price prediction was returned whenever there is none", () => {
    // A missing prediction is a warning, never a silent zero and never a number
    // invented from the comparable asks.
    const withoutPrediction = evaluate({
      snapshot: snapshot({ predictedPriceCents: null }),
      mileage: COROLLA_MILEAGE,
    });
    expect(withoutPrediction.warnings.some((warning) => /returned no price prediction/i.test(warning))).toBe(true);

    const noSnapshot = evaluate({ snapshot: null, mileage: COROLLA_MILEAGE });
    expect(noSnapshot.warnings.some((warning) => /returned no price prediction/i.test(warning))).toBe(true);

    // When a prediction IS present there is nothing to warn about.
    const withPrediction = evaluate({
      snapshot: snapshot({ predictedPriceCents: 1_900_000 }),
      mileage: COROLLA_MILEAGE,
    });
    expect(withPrediction.warnings.some((warning) => /no price prediction/i.test(warning))).toBe(false);
    expect(withPrediction.warnings).toEqual([]);
  });
});

describe("market-valuation — H. summarizeComparables directly", () => {
  it("reports the counts and the distribution of the USED set only", () => {
    // Subject 67,000 miles -> band 16,750, admissible window 50,250..83,750.
    //   62,400  1,899,500  -> used
    //   66,000  1,850,000  -> used
    //   71,200  1,799,900  -> used
    //   96,000  1,650,000  -> FILTERED (29,000 miles away) — and it is the
    //                         cheapest ask, so `lowAskingCents` must NOT be it
    //   no odo  1,880,000  -> used (a missing odometer does not disqualify)
    //   60,000  no price   -> ignored
    //   68,000  0          -> ignored
    //   69,000  -100,000   -> ignored
    // used asks sorted: 1,799,900 / 1,850,000 / 1,880,000 / 1,899,500
    // median = round((1,850,000 + 1,880,000) / 2) = 1,865,000.
    const rows: MarketComparable[] = [
      comparable({ mileage: 62_400, askingPriceCents: 1_899_500 }),
      comparable({ mileage: 66_000, askingPriceCents: 1_850_000 }),
      comparable({ mileage: 71_200, askingPriceCents: 1_799_900 }),
      comparable({ mileage: 96_000, askingPriceCents: 1_650_000 }),
      comparable({ mileage: undefined, askingPriceCents: 1_880_000 }),
      comparable({ mileage: 60_000, askingPriceCents: undefined }),
      comparable({ mileage: 68_000, askingPriceCents: 0 }),
      comparable({ mileage: 69_000, askingPriceCents: -100_000 }),
    ];

    const summary = summarizeComparables(rows, COROLLA_MILEAGE);

    expect(summary).toEqual({
      total: 8,
      priced: 5,
      used: 4,
      filteredByMileage: 1,
      medianAskingCents: 1_865_000,
      lowAskingCents: 1_799_900,
      highAskingCents: 1_899_500,
      mileageBand: COROLLA_BAND,
    });
    // The extremes are the extremes of the USED set, not of everything returned:
    // the cheapest ask in the payload (1,650,000) was filtered out on mileage.
    expect(summary.lowAskingCents).toBe(1_799_900);
    expect(summary.highAskingCents).toBe(1_899_500);
    expect(summary.lowAskingCents).not.toBe(1_650_000);
    expect(Number.isInteger(summary.lowAskingCents)).toBe(true);
    expect(Number.isInteger(summary.highAskingCents)).toBe(true);
    expect(Number.isInteger(summary.medianAskingCents)).toBe(true);
  });

  it("reports an empty distribution with nulls when nothing is usable", () => {
    // No listings at all: the band is still reported (it depends only on the
    // subject) and every distribution figure is null rather than 0.
    const empty = summarizeComparables([], COROLLA_MILEAGE);
    expect(empty).toEqual({
      total: 0,
      priced: 0,
      used: 0,
      filteredByMileage: 0,
      medianAskingCents: null,
      lowAskingCents: null,
      highAskingCents: null,
      mileageBand: COROLLA_BAND,
    });

    // Listings exist but every one is unpriced, so the distribution is empty.
    const unpriced = summarizeComparables(
      [
        comparable({ mileage: 64_000, askingPriceCents: undefined }),
        comparable({ mileage: 70_000, askingPriceCents: 0 }),
      ],
      COROLLA_MILEAGE,
    );
    expect(unpriced.total).toBe(2);
    expect(unpriced.priced).toBe(0);
    expect(unpriced.used).toBe(0);
    expect(unpriced.medianAskingCents).toBeNull();
    expect(unpriced.lowAskingCents).toBeNull();
    expect(unpriced.highAskingCents).toBeNull();
  });
});
