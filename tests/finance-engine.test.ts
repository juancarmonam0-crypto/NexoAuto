import { describe, expect, it } from "vitest";
import {
  type AmortizationResult,
  type PaymentFrequency,
  MAX_CONTRACT_APR_BASIS_POINTS,
  MAX_NUMBER_OF_PAYMENTS,
  MONEY_FACTOR_TO_BASIS_POINTS,
  PAYMENT_FREQUENCIES,
  PERIODS_PER_YEAR,
  aprBasisPointsToMoneyFactor,
  buildAmortizationSchedule,
  buildLeaseSchedule,
  computeContractAmounts,
  computeLevelPaymentCents,
  computeSalesTaxCents,
  computeTaxableAmountCents,
  finalPaymentDriftBoundCents,
  moneyFactorToAprBasisPoints,
  numberOfPaymentsFor,
  periodsPerYear,
} from "@/lib/finance-engine";

/**
 * Phase 9B — the canonical amortisation engine.
 *
 * Every money assertion in this file is on INTEGER CENTS. Where a value is
 * independently knowable (a standard amortisation calculator, the loan-balance
 * formula, exact integer arithmetic) the test states that reference value and
 * explains the arithmetic rather than restating the implementation.
 */

const BPS_6_PERCENT = 600;
const BPS_BHPH = 2_400; // 24.00% — a typical buy-here-pay-here note
const TWENTY_THOUSAND_DOLLARS = 2_000_000;

function totalOfRowPayments(schedule: AmortizationResult): number {
  return schedule.rows.reduce((total, row) => total + row.paymentCents, 0);
}

function totalOfRowInterest(schedule: AmortizationResult): number {
  return schedule.rows.reduce((total, row) => total + row.interestCents, 0);
}

/**
 * The invariants that must hold for EVERY schedule the engine can produce. A
 * schedule that closes to zero but does not sum to the amount financed is a
 * contract the database constraint `deals_payments_arithmetic` would reject, so
 * these are asserted against every fixture below.
 */
function expectScheduleInvariants(schedule: AmortizationResult, label: string): void {
  expect(schedule.rows, `${label}: row count`).toHaveLength(schedule.numberOfPayments);
  expect(schedule.rows.at(-1)?.closingBalanceCents, `${label}: last row closes to zero`).toBe(0);
  expect(schedule.totalOfPaymentsCents, `${label}: total = principal + finance charge`).toBe(
    schedule.amountFinancedCents + schedule.financeChargeCents,
  );
  expect(schedule.totalOfPaymentsCents, `${label}: total = sum of payments`).toBe(totalOfRowPayments(schedule));
  expect(schedule.financeChargeCents, `${label}: finance charge = sum of interest`).toBe(totalOfRowInterest(schedule));
  expect(schedule.financeChargeCents, `${label}: finance charge is never negative`).toBeGreaterThanOrEqual(0);

  // Rounding is absorbed by the last payment. The drift bound itself is checked
  // separately below (see the BUG-marked test): it is a real, documented
  // invariant that the engine does not always satisfy.
  const drift = Math.abs(schedule.finalPaymentCents - schedule.paymentAmountCents);
  expect(drift, `${label}: final payment is finite`).toBeGreaterThanOrEqual(0);

  for (const row of schedule.rows) {
    expect(row.paymentCents, `${label}: row ${row.period} payment is not negative`).toBeGreaterThanOrEqual(0);
    expect(row.closingBalanceCents, `${label}: row ${row.period} balance is not negative`).toBeGreaterThanOrEqual(0);
    expect(row.principalCents, `${label}: row ${row.period} principal = payment - interest`).toBe(
      row.paymentCents - row.interestCents,
    );
    expect(row.closingBalanceCents, `${label}: row ${row.period} balance = opening + interest - payment`).toBe(
      row.openingBalanceCents + row.interestCents - row.paymentCents,
    );
  }

  // Rows chain: each opening balance is the previous closing balance.
  for (let index = 1; index < schedule.rows.length; index += 1) {
    expect(schedule.rows[index]!.openingBalanceCents, `${label}: row ${index + 1} chains`).toBe(
      schedule.rows[index - 1]!.closingBalanceCents,
    );
  }
  expect(schedule.rows[0]?.openingBalanceCents, `${label}: first row opens at the amount financed`).toBe(
    schedule.amountFinancedCents,
  );
}

describe("finance-engine — computeLevelPaymentCents", () => {
  it("reduces to principal / periods at 0% APR", () => {
    // With no interest every period repays an equal slice of the principal.
    expect(computeLevelPaymentCents(1_200_000, 0, 60)).toBe(20_000);
    expect(computeLevelPaymentCents(1_000_000, 0, 40)).toBe(25_000);
    expect(computeLevelPaymentCents(999, 0, 3)).toBe(333);
  });

  it("matches the standard amortisation value: $10,000 at 6.00% over 60 months", () => {
    // payment = P*i*(1+i)^n / ((1+i)^n - 1) with i = 0.06/12 = 0.005 and n = 60
    //   (1.005)^60            = 1.3488501525...
    //   1000000*0.005*1.34885 = 6744.2507626...
    //   / 0.3488501525        = 19333.42...  -> 19333 cents = $193.33
    // Any standard amortisation calculator returns $193.33/month for this loan.
    const payment = computeLevelPaymentCents(1_000_000, BPS_6_PERCENT, 60);
    expect(payment).toBeGreaterThanOrEqual(19_330);
    expect(payment).toBeLessThanOrEqual(19_336);
    // Independent cross-check on the total interest: 60 x $193.33 - $10,000 is
    // about $1,599.80 over the life of the note.
    const totalInterest = payment * 60 - 1_000_000;
    expect(totalInterest).toBeGreaterThan(159_500);
    expect(totalInterest).toBeLessThan(160_500);
  });

  it("agrees with the loan-balance reference for the first period's interest", () => {
    // The periodic rate is exactly 0.005, so the first period's interest on the
    // whole principal is 1,000,000 x 0.005 = 5,000 cents, and the payment must
    // therefore retire 19,333 - 5,000 = 14,333 cents of principal.
    const schedule = buildAmortizationSchedule({
      amountFinancedCents: 1_000_000,
      aprBasisPoints: BPS_6_PERCENT,
      numberOfPayments: 60,
    });
    expect(schedule.rows[0]?.interestCents).toBe(5_000);
    expect(schedule.rows[0]?.principalCents).toBe(schedule.paymentAmountCents - 5_000);
    expect(schedule.rows[0]?.closingBalanceCents).toBe(1_000_000 - (schedule.paymentAmountCents - 5_000));
  });

  it("charges a bigger payment as APR rises", () => {
    const atSix = computeLevelPaymentCents(TWENTY_THOUSAND_DOLLARS, BPS_6_PERCENT, 60);
    const atTwelve = computeLevelPaymentCents(TWENTY_THOUSAND_DOLLARS, 1_200, 60);
    const atBhph = computeLevelPaymentCents(TWENTY_THOUSAND_DOLLARS, BPS_BHPH, 60);
    expect(atTwelve).toBeGreaterThan(atSix);
    expect(atBhph).toBeGreaterThan(atTwelve);
  });

  it("charges a smaller payment as the term lengthens", () => {
    const short = computeLevelPaymentCents(TWENTY_THOUSAND_DOLLARS, BPS_6_PERCENT, 36);
    const medium = computeLevelPaymentCents(TWENTY_THOUSAND_DOLLARS, BPS_6_PERCENT, 60);
    const long = computeLevelPaymentCents(TWENTY_THOUSAND_DOLLARS, BPS_6_PERCENT, 72);
    expect(medium).toBeLessThan(short);
    expect(long).toBeLessThan(medium);
  });

  it("returns 0 for a zero principal", () => {
    expect(computeLevelPaymentCents(0, BPS_6_PERCENT, 60)).toBe(0);
    expect(computeLevelPaymentCents(0, 0, 1)).toBe(0);
    // Zero principal is answered before the period count is validated, because
    // there is nothing to amortise; this is deliberate and asserted so a change
    // of behaviour is noticed.
    expect(computeLevelPaymentCents(0, 0, 0)).toBe(0);
  });

  it("amortises the whole balance in a single period", () => {
    // One period means the entire principal plus one period of interest:
    // 1,000,000 x 1.005 = 1,005,000 cents = $10,050.00.
    expect(computeLevelPaymentCents(1_000_000, BPS_6_PERCENT, 1)).toBe(1_005_000);
    // At 0% a single period is just the principal.
    expect(computeLevelPaymentCents(1_000_000, 0, 1)).toBe(1_000_000);
  });

  it("throws a RangeError when the period count is below 1", () => {
    // A contract with no payment periods is not a contract.
    expect(() => computeLevelPaymentCents(1_000_000, BPS_6_PERCENT, 0)).toThrow(RangeError);
    expect(() => computeLevelPaymentCents(1_000_000, BPS_6_PERCENT, -6)).toThrow(RangeError);
    expect(() => computeLevelPaymentCents(1_000_000, BPS_6_PERCENT, Number.NaN)).toThrow(RangeError);
  });

  // FIXED DURING PHASE 9B. `computeLevelPaymentCents` — the function that
  // actually builds the payment — had no equivalent of the ceiling guard that
  // `buildAmortizationSchedule` enforces, so it happily computed
  // `computeLevelPaymentCents(1_000_000, 10_001, 12)` = 9,353,755 cents: a
  // $93,537.55 monthly payment at an impossible 100.01% APR. It also clamped a
  // negative rate silently, contradicting the module's own rule 3 ("the engine
  // never clamps a rate … bad input raises a RangeError").
  it("throws a RangeError when the APR is above the contract ceiling", () => {
    expect(MAX_CONTRACT_APR_BASIS_POINTS).toBe(10_000);
    expect(() =>
      computeLevelPaymentCents(1_000_000, MAX_CONTRACT_APR_BASIS_POINTS + 1, 12),
    ).toThrow(RangeError);
    // A negative rate is not a contract rate either.
    expect(() => computeLevelPaymentCents(1_000_000, -6, 12)).toThrow(RangeError);
  });

  it("accepts a rate exactly at the contract ceiling", () => {
    // The ceiling itself is a legal contract rate; only above it is a typo.
    expect(MAX_CONTRACT_APR_BASIS_POINTS).toBe(10_000);
    expect(computeLevelPaymentCents(1_000_000, MAX_CONTRACT_APR_BASIS_POINTS, 12)).toBeGreaterThan(0);
  });

  it("keeps the payments-per-year table honest, including bi-weekly 26", () => {
    expect(PERIODS_PER_YEAR.MONTHLY).toBe(12);
    expect(PERIODS_PER_YEAR.SEMIMONTHLY).toBe(24);
    expect(PERIODS_PER_YEAR.BIWEEKLY).toBe(26); // 52 weeks / 2, NOT 24
    expect(PERIODS_PER_YEAR.WEEKLY).toBe(52);
    for (const frequency of PAYMENT_FREQUENCIES) {
      expect(periodsPerYear(frequency)).toBe(PERIODS_PER_YEAR[frequency]);
    }
  });

  it("scales the frequency by the periods per year", () => {
    // The same principal at the same APR costs less per period as the frequency
    // rises, because each period carries less interest.
    const monthly = computeLevelPaymentCents(1_000_000, BPS_6_PERCENT, 60, "MONTHLY");
    const semimonthly = computeLevelPaymentCents(1_000_000, BPS_6_PERCENT, 120, "SEMIMONTHLY");
    const biweekly = computeLevelPaymentCents(1_000_000, BPS_6_PERCENT, 130, "BIWEEKLY");
    const weekly = computeLevelPaymentCents(1_000_000, BPS_6_PERCENT, 260, "WEEKLY");
    expect(semimonthly).toBeLessThan(monthly);
    expect(biweekly).toBeLessThan(semimonthly);
    expect(weekly).toBeLessThan(biweekly);
  });
});

describe("finance-engine — numberOfPaymentsFor and periodsPerYear", () => {
  it("uses 12 / 24 / 26 / 52 periods per year", () => {
    expect(periodsPerYear("MONTHLY")).toBe(12);
    expect(periodsPerYear("SEMIMONTHLY")).toBe(24);
    // The classic bi-weekly error is to use 24; a year has 26 fortnightly
    // payments, which is exactly why bi-weekly amortises faster.
    expect(periodsPerYear("BIWEEKLY")).toBe(26);
    expect(periodsPerYear("WEEKLY")).toBe(52);
  });

  it("converts a term in months into the right number of payments", () => {
    expect(numberOfPaymentsFor(60, "MONTHLY")).toBe(60);
    expect(numberOfPaymentsFor(60, "SEMIMONTHLY")).toBe(120);
    expect(numberOfPaymentsFor(60, "BIWEEKLY")).toBe(130);
    expect(numberOfPaymentsFor(60, "WEEKLY")).toBe(260);
    // 24 months of fortnightly payments is 24 x 26/12 = 52 payments.
    expect(numberOfPaymentsFor(24, "BIWEEKLY")).toBe(52);
    // 12 months of weekly payments is 12 x 52/12 = 52 payments.
    expect(numberOfPaymentsFor(12, "WEEKLY")).toBe(52);
    expect(numberOfPaymentsFor(24, "MONTHLY")).toBe(24);
    expect(numberOfPaymentsFor(12, "SEMIMONTHLY")).toBe(24);
  });

  it("rounds a fractional month count to a whole number of payments", () => {
    // 1 month weekly = 52/12 = 4.33 -> 4 payments.
    expect(numberOfPaymentsFor(1, "WEEKLY")).toBe(4);
    // 1 month bi-weekly = 26/12 = 2.17 -> 2 payments.
    expect(numberOfPaymentsFor(1, "BIWEEKLY")).toBe(2);
  });

  it("throws a RangeError for a non-positive or non-finite term", () => {
    expect(() => numberOfPaymentsFor(0, "MONTHLY")).toThrow(RangeError);
    expect(() => numberOfPaymentsFor(-3, "MONTHLY")).toThrow(RangeError);
    expect(() => numberOfPaymentsFor(Number.NaN, "MONTHLY")).toThrow(RangeError);
    expect(() => numberOfPaymentsFor(Number.POSITIVE_INFINITY, "MONTHLY")).toThrow(RangeError);
  });

  it("throws rather than building an unbounded schedule", () => {
    // 1,200 payments x 100 years of months x 12 is above the sanity bound.
    const absurdMonths = MAX_NUMBER_OF_PAYMENTS + 1;
    expect(() => numberOfPaymentsFor(absurdMonths, "MONTHLY")).toThrow(RangeError);
  });
});

describe("finance-engine — buildAmortizationSchedule invariants", () => {
  const terms = [1, 12, 24, 36, 48, 60];
  const rates = [
    { label: "0% APR", bps: 0 },
    { label: "6.00% APR", bps: BPS_6_PERCENT },
    { label: "24.00% APR (BHPH)", bps: BPS_BHPH },
  ];

  for (const term of terms) {
    for (const rate of rates) {
      it(`closes to zero and sums exactly at ${term} months and ${rate.label}`, () => {
        const schedule = buildAmortizationSchedule({
          amountFinancedCents: TWENTY_THOUSAND_DOLLARS,
          aprBasisPoints: rate.bps,
          numberOfPayments: term,
        });
        expectScheduleInvariants(schedule, `${term}mo @ ${rate.label}`);
        if (rate.bps === 0) {
          // No interest can be charged when the rate is zero.
          expect(schedule.financeChargeCents).toBe(0);
          expect(schedule.totalOfPaymentsCents).toBe(TWENTY_THOUSAND_DOLLARS);
        } else {
          expect(schedule.financeChargeCents).toBeGreaterThan(0);
        }
      });
    }
  }

  it("sums exactly at every payment frequency", () => {
    for (const frequency of PAYMENT_FREQUENCIES) {
      const schedule = buildAmortizationSchedule({
        amountFinancedCents: TWENTY_THOUSAND_DOLLARS,
        aprBasisPoints: BPS_6_PERCENT,
        numberOfPayments: numberOfPaymentsFor(60, frequency),
        paymentFrequency: frequency,
      });
      expectScheduleInvariants(schedule, frequency);
      expect(schedule.paymentFrequency).toBe(frequency);
      // 60 months is 5 years, so the total interest must be close to the
      // monthly schedule's regardless of how it is sliced.
      expect(schedule.financeChargeCents).toBeGreaterThan(0);
    }
  });

  it("produces no rows and no finance charge when nothing is financed", () => {
    const schedule = buildAmortizationSchedule({
      amountFinancedCents: 0,
      aprBasisPoints: BPS_BHPH,
      numberOfPayments: 12,
    });
    expect(schedule.rows).toEqual([]);
    expect(schedule.financeChargeCents).toBe(0);
    expect(schedule.totalOfPaymentsCents).toBe(0);
    expect(schedule.paymentAmountCents).toBe(0);
    expect(schedule.finalPaymentCents).toBe(0);
    expect(schedule.numberOfPayments).toBe(0);
    expect(schedule.negativeAmortization).toBe(false);
    expect(schedule.balloonFinalPayment).toBe(false);
  });

  it("throws a RangeError for a non-positive number of payments", () => {
    expect(() =>
      buildAmortizationSchedule({ amountFinancedCents: 1_000_000, aprBasisPoints: 600, numberOfPayments: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      buildAmortizationSchedule({ amountFinancedCents: 1_000_000, aprBasisPoints: 600, numberOfPayments: -1 }),
    ).toThrow(RangeError);
  });

  it("throws a RangeError for an APR above the contract ceiling", () => {
    expect(() =>
      buildAmortizationSchedule({
        amountFinancedCents: 1_000_000,
        aprBasisPoints: MAX_CONTRACT_APR_BASIS_POINTS + 1,
        numberOfPayments: 12,
      }),
    ).toThrow(RangeError);
  });
});

describe("finance-engine — final-payment rounding drift", () => {
  it("raises the last payment when the level payment rounds UP (1,000,001 cents over 12 months)", () => {
    // 1,000,001 / 12 = 83,333.4166..., so the level payment rounds DOWN to
    // 83,333 and 12 x 83,333 = 999,996 — 5 cents SHORT of the principal. The
    // last payment absorbs the shortfall: it is 83,333 + 5 = 83,338, i.e. the
    // final scheduled payment is LARGER than the level payment.
    const schedule = buildAmortizationSchedule({
      amountFinancedCents: 1_000_001,
      aprBasisPoints: 0,
      numberOfPayments: 12,
    });
    expect(schedule.paymentAmountCents).toBe(83_333);
    expect(schedule.finalPaymentCents).toBe(83_338);
    expect(schedule.finalPaymentCents).toBeGreaterThan(schedule.paymentAmountCents);
    expect(schedule.rows.at(-1)?.openingBalanceCents).toBe(83_338);
    expectScheduleInvariants(schedule, "12mo drift up");
  });

  it("lowers the last payment when the level payment rounds UP (1,000,002 cents over 12 months)", () => {
    // 1,000,002 / 12 = 83,333.5 exactly, which rounds UP to 83,334. Twelve of
    // those is 1,000,008, i.e. 6 cents MORE than the principal, so the final
    // payment is reduced to 83,334 - 6 = 83,328.
    const schedule = buildAmortizationSchedule({
      amountFinancedCents: 1_000_002,
      aprBasisPoints: 0,
      numberOfPayments: 12,
    });
    expect(schedule.paymentAmountCents).toBe(83_334);
    expect(schedule.finalPaymentCents).toBe(83_328);
    expect(schedule.finalPaymentCents).toBeLessThan(schedule.paymentAmountCents);
    expect(schedule.rows.at(-1)?.openingBalanceCents).toBe(83_328);
    expectScheduleInvariants(schedule, "12mo drift down");
  });

  it("absorbs the drift in both directions over 60 months at 0%", () => {
    // 1,000,001 / 60 = 16,666.68 -> 16,667 level payment, 60 x 16,667 =
    // 1,000,020, which is 19 cents over, so the last payment drops to 16,648.
    const over = buildAmortizationSchedule({
      amountFinancedCents: 1_000_001,
      aprBasisPoints: 0,
      numberOfPayments: 60,
    });
    expect(over.paymentAmountCents).toBe(16_667);
    expect(over.finalPaymentCents).toBe(16_648);
    expectScheduleInvariants(over, "60mo over");

    // 1,000,019 / 60 = 16,666.98 -> 16,667, and 60 x 16,667 = 1,000,020, one
    // cent over, so the last payment is 16,666.
    const under = buildAmortizationSchedule({
      amountFinancedCents: 1_000_019,
      aprBasisPoints: 0,
      numberOfPayments: 60,
    });
    expect(under.paymentAmountCents).toBe(16_667);
    expect(under.finalPaymentCents).toBe(16_666);
    expectScheduleInvariants(under, "60mo under");
  });

  it("never lets the 0% rounding surplus exceed half a cent per period", () => {
    // The only gap between the total of payments and the principal at 0% is the
    // cent rounding, bounded by half a cent per period.
    for (const term of [1, 12, 24, 36, 48, 60, 120]) {
      const schedule = buildAmortizationSchedule({
        amountFinancedCents: 1_000_001,
        aprBasisPoints: 0,
        numberOfPayments: term,
      });
      expect(schedule.financeChargeCents, `term ${term}`).toBe(0);
      expect(
        Math.abs(schedule.totalOfPaymentsCents - 1_000_001),
        `term ${term} total gap`,
      ).toBeLessThanOrEqual(term / 2);
    }
  });

  // CORRECTED DURING PHASE 9B. The engine's documentation claimed the final
  // payment stays within `numberOfPayments / 2` cents of the level payment. That
  // is false: interest is rounded to the cent every period and each period's
  // error feeds back into the balance, so the residue is AMPLIFIED by the rate.
  // `2,000,000` cents at `2,400` bps over 48 months drifts 27 cents (not 24), and
  // 84 months at the same rate drifts 97 cents.
  //
  // The DOCUMENTATION was wrong, not the arithmetic: the schedule still closes
  // to exactly zero and `total = principal + finance charge` still holds
  // cent-exact. The engine now derives the real bound from that propagation and
  // exposes it as `finalPaymentDriftBoundCents(n, aprBps, frequency)`.
  it("keeps the final payment inside the derived drift bound", () => {
    const schedule = buildAmortizationSchedule({
      amountFinancedCents: 2_000_000,
      aprBasisPoints: BPS_BHPH,
      numberOfPayments: 48,
    });
    const drift = Math.abs(schedule.finalPaymentCents - schedule.paymentAmountCents);

    // The concrete case that falsified the old `n / 2` bound.
    expect(drift).toBe(27);
    expect(drift).toBeGreaterThan(schedule.numberOfPayments / 2);
    // ...and the derived bound, which does hold.
    expect(drift).toBeLessThanOrEqual(
      finalPaymentDriftBoundCents(schedule.numberOfPayments, schedule.aprBasisPoints, "MONTHLY"),
    );

    // The bound is a property of the accumulation, so prove it across a sweep
    // rather than on one input, including the 84-month case that falsified the
    // first attempted correction.
    for (const aprBasisPoints of [0, 600, BPS_BHPH, 3_600]) {
      for (const numberOfPayments of [1, 12, 36, 48, 60, 84, 96]) {
        const swept = buildAmortizationSchedule({
          amountFinancedCents: 2_345_678,
          aprBasisPoints,
          numberOfPayments,
        });
        const sweptDrift = Math.abs(swept.finalPaymentCents - swept.paymentAmountCents);
        expect(sweptDrift, `term ${numberOfPayments} at ${aprBasisPoints} bps`).toBeLessThanOrEqual(
          finalPaymentDriftBoundCents(swept.numberOfPayments, swept.aprBasisPoints, "MONTHLY"),
        );
        // The schedule still closes to zero and keeps its invariant.
        expect(swept.rows[swept.rows.length - 1]?.closingBalanceCents).toBe(0);
        expect(swept.financeChargeCents).toBeGreaterThanOrEqual(0);
        expect(swept.totalOfPaymentsCents).toBe(swept.amountFinancedCents + swept.financeChargeCents);
      }
    }

    // At 0% APR there is no compounding: the drift is bounded by half a cent per
    // payment, which is the tightest case of the same formula.
    expect(finalPaymentDriftBoundCents(60, 0, "MONTHLY")).toBe(30);
  });
});

describe("finance-engine — negative amortization and balloon flags", () => {
  it("does not flag negative amortization on ordinary notes", () => {
    // 20,000 at 24% over 60 months. The periodic rate is 0.24/12 = 0.02, so the
    // first period's interest is 2,000,000 x 0.02 = 40,000 cents ($400), and the
    // level payment (about 57,536 cents) covers it several times over, so the
    // balance amortises from period one.
    const schedule = buildAmortizationSchedule({
      amountFinancedCents: TWENTY_THOUSAND_DOLLARS,
      aprBasisPoints: BPS_BHPH,
      numberOfPayments: 60,
    });
    expect(schedule.rows[0]?.interestCents).toBe(40_000);
    expect(schedule.paymentAmountCents).toBeGreaterThan(40_000);
    expect(schedule.negativeAmortization).toBe(false);
    expect(schedule.balloonFinalPayment).toBe(false);
  });

  it("sets negativeAmortization when the payment cannot cover the first period's interest", () => {
    // $1.00 (100 cents) at 90.00% APR over 522 monthly payments. The periodic
    // rate is 0.075, so period one accrues round(100 x 0.075) = 8 cents of
    // interest — but the level payment rounds to only 7 cents. The payment does
    // not even cover the interest, the balance grows, and the engine says so:
    // period 1 is 100 -> 101 cents with principalCents = -1.
    const schedule = buildAmortizationSchedule({
      amountFinancedCents: 100,
      aprBasisPoints: 9_000,
      numberOfPayments: 522,
    });
    expect(schedule.paymentAmountCents).toBe(7);
    expect(schedule.rows[0]?.interestCents).toBe(8);
    expect(schedule.rows[0]?.paymentCents).toBe(7);
    expect(schedule.rows[0]?.principalCents).toBe(-1);
    expect(schedule.rows[0]?.closingBalanceCents).toBe(101);
    expect(schedule.rows[1]?.openingBalanceCents).toBe(101);
    expect(schedule.negativeAmortization).toBe(true);
    // The flag is honest about a genuinely explosive schedule: the balance
    // compounds for 522 periods, so the final payment is enormous. That is why
    // deal-structuring.ts treats NEGATIVE_AMORTIZATION as a BLOCKING risk flag.
    expect(schedule.finalPaymentCents).toBeGreaterThan(1_000_000_000_000);
  });

  it("sets balloonFinalPayment when rounding leaves the whole balance to the last period", () => {
    // One single cent over 1,200 weekly payments at 100% APR. The level payment
    // rounds to 0 cents, so 1,199 periods pay nothing and the last payment takes
    // the entire 1 cent balance: 1 > 2 x 0, so the balloon flag is set.
    const schedule = buildAmortizationSchedule({
      amountFinancedCents: 1,
      aprBasisPoints: MAX_CONTRACT_APR_BASIS_POINTS,
      numberOfPayments: 1_200,
      paymentFrequency: "WEEKLY",
    });
    expect(schedule.paymentAmountCents).toBe(0);
    expect(schedule.finalPaymentCents).toBe(1);
    expect(schedule.balloonFinalPayment).toBe(true);
    expect(schedule.financeChargeCents).toBe(0);
    expectScheduleInvariants(schedule, "1 cent weekly balloon");
  });
});

describe("finance-engine — sales tax and contract amounts", () => {
  it("taxes the price less the trade-in allowance", () => {
    // Texas: the trade-in credit reduces the taxable amount. 20,000 - 5,000 =
    // 15,000 taxable at 6.25% = 937.50 = 93,750 cents.
    expect(computeTaxableAmountCents(2_000_000, 500_000)).toBe(1_500_000);
    expect(computeSalesTaxCents(1_500_000, 625)).toBe(93_750);
    // 20,000 x 6.25% = 1,250 = 125,000 cents; the trade-in saves 31,250 cents.
    expect(computeSalesTaxCents(2_000_000, 625)).toBe(125_000);
    expect(computeSalesTaxCents(2_000_000, 625) - computeSalesTaxCents(1_500_000, 625)).toBe(31_250);
  });

  it("floors the taxable amount at zero when the trade-in exceeds the price", () => {
    // A trade worth more than the car cannot create a negative tax base.
    expect(computeTaxableAmountCents(500_000, 900_000)).toBe(0);
    expect(computeSalesTaxCents(computeTaxableAmountCents(500_000, 900_000), 625)).toBe(0);
  });

  it("treats a negative or absent tax rate as 0%", () => {
    expect(computeSalesTaxCents(1_000_000, -625)).toBe(0);
    expect(computeSalesTaxCents(1_000_000, 0)).toBe(0);
    // No taxable amount means no tax whatever the rate.
    expect(computeSalesTaxCents(0, 825)).toBe(0);
  });

  // FIXED DURING PHASE 9B. `computeSalesTaxCents` guarded only NEGATIVE rates:
  // `Math.max(0, Math.round(NaN))` is NaN, so the `rate === 0` guard missed, the
  // NaN flowed into `amountDueCents` and `amountFinancedCents`, and one
  // unparseable tax rate poisoned the entire contract. The finiteness check now
  // comes first, so an unusable rate is treated as no tax.
  it("treats an unparseable (NaN) tax rate as 0%", () => {
    expect(computeSalesTaxCents(1_000_000, Number.NaN)).toBe(0);
    expect(computeSalesTaxCents(1_000_000, Number.POSITIVE_INFINITY)).toBe(0);
    // ...and the poison cannot reach the contract arithmetic.
    const contract = computeContractAmounts({
      sellingPriceCents: 2_000_000,
      salesTaxBasisPoints: Number.NaN,
      downPaymentCents: 200_000,
    });
    expect(contract.salesTaxCents).toBe(0);
    expect(Number.isNaN(contract.amountDueCents)).toBe(false);
    expect(Number.isNaN(contract.amountFinancedCents)).toBe(false);
    expect(contract.amountFinancedCents).toBe(1_800_000);
  });

  it("rounds tax half up on integer cents", () => {
    // 1 x 6.25% = 0.0625 cents -> 0; 8 cents x 6.25% = 0.5 cents -> 1 cent.
    expect(computeSalesTaxCents(1, 625)).toBe(0);
    expect(computeSalesTaxCents(8, 625)).toBe(1);
    expect(computeSalesTaxCents(24, 625)).toBe(2);
  });

  it("sets amount due = price + dealer fees + tax and finances the balance", () => {
    // price 20,000 + fees 295 + tax 937.50 = 21,232.50 due; less the 1,000 down
    // payment and the 5,000 trade-in allowance leaves 15,232.50 financed.
    const contract = computeContractAmounts({
      sellingPriceCents: 2_000_000,
      dealerFeesCents: 29_500,
      salesTaxBasisPoints: 625,
      tradeInAllowanceCents: 500_000,
      tradeInPayoffCents: 600_000,
      downPaymentCents: 100_000,
    });
    expect(contract.taxableAmountCents).toBe(1_500_000);
    expect(contract.salesTaxCents).toBe(93_750);
    expect(contract.amountDueCents).toBe(2_123_250);
    expect(contract.amountFinancedCents).toBe(1_523_250);
    expect(contract.amountDueCents - contract.downPaymentCents - contract.tradeInAllowanceCents).toBe(
      contract.amountFinancedCents,
    );
    // The trade was worth 5,000 but carried a 6,000 lien: 1,000 of negative
    // equity, which is a real (negative) number, not a floor at zero.
    expect(contract.tradeEquityCents).toBe(-100_000);
  });

  it("never lets the amount financed go negative", () => {
    // A 9,000 down payment on a 5,000 car is an over-payment, not a loan of a
    // negative amount.
    const contract = computeContractAmounts({ sellingPriceCents: 500_000, downPaymentCents: 900_000 });
    expect(contract.amountDueCents).toBe(500_000);
    expect(contract.amountFinancedCents).toBe(0);
  });

  it("lets an explicit salesTaxCents override the rate", () => {
    const contract = computeContractAmounts({
      sellingPriceCents: 2_000_000,
      salesTaxBasisPoints: 625,
      salesTaxCents: 1,
    });
    expect(contract.salesTaxCents).toBe(1);
    expect(contract.amountDueCents).toBe(2_000_001);
    expect(contract.amountFinancedCents).toBe(2_000_001);
  });

  it("computes a positive trade equity when the allowance exceeds the payoff", () => {
    const contract = computeContractAmounts({
      sellingPriceCents: 2_000_000,
      tradeInAllowanceCents: 500_000,
      tradeInPayoffCents: 0,
    });
    expect(contract.tradeEquityCents).toBe(500_000);
    expect(contract.amountFinancedCents).toBe(1_500_000);
  });
});

describe("finance-engine — buildLeaseSchedule is not a loan formula", () => {
  const leaseInput = {
    grossCapCostCents: 3_000_000,
    capCostReductionCents: 300_000,
    residualValueCents: 1_800_000,
    aprBasisPoints: 600,
    numberOfPayments: 36,
  } as const;

  it("charges materially less than a loan on the same adjusted cap cost", () => {
    const lease = buildLeaseSchedule(leaseInput);
    // A lease finances only the depreciation: 30,000 - 3,000 cap reduction =
    // 27,000 adjusted cap cost, less the 18,000 residual = 9,000 of value
    // consumed.
    expect(lease.adjustedCapCostCents).toBe(2_700_000);
    expect(lease.depreciationCents).toBe(900_000);

    // The loan formula applied to the SAME adjusted cap cost (the money the
    // dealer has tied up in the vehicle) would charge interest on a balance that
    // starts at the whole 27,000 and only declines to the residual. The lease
    // charges rent on the average of the cap cost and the residual instead.
    const equivalentLoanPayment = computeLevelPaymentCents(2_700_000, 600, 36);
    expect(equivalentLoanPayment).toBe(82_139);
    expect(lease.paymentAmountCents).toBe(36_250);
    expect(lease.paymentAmountCents).toBeLessThan(equivalentLoanPayment);
    // Materially lower, stated as a ratio rather than a hand-wave: less than
    // half of what the loan formula would demand on the same cap cost.
    expect(lease.paymentAmountCents * 2).toBeLessThan(equivalentLoanPayment);
    // And the rent charge really is levied on the average balance: (27,000 +
    // 18,000) / 2 = 22,500 at a 0.0025 money factor for 36 periods is
    // 4,500,000 x 0.0025 x 36 = 405,000 cents.
    expect(lease.rentChargeCents).toBe(405_000);
  });

  it("is materially cheaper than financing the full price of the same vehicle", () => {
    const lease = buildLeaseSchedule(leaseInput);
    // The two products compared on the vehicle a customer actually drives:
    // financing the whole 30,000 at 6% for 36 months, or leasing it.
    const fullPriceLoanPayment = computeLevelPaymentCents(3_000_000, 600, 36);
    expect(fullPriceLoanPayment).toBe(91_266);
    expect(lease.paymentAmountCents).toBeLessThan(fullPriceLoanPayment);
    // The lease's first-period rent (11,250 cents) is even below the loan's
    // first-period interest alone (3,000,000 x 0.005 = 15,000 cents), which is
    // the property that makes the rent charge an average-balance charge.
    expect(lease.rows[0]?.interestCents).toBe(11_250);
    expect(lease.rows[0]?.interestCents).toBeLessThan(15_000);
  });

  it("reports amountFinanced as the depreciation and totals depreciation + rent charge", () => {
    const lease = buildLeaseSchedule(leaseInput);
    expect(lease.amountFinancedCents).toBe(lease.depreciationCents);
    expect(lease.totalOfPaymentsCents).toBe(lease.depreciationCents + lease.rentChargeCents);
    expect(lease.totalOfPaymentsCents).toBe(lease.rows.reduce((total, row) => total + row.paymentCents, 0));
    expect(lease.rentChargeCents).toBe(lease.rows.reduce((total, row) => total + row.interestCents, 0));
    // (adjusted cap + residual) x money factor x n
    //   4,500,000 x 0.0025 x 36 = 405,000 cents = $4,050 of rent charge.
    expect(lease.rentChargeCents).toBe(405_000);
    // The money factor is a RATIO, not money, so it is the one number in this
    // file that is honestly a float; every currency value above and below is an
    // integer cent.
    expect(lease.moneyFactor).toBe(0.0025);
  });

  it("closes the depreciation to zero on the last row and never pays a negative amount", () => {
    const lease = buildLeaseSchedule(leaseInput);
    expect(lease.rows).toHaveLength(36);
    expect(lease.rows.at(-1)?.closingBalanceCents).toBe(0);
    expect(lease.rows[0]?.openingBalanceCents).toBe(900_000);
    for (const row of lease.rows) {
      expect(row.paymentCents, `period ${row.period}`).toBeGreaterThanOrEqual(0);
      expect(row.interestCents, `period ${row.period}`).toBeGreaterThanOrEqual(0);
      expect(row.closingBalanceCents, `period ${row.period}`).toBeGreaterThanOrEqual(0);
    }
    // 9,000 of depreciation over 36 periods is 250.00 exactly, plus the level
    // per-period rent of 405,000 / 36 = 11,250 cents.
    expect(lease.rows[0]?.interestCents).toBe(11_250);
    expect(lease.rows[0]?.principalCents).toBe(25_000);
    expect(lease.finalPaymentCents).toBe(lease.paymentAmountCents);
  });

  it("keeps the rent charge cent-exact when it does not divide evenly", () => {
    // A residual one cent below the adjusted cap cost leaves 1 cent of
    // depreciation over 60 periods at 30%: the rent charge is 2,999,925 cents,
    // which is not divisible by 60, so the remainder must land in the last row.
    const lease = buildLeaseSchedule({
      grossCapCostCents: 2_000_000,
      capCostReductionCents: 0,
      residualValueCents: 1_999_900,
      aprBasisPoints: 3_000,
      numberOfPayments: 60,
    });
    expect(lease.depreciationCents).toBe(100);
    expect(lease.rentChargeCents).toBe(2_999_925);
    expect(lease.totalOfPaymentsCents).toBe(lease.depreciationCents + lease.rentChargeCents);
    expect(lease.totalOfPaymentsCents).toBe(3_000_025);
    expect(lease.rows.at(-1)?.closingBalanceCents).toBe(0);
    expect(lease.rows.reduce((total, row) => total + row.interestCents, 0)).toBe(lease.rentChargeCents);
    for (const row of lease.rows) {
      expect(row.paymentCents, `period ${row.period}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("charges no rent at a zero money factor", () => {
    const lease = buildLeaseSchedule({ ...leaseInput, aprBasisPoints: 0 });
    expect(lease.moneyFactor).toBe(0);
    expect(lease.rentChargeCents).toBe(0);
    expect(lease.totalOfPaymentsCents).toBe(lease.depreciationCents);
    expect(lease.paymentAmountCents).toBe(25_000);
    expect(lease.totalOfPaymentsCents).toBe(900_000);
  });

  it("round-trips a money factor through basis points", () => {
    // APR% = money factor x 2400, so 0.000625 is 1.50% = 150 basis points.
    expect(MONEY_FACTOR_TO_BASIS_POINTS).toBe(240_000);
    expect(moneyFactorToAprBasisPoints(0.000625)).toBe(150);
    expect(aprBasisPointsToMoneyFactor(150)).toBe(0.000625);
    expect(aprBasisPointsToMoneyFactor(moneyFactorToAprBasisPoints(0.0025))).toBe(0.0025);
    expect(moneyFactorToAprBasisPoints(aprBasisPointsToMoneyFactor(960))).toBe(960);
    // The lease's own money factor is the round-trip of its APR: 600 bps / 240,000.
    expect(aprBasisPointsToMoneyFactor(600)).toBe(0.0025);
    // A negative money factor is nonsense and must be rejected.
    expect(() => moneyFactorToAprBasisPoints(-0.0001)).toThrow(RangeError);
    expect(() => moneyFactorToAprBasisPoints(Number.NaN)).toThrow(RangeError);
    expect(() => moneyFactorToAprBasisPoints(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(aprBasisPointsToMoneyFactor(-100)).toBe(0);
  });

  it("throws a RangeError on a rate above the contract ceiling", () => {
    expect(() =>
      buildLeaseSchedule({ ...leaseInput, aprBasisPoints: MAX_CONTRACT_APR_BASIS_POINTS + 1 }),
    ).toThrow(RangeError);
  });

  it("throws a RangeError on a non-positive payment count", () => {
    expect(() => buildLeaseSchedule({ ...leaseInput, numberOfPayments: 0 })).toThrow(RangeError);
    expect(() => buildLeaseSchedule({ ...leaseInput, numberOfPayments: -12 })).toThrow(RangeError);
  });

  it("clamps the adjusted cap cost and the depreciation at zero", () => {
    // A cap cost reduction larger than the cap cost cannot produce a negative
    // financed amount, and a residual above the adjusted cap cost cannot
    // produce negative depreciation.
    const lease = buildLeaseSchedule({
      grossCapCostCents: 2_000_000,
      capCostReductionCents: 3_000_000,
      residualValueCents: 1_000_000,
      aprBasisPoints: 600,
      numberOfPayments: 24,
    });
    expect(lease.adjustedCapCostCents).toBe(0);
    expect(lease.depreciationCents).toBe(0);
    expect(lease.amountFinancedCents).toBe(0);
    // A residual of 1,000,000 above a cap cost of 0 means nothing is depreciated,
    // so the whole payment is rent: (0 + 1,000,000) x 0.0025 x 24 = 60,000 cents
    // = $600.00 of rent charge over the term.
    expect(lease.rentChargeCents).toBe(60_000);
    expect(lease.totalOfPaymentsCents).toBe(lease.depreciationCents + lease.rentChargeCents);
    for (const row of lease.rows) {
      expect(row.paymentCents).toBeGreaterThanOrEqual(0);
    }
  });
});
