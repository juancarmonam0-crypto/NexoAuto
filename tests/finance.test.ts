import { describe, expect, it } from "vitest";
import { DEFAULT_TERM_OPTIONS_MONTHS, estimateMonthlyPaymentCents, estimatePayment, FINANCING_DISCLAIMER, MAX_APR_BASIS_POINTS, MAX_TERM_MONTHS, MIN_TERM_MONTHS } from "@/lib/finance";

describe("finance — estimateMonthlyPaymentCents", () => {
  it("returns 0 for a zero principal", () => {
    expect(estimateMonthlyPaymentCents(0, 899, 60)).toBe(0);
  });

  it("divides evenly at 0% APR", () => {
    expect(estimateMonthlyPaymentCents(1_200_000, 0, 60)).toBe(20_000);
    expect(estimateMonthlyPaymentCents(1_000_000, 0, 40)).toBe(25_000);
  });

  // $10,000 at 6.00% APR over 60 months is $193.33/month on any standard
  // amortisation calculator. A tolerance band proves correctness against that
  // independent value instead of merely echoing the implementation.
  it("matches the standard amortisation value ($10,000 / 6% / 60mo = $193.33)", () => {
    const payment = estimateMonthlyPaymentCents(1_000_000, 600, 60);
    expect(payment).toBeGreaterThanOrEqual(19_330);
    expect(payment).toBeLessThanOrEqual(19_336);
    // Total interest must land near the known $1,599.80.
    const interest = payment * 60 - 1_000_000;
    expect(interest).toBeGreaterThan(159_500);
    expect(interest).toBeLessThan(160_500);
  });

  it("charges more per month as APR rises and less as the term lengthens", () => {
    const low = estimateMonthlyPaymentCents(2_000_000, 300, 60);
    const high = estimateMonthlyPaymentCents(2_000_000, 1_500, 60);
    expect(high).toBeGreaterThan(low);

    const shortTerm = estimateMonthlyPaymentCents(2_000_000, 600, 36);
    const longTerm = estimateMonthlyPaymentCents(2_000_000, 600, 72);
    expect(shortTerm).toBeGreaterThan(longTerm);
  });

  it("never returns a negative payment for a negative APR", () => {
    expect(estimateMonthlyPaymentCents(1_000_000, -500, 60)).toBe(estimateMonthlyPaymentCents(1_000_000, 0, 60));
  });
});

describe("finance — estimatePayment: amortisation and totals", () => {
  it("finances the full price with no down payment and no APR", () => {
    const result = estimatePayment({ priceCents: 1_200_000, aprBasisPoints: 0, termMonths: 60 });
    expect(result.amountFinancedCents).toBe(1_200_000);
    expect(result.monthlyPaymentCents).toBe(20_000);
    expect(result.totalOfPaymentsCents).toBe(1_200_000);
    expect(result.totalInterestCents).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("keeps total interest consistent with payment x term", () => {
    const result = estimatePayment({ priceCents: 3_000_000, aprBasisPoints: 749, termMonths: 72, downPaymentCents: 500_000 });
    expect(result.totalOfPaymentsCents).toBe(result.monthlyPaymentCents * 72);
    expect(result.totalInterestCents).toBe(result.totalOfPaymentsCents - result.amountFinancedCents);
    expect(result.totalInterestCents).toBeGreaterThan(0);
  });

  it("deducts the down payment before amortising", () => {
    const withDown = estimatePayment({ priceCents: 2_000_000, downPaymentCents: 500_000, aprBasisPoints: 0, termMonths: 60 });
    expect(withDown.amountFinancedCents).toBe(1_500_000);
    expect(withDown.monthlyPaymentCents).toBe(25_000);
  });

  it("adds dealer fees into the financed amount", () => {
    const result = estimatePayment({ priceCents: 2_000_000, dealerFeesCents: 29_500, aprBasisPoints: 0, termMonths: 60 });
    expect(result.dealerFeesCents).toBe(29_500);
    expect(result.amountFinancedCents).toBe(2_029_500);
  });

  it("returns a zero payment when nothing is financed", () => {
    const result = estimatePayment({ priceCents: 0, aprBasisPoints: 899, termMonths: 60 });
    expect(result.amountFinancedCents).toBe(0);
    expect(result.monthlyPaymentCents).toBe(0);
    expect(result.totalInterestCents).toBe(0);
  });
});

describe("finance — Texas trade-in taxable calculation", () => {
  it("taxes the price less the trade-in allowance", () => {
    const result = estimatePayment({
      priceCents: 2_000_000,
      tradeInAllowanceCents: 500_000,
      salesTaxBasisPoints: 625,
      aprBasisPoints: 0,
      termMonths: 60,
    });
    expect(result.taxableAmountCents).toBe(1_500_000);
    expect(result.salesTaxCents).toBe(93_750);
    expect(result.amountFinancedCents).toBe(2_000_000 + 93_750 - 500_000);
  });

  it("taxes the full price when there is no trade-in, and the difference is the tax saving", () => {
    const withoutTrade = estimatePayment({ priceCents: 2_000_000, salesTaxBasisPoints: 625, aprBasisPoints: 0, termMonths: 60 });
    const withTrade = estimatePayment({
      priceCents: 2_000_000,
      tradeInAllowanceCents: 500_000,
      salesTaxBasisPoints: 625,
      aprBasisPoints: 0,
      termMonths: 60,
    });
    expect(withoutTrade.taxableAmountCents).toBe(2_000_000);
    expect(withoutTrade.salesTaxCents).toBe(125_000);
    expect(withoutTrade.salesTaxCents - withTrade.salesTaxCents).toBe(31_250);
  });

  it("never taxes a negative taxable amount and treats a negative tax rate as 0%", () => {
    const overTraded = estimatePayment({ priceCents: 500_000, tradeInAllowanceCents: 900_000, salesTaxBasisPoints: 625, aprBasisPoints: 0, termMonths: 60 });
    expect(overTraded.taxableAmountCents).toBe(0);
    expect(overTraded.salesTaxCents).toBe(0);

    const negativeRate = estimatePayment({ priceCents: 1_000_000, salesTaxBasisPoints: -625, aprBasisPoints: 0, termMonths: 60 });
    expect(negativeRate.salesTaxCents).toBe(0);
  });

  it("applies no tax when no rate is supplied", () => {
    const result = estimatePayment({ priceCents: 1_000_000, aprBasisPoints: 0, termMonths: 60 });
    expect(result.salesTaxCents).toBe(0);
  });
});

describe("finance — term and APR clamping", () => {
  it("leaves a term inside the allowed range untouched, with no warning", () => {
    expect(estimatePayment({ priceCents: 1_000_000, termMonths: MIN_TERM_MONTHS }).termMonths).toBe(12);
    expect(estimatePayment({ priceCents: 1_000_000, termMonths: MIN_TERM_MONTHS }).warnings).toEqual([]);
    expect(estimatePayment({ priceCents: 1_000_000, termMonths: MAX_TERM_MONTHS }).termMonths).toBe(96);
    expect(estimatePayment({ priceCents: 1_000_000, termMonths: MAX_TERM_MONTHS }).warnings).toEqual([]);
    expect(estimatePayment({ priceCents: 1_000_000, termMonths: 60 }).termMonths).toBe(60);
  });

  it("raises a too-short term to the minimum and explains why", () => {
    const result = estimatePayment({ priceCents: 1_000_000, termMonths: 6 });
    expect(result.termMonths).toBe(MIN_TERM_MONTHS);
    expect(result.warnings).toEqual(["Term raised to the 12-month minimum."]);
  });

  it("caps a too-long term and explains why", () => {
    const result = estimatePayment({ priceCents: 1_000_000, termMonths: 200 });
    expect(result.termMonths).toBe(MAX_TERM_MONTHS);
    expect(result.warnings).toEqual(["Term capped at 96 months."]);
  });

  it("treats a negative APR as 0% and warns", () => {
    const result = estimatePayment({ priceCents: 1_000_000, aprBasisPoints: -100, termMonths: 60 });
    expect(result.aprBasisPoints).toBe(0);
    expect(result.warnings).toEqual(["Negative APR treated as 0%."]);
    // At 0% APR the payment is round(principal / months), so the only gap
    // between the total of payments and the amount financed is the cent
    // rounding: 60 x round(1,000,000 / 60) = 1,000,020, i.e. 20 cents.
    expect(result.monthlyPaymentCents).toBe(16_667);
    expect(result.totalOfPaymentsCents).toBe(1_000_020);
    expect(result.totalInterestCents).toBe(20);
  });

  it("bounds the 0%-APR rounding surplus to at most half a cent per month", () => {
    // Guards against the rounding artifact ever growing into a material amount.
    for (const termMonths of [12, 24, 36, 48, 60, 66, 72, 84, 96]) {
      const result = estimatePayment({ priceCents: 1_000_001, aprBasisPoints: 0, termMonths });
      expect(result.totalInterestCents, `term ${termMonths}`).toBeLessThanOrEqual(termMonths / 2);
      expect(result.totalInterestCents, `term ${termMonths}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports exactly zero interest at 0% APR when the term divides evenly", () => {
    // Principal is built from the payment so divisibility holds by construction.
    for (const monthlyPaymentCents of [10_000, 20_000, 25_000, 40_000]) {
      const principalCents = monthlyPaymentCents * 60;
      const result = estimatePayment({ priceCents: principalCents, aprBasisPoints: 0, termMonths: 60 });
      expect(result.monthlyPaymentCents, `payment ${monthlyPaymentCents}`).toBe(monthlyPaymentCents);
      expect(result.totalInterestCents, `payment ${monthlyPaymentCents}`).toBe(0);
    }
  });

  it("caps an excessive APR and warns", () => {
    const result = estimatePayment({ priceCents: 1_000_000, aprBasisPoints: 5_000, termMonths: 60 });
    expect(result.aprBasisPoints).toBe(MAX_APR_BASIS_POINTS);
    expect(result.warnings).toEqual(["APR capped at 30%."]);
  });

  it("defaults an omitted APR to 0% and an omitted term to 60 months", () => {
    const result = estimatePayment({ priceCents: 1_200_000 });
    expect(result.aprBasisPoints).toBe(0);
    expect(result.termMonths).toBe(60);
    expect(result.monthlyPaymentCents).toBe(20_000);
  });

  it("accumulates multiple warnings when several inputs are clamped", () => {
    const result = estimatePayment({ priceCents: 1_000_000, aprBasisPoints: 9_999, termMonths: 1 });
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings).toContain("Term raised to the 12-month minimum.");
    expect(result.warnings).toContain("APR capped at 30%.");
  });
});

describe("finance — over-payment guard and disclaimer", () => {
  it("warns and finances nothing when down payment plus trade-in exceeds the amount due", () => {
    const result = estimatePayment({
      priceCents: 1_000_000,
      downPaymentCents: 800_000,
      tradeInAllowanceCents: 500_000,
      aprBasisPoints: 899,
      termMonths: 60,
    });
    expect(result.amountFinancedCents).toBe(0);
    expect(result.monthlyPaymentCents).toBe(0);
    expect(result.warnings).toContain("Down payment and trade-in exceed the amount due; financed amount is $0.");
  });

  it("does not warn when the down payment exactly covers the amount due", () => {
    const result = estimatePayment({ priceCents: 1_000_000, downPaymentCents: 1_000_000, aprBasisPoints: 899, termMonths: 60 });
    expect(result.amountFinancedCents).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("always carries a disclaimer that never claims approval", () => {
    const result = estimatePayment({ priceCents: 1_500_000, aprBasisPoints: 899, termMonths: 60 });
    expect(result.disclaimer).toBe(FINANCING_DISCLAIMER);
    expect(result.disclaimer).toMatch(/estimate only/i);
    expect(result.disclaimer).toMatch(/not an offer, approval/i);
    // The estimator must not assert that anyone is approved or guaranteed.
    expect(result.disclaimer).not.toMatch(/you are approved|guaranteed approval|pre-?approved/i);
  });

  it("exposes standard term options that sit inside the allowed range", () => {
    for (const term of DEFAULT_TERM_OPTIONS_MONTHS) {
      expect(term).toBeGreaterThanOrEqual(MIN_TERM_MONTHS);
      expect(term).toBeLessThanOrEqual(MAX_TERM_MONTHS);
    }
    expect(DEFAULT_TERM_OPTIONS_MONTHS).toContain(60);
  });
});
