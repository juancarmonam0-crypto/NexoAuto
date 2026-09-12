import { describe, expect, it } from "vitest";
import { computeLevelPaymentCents, numberOfPaymentsFor, periodsPerYear } from "@/lib/finance-engine";
import { type DealPaymentMode, rankDealStructures, structureDeal } from "@/lib/deal-structuring";
import { type Cents, formatCents } from "@/lib/money";
import {
  type PaymentBudgetInput,
  type TargetPaymentInput,
  SOLVER_TERM_CANDIDATES_MONTHS,
  fitPaymentBudget,
  maxPrincipalForPaymentCents,
  solveTargetPayment,
} from "@/lib/payment-solver";

/**
 * PAYMENT SOLVERS — the inverse of the canonical amortisation engine.
 *
 * The solver's whole claim is that it searches the ONE forward engine
 * (`computeLevelPaymentCents`) instead of re-deriving the annuity formula. These
 * tests hold it to that claim in two ways:
 *
 *   1. the boundary proof — the principal it returns really fits the target and
 *      one cent more really does not, checked as a loop over rates, terms and
 *      targets (`maxPrincipalForPaymentCents`);
 *   2. the cross-check — every option it reports is rebuilt through
 *      `structureDeal` and must agree cent-for-cent.
 *
 * Every money assertion is on INTEGER CENTS. Where a value is independently
 * knowable (the 0% exact division, the standard $18,000 / 9% / 12-month payment)
 * the test states the reference arithmetic rather than restating the code.
 */

const PRICE_CENTS: Cents = 2_000_000; // $20,000 selling price
const LANDED_COST_CENTS: Cents = 1_700_000; // $17,000 — visible to the viewer in most fixtures
const DOWN_PAYMENT_CENTS: Cents = 200_000; // $2,000 down
const FINANCED_CENTS: Cents = 1_800_000; // $20,000 - $2,000; no fees and no sales tax in these fixtures
const BPS_900 = 900; // 9.00% APR
const BPS_2400 = 2_400; // 24.00% APR — the buy-here-pay-here reference note
const LEASE_RESIDUAL_CENTS: Cents = 1_200_000; // $12,000 contractual residual

/** The terms the solver searches; asserted against, never re-declared as a literal list. */
const TERMS: readonly number[] = [...SOLVER_TERM_CANDIDATES_MONTHS];

/** Targets a dealer would actually quote: $123.45, $250, $450 and $1,500 a month. */
const TARGETS: readonly Cents[] = [12_345, 25_000, 45_000, 150_000];

/** Positive rates: at 0% the boundary has a separate, documented test below. */
const POSITIVE_APRS = [600, 899, 1_800, 2_400];

function targetInput(overrides: Partial<TargetPaymentInput> = {}): TargetPaymentInput {
  return {
    mode: "EXTERNAL_FINANCE",
    sellingPriceCents: PRICE_CENTS,
    landedCostCents: LANDED_COST_CENTS,
    downPaymentCents: DOWN_PAYMENT_CENTS,
    aprBasisPoints: BPS_900,
    targetPaymentCents: 160_000, // $1,600 — above the shortest candidate term's payment
    ...overrides,
  };
}

function budgetInput(overrides: Partial<PaymentBudgetInput> = {}): PaymentBudgetInput {
  return {
    sellingPriceCents: PRICE_CENTS,
    landedCostCents: LANDED_COST_CENTS,
    downPaymentCents: DOWN_PAYMENT_CENTS,
    lease: { residualValueCents: LEASE_RESIDUAL_CENTS },
    maxPaymentCents: 200_000, // $2,000 a month: everything the fixtures can build fits
    aprBasisPointsByMode: {
      EXTERNAL_FINANCE: BPS_900,
      BUY_HERE_PAY_HERE: BPS_2400,
      LEASE: BPS_900,
      LEASE_TO_OWN: BPS_900,
    },
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* A. maxPrincipalForPaymentCents — the inverse core                           */
/* -------------------------------------------------------------------------- */

describe("payment-solver — maxPrincipalForPaymentCents", () => {
  it("lands exactly on the fitting boundary for every target, positive rate and term", () => {
    // The head-line property, as a loop so a single lucky input cannot hide a
    // bisection that stops one step early or one step late:
    //   * the returned principal FITS the target, and
    //   * it is MAXIMAL: one cent more does not fit.
    for (const aprBasisPoints of POSITIVE_APRS) {
      for (const periods of TERMS) {
        for (const targetPaymentCents of TARGETS) {
          const principal = maxPrincipalForPaymentCents(targetPaymentCents, aprBasisPoints, periods);
          const label = `apr=${aprBasisPoints} n=${periods} target=${targetPaymentCents}`;
          expect(principal, `${label}: principal is never negative`).toBeGreaterThanOrEqual(0);
          expect(
            computeLevelPaymentCents(principal, aprBasisPoints, periods),
            `${label}: the returned principal fits the target`,
          ).toBeLessThanOrEqual(targetPaymentCents);
          expect(
            computeLevelPaymentCents(principal + 1, aprBasisPoints, periods),
            `${label}: one cent more does not fit, so the principal is maximal`,
          ).toBeGreaterThan(targetPaymentCents);
        }
      }
    }
  });

  it("returns the maximal zero-interest principal, which is not simply target x payments", () => {
    // FIXED DURING PHASE 9D. At 0% APR the payment is `round(P / n)`, so the
    // principal is NOT capped at `target x n`: every principal up to
    // `target x n + n/2 - 1` still rounds to the target. The bisection used to
    // seed its upper bound with `target x n`, so it returned a principal that
    // was not maximal — one cent more still paid the target. Both halves of the
    // boundary are asserted here now.
    for (const periods of TERMS) {
      for (const targetPaymentCents of TARGETS) {
        const principal = maxPrincipalForPaymentCents(targetPaymentCents, 0, periods);
        const label = `0 bps n=${periods} target=${targetPaymentCents}`;

        expect(
          computeLevelPaymentCents(principal, 0, periods),
          `${label}: pays at most the target`,
        ).toBeLessThanOrEqual(targetPaymentCents);
        expect(
          computeLevelPaymentCents(principal + 1, 0, periods),
          `${label}: one cent more does not fit`,
        ).toBeGreaterThan(targetPaymentCents);
        // The exact division is always reachable, and the true maximum never
        // exceeds it by more than the rounding headroom.
        expect(principal, `${label}: at least the exact division`).toBeGreaterThanOrEqual(
          targetPaymentCents * periods,
        );
        expect(principal, `${label}: within the rounding headroom`).toBeLessThan(
          targetPaymentCents * periods + periods / 2,
        );
      }
    }
  });

  // FIXED DURING PHASE 9D. `maxPrincipalForPaymentCents` used to seed its
  // bisection with `high = target * periods`, documented as "a valid upper bound
  // because that is the principal at 0% APR". At 0% APR that bound is NOT the
  // maximum: the forward engine rounds the level payment, so every principal up
  // to `target * periods + periods / 2 - 1` still pays the target. It returned
  // 1,200,000 where the true boundary was 1,200,029 (one cent more, 1,200,030,
  // pays 20,001). The bound now includes the rounding headroom, and this test is
  // the one that proves maximality.
  it("is maximal at 0% APR — one cent more must not fit", () => {
    for (const periods of TERMS) {
      for (const targetPaymentCents of TARGETS) {
        const principal = maxPrincipalForPaymentCents(targetPaymentCents, 0, periods);
        expect(
          computeLevelPaymentCents(principal + 1, 0, periods),
          `0 bps n=${periods} target=${targetPaymentCents}: one cent more must exceed the target`,
        ).toBeGreaterThan(targetPaymentCents);
      }
    }
  });

  it("is monotone in the target, in the rate and in the term", () => {
    // A larger target never yields a smaller principal.
    for (const aprBasisPoints of [...POSITIVE_APRS, 0]) {
      for (const periods of TERMS) {
        let previous = -1;
        for (const targetPaymentCents of TARGETS) {
          const principal = maxPrincipalForPaymentCents(targetPaymentCents, aprBasisPoints, periods);
          expect(
            principal,
            `target ${targetPaymentCents} at apr=${aprBasisPoints} n=${periods} must not shrink`,
          ).toBeGreaterThanOrEqual(previous);
          previous = principal;
        }
      }
    }

    // A larger APR never yields a larger principal: the same target buys less
    // principal as the rate rises.
    for (const periods of TERMS) {
      for (const targetPaymentCents of TARGETS) {
        let previous = Number.POSITIVE_INFINITY;
        for (const aprBasisPoints of [0, 600, 899, 1_800, 2_400]) {
          const principal = maxPrincipalForPaymentCents(targetPaymentCents, aprBasisPoints, periods);
          expect(
            principal,
            `apr=${aprBasisPoints} at target ${targetPaymentCents} n=${periods} must not grow`,
          ).toBeLessThanOrEqual(previous);
          previous = principal;
        }
      }
    }

    // A longer term never yields a smaller principal.
    for (const aprBasisPoints of [0, 600, 2_400]) {
      for (const targetPaymentCents of TARGETS) {
        let previous = -1;
        for (const periods of TERMS) {
          const principal = maxPrincipalForPaymentCents(targetPaymentCents, aprBasisPoints, periods);
          expect(
            principal,
            `n=${periods} at target ${targetPaymentCents} apr=${aprBasisPoints} must not shrink`,
          ).toBeGreaterThanOrEqual(previous);
          previous = principal;
        }
      }
    }
  });

  it("returns 0 for a zero target and for a non-positive number of payments", () => {
    // A target of zero can only be met by financing nothing.
    expect(maxPrincipalForPaymentCents(0, BPS_900, 60)).toBe(0);
    // Nothing can be amortised over no periods — including a fractional count
    // that rounds to zero.
    expect(maxPrincipalForPaymentCents(45_000, BPS_900, 0)).toBe(0);
    expect(maxPrincipalForPaymentCents(45_000, BPS_900, -5)).toBe(0);
    expect(maxPrincipalForPaymentCents(45_000, BPS_900, 0.4)).toBe(0);
    // Negative money is coerced to zero by the money primitive, so it can never
    // become a negative principal (that would be a loan the dealer pays).
    expect(maxPrincipalForPaymentCents(-45_000, BPS_900, 60)).toBe(0);
  });

  it("works across every payment frequency, with bi-weekly really meaning 26 periods a year", () => {
    // Bi-weekly is 26 payments a year, NOT 24: a 24-month term is 52 payments,
    // and a 12-month weekly term is also 52.
    expect(periodsPerYear("BIWEEKLY")).toBe(26);
    expect(numberOfPaymentsFor(24, "BIWEEKLY")).toBe(52);
    expect(numberOfPaymentsFor(12, "WEEKLY")).toBe(52);
    expect(periodsPerYear("SEMIMONTHLY")).toBe(24);

    for (const frequency of ["MONTHLY", "SEMIMONTHLY", "BIWEEKLY", "WEEKLY"] as const) {
      for (const termMonths of [24, 60]) {
        const periods = numberOfPaymentsFor(termMonths, frequency);
        for (const targetPaymentCents of [45_000, 150_000]) {
          const label = `${frequency} ${termMonths}mo/${periods} payments target=${targetPaymentCents}`;
          // The boundary property holds per period, not per month.
          const principal = maxPrincipalForPaymentCents(targetPaymentCents, BPS_900, periods, frequency);
          expect(
            computeLevelPaymentCents(principal, BPS_900, periods, frequency),
            `${label}: fits`,
          ).toBeLessThanOrEqual(targetPaymentCents);
          expect(
            computeLevelPaymentCents(principal + 1, BPS_900, periods, frequency),
            `${label}: maximal`,
          ).toBeGreaterThan(targetPaymentCents);
          // At 0% the maximal principal sits in the rounding headroom above the
          // exact division — it is not the exact division itself (fixed in 9D).
          const zeroAprPrincipal = maxPrincipalForPaymentCents(targetPaymentCents, 0, periods, frequency);
          expect(zeroAprPrincipal, `${label}: 0% principal at least the division`).toBeGreaterThanOrEqual(
            targetPaymentCents * periods,
          );
          expect(zeroAprPrincipal, `${label}: 0% principal within headroom`).toBeLessThan(
            targetPaymentCents * periods + periods / 2,
          );
          expect(
            computeLevelPaymentCents(zeroAprPrincipal + 1, 0, periods, frequency),
            `${label}: 0% principal is maximal`,
          ).toBeGreaterThan(targetPaymentCents);
        }
      }
    }
  });

  it("is deterministic: the same arguments always return the same principal", () => {
    for (const targetPaymentCents of TARGETS) {
      for (const aprBasisPoints of [0, 899, 2_400]) {
        for (const frequency of ["MONTHLY", "BIWEEKLY"] as const) {
          const periods = numberOfPaymentsFor(48, frequency);
          expect(
            maxPrincipalForPaymentCents(targetPaymentCents, aprBasisPoints, periods, frequency),
            `target=${targetPaymentCents} apr=${aprBasisPoints} ${frequency}`,
          ).toBe(maxPrincipalForPaymentCents(targetPaymentCents, aprBasisPoints, periods, frequency));
        }
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* B. solveTargetPayment                                                       */
/* -------------------------------------------------------------------------- */

describe("payment-solver — solveTargetPayment", () => {
  it("recommends the shortest candidate term that fits when the target is above the payment", () => {
    // The forward engine's own 12-month payment on $18,000 at 9.00%:
    //   i = 0.09 / 12 = 0.0075, n = 12
    //   18000 x 0.0075 x 1.0075^12 / (1.0075^12 - 1) = 1574.13 -> 157,413 cents.
    // Any standard amortisation table gives $1,574.13/month for this loan.
    expect(computeLevelPaymentCents(FINANCED_CENTS, BPS_900, 12)).toBe(157_413);

    const targetPaymentCents = 160_000; // $1,600 — above the actual payment
    const result = solveTargetPayment(targetInput({ targetPaymentCents }));

    expect(result.mode).toBe("EXTERNAL_FINANCE");
    expect(result.modeLabel).toBe("External finance");
    expect(result.targetPaymentCents).toBe(targetPaymentCents);
    expect(result.downPaymentCents).toBe(DOWN_PAYMENT_CENTS);
    expect(result.paymentFrequency).toBe("MONTHLY");

    // The shortest candidate term is 12 months and it fits, so it must win.
    expect(result.recommended?.termMonths).toBe(12);
    expect(result.recommended?.paymentAmountCents).toBe(157_413);
    expect(result.shortestFeasibleTermMonths).toBe(12);
    expect(result.feasible).toHaveLength(TERMS.length);
    expect(result.headline).toContain("FITS AT 12 MONTHS");

    for (const option of result.options) {
      expect(option.fits, `term ${option.termMonths}: fits flag agrees with the payment`).toBe(
        option.paymentAmountCents > 0 && option.paymentAmountCents <= targetPaymentCents,
      );
      if (option.fits) {
        expect(
          option.paymentAmountCents,
          `term ${option.termMonths}: a fitting option is at or under the target`,
        ).toBeLessThanOrEqual(targetPaymentCents);
      }
    }
    expect(result.feasible.every((option) => option.paymentAmountCents <= targetPaymentCents)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("states no feasible term and names the lowest attainable payment and the down payment needed", () => {
    const targetPaymentCents = 5_000; // $50 a month against a $20,000 car
    const result = solveTargetPayment(targetInput({ targetPaymentCents }));

    expect(result.feasible).toHaveLength(0);
    expect(result.recommended).toBeNull();
    expect(result.shortestFeasibleTermMonths).toBeNull();
    expect(result.headline).toBe("NO FEASIBLE TERM AT THIS DOWN PAYMENT");
    expect(result.options).toHaveLength(TERMS.length);

    // The lowest payment any candidate term reaches is the 84-month one:
    // $289.60 -> "$290" formatted without cents.
    const cheapest = result.options.reduce((best, option) =>
      option.paymentAmountCents < best.paymentAmountCents ? option : best,
    );
    expect(cheapest.termMonths).toBe(84);
    expect(cheapest.paymentAmountCents).toBe(28_960);
    expect(cheapest.gapCents).toBe(23_960); // $289.60 - $50.00

    expect(result.reasons).toHaveLength(2);
    expect(result.reasons[0], "names the lowest attainable payment").toContain(
      formatCents(cheapest.paymentAmountCents),
    );
    expect(result.reasons[0]).toContain("84 months");
    expect(result.reasons[0], "and how far above the target it is").toContain(formatCents(cheapest.gapCents));
    expect(result.reasons[0]).toContain(formatCents(targetPaymentCents));

    // The down payment that WOULD reach the target at that term: the amount due
    // less the most that can be financed at $50/month for 84 months.
    expect(cheapest.requiredDownPaymentCents).toBe(1_689_200);
    expect(result.reasons[1], "names the down payment that would be needed").toContain(
      formatCents(cheapest.requiredDownPaymentCents),
    );
    expect(result.reasons[1]).toContain(formatCents(DOWN_PAYMENT_CENTS));
    expect(result.warnings).toHaveLength(0);
  });

  it("keeps requiredDownPaymentCents honest on both sides of the fit", () => {
    const generous = solveTargetPayment(targetInput({ targetPaymentCents: 160_000 }));
    const impossible = solveTargetPayment(targetInput({ targetPaymentCents: 5_000 }));
    expect(generous.feasible.length).toBeGreaterThan(0);
    expect(impossible.feasible).toHaveLength(0);

    // A term that FITS never asks for more down than the customer already has.
    for (const option of generous.feasible) {
      expect(
        option.requiredDownPaymentCents,
        `term ${option.termMonths}: a fitting term cannot need more down`,
      ).toBeLessThanOrEqual(DOWN_PAYMENT_CENTS);
    }

    // A term that does NOT fit always needs at least the available down payment
    // (and in practice more): the required figure is not a fiction below it.
    for (const option of impossible.options) {
      expect(option.fits, `term ${option.termMonths}: nothing fits a $50 target`).toBe(false);
      expect(
        option.requiredDownPaymentCents,
        `term ${option.termMonths}: a term that does not fit needs at least the available down payment`,
      ).toBeGreaterThanOrEqual(DOWN_PAYMENT_CENTS);
    }
  });

  it("reports gapCents === paymentAmountCents - targetPaymentCents for every option", () => {
    for (const targetPaymentCents of [160_000, 100_000, 5_000]) {
      const result = solveTargetPayment(targetInput({ targetPaymentCents }));
      expect(result.options).toHaveLength(TERMS.length);
      for (const option of result.options) {
        expect(option.gapCents, `term ${option.termMonths} at target ${targetPaymentCents}`).toBe(
          option.paymentAmountCents - targetPaymentCents,
        );
      }
    }
  });

  it("returns candidate terms shortest first, each backed by a real engine structure", () => {
    const result = solveTargetPayment(targetInput({ targetPaymentCents: 100_000 }));

    expect(result.options.map((option) => option.termMonths)).toEqual(TERMS);

    for (const option of result.options) {
      const label = `term ${option.termMonths}`;
      expect(option.structure.mode, `${label}: structure mode`).toBe("EXTERNAL_FINANCE");
      expect(option.structure.feasible, `${label}: structure is feasible`).toBe(true);
      expect(option.structure.termMonths, `${label}: structure term`).toBe(option.termMonths);
      expect(option.structure.paymentAmountCents, `${label}: structure payment`).toBe(option.paymentAmountCents);
      expect(option.structure.numberOfPayments, `${label}: structure payment count`).toBe(option.numberOfPayments);
      expect(option.structure.amounts.amountFinancedCents, `${label}: structure amount financed`).toBe(
        option.amountFinancedCents,
      );
      // Monthly means one payment per month.
      expect(option.numberOfPayments, `${label}: monthly payments`).toBe(option.termMonths);
    }

    expect(result.shortestFeasibleTermMonths).toBe(
      Math.min(...result.feasible.map((option) => option.termMonths)),
    );
  });

  it("solves buy-here-pay-here, lease and lease-to-own, not only external finance", () => {
    // Buy here, pay here at 24%: a 24-month term pays $951.68 and does NOT fit a
    // $900 target, while 30 months pays $803.70 and does — so the recommended
    // term must be 30, not the shortest term.
    expect(computeLevelPaymentCents(FINANCED_CENTS, BPS_2400, 24)).toBe(95_168);
    expect(computeLevelPaymentCents(FINANCED_CENTS, BPS_2400, 30)).toBe(80_370);
    const bhph = solveTargetPayment(
      targetInput({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: BPS_2400, targetPaymentCents: 90_000 }),
    );
    expect(bhph.modeLabel).toBe("Buy here, pay here");
    expect(bhph.recommended?.termMonths).toBe(30);
    expect(bhph.recommended?.paymentAmountCents).toBe(80_370);

    // Lease arithmetic is not loan arithmetic: depreciation over the term plus
    // rent on the average outstanding balance, at a money factor of
    // 900 / 240000 = 0.00375. Over 18 months that is
    // 6000/18 = $333.33 plus (18000 + 12000) x 0.00375 = $112.50 -> $445.83.
    const lease = solveTargetPayment(
      targetInput({
        mode: "LEASE",
        targetPaymentCents: 45_000,
        lease: { residualValueCents: LEASE_RESIDUAL_CENTS },
      }),
    );
    expect(lease.modeLabel).toBe("Lease");
    expect(lease.recommended?.termMonths).toBe(18);
    expect(lease.recommended?.paymentAmountCents).toBe(44_583);

    // Lease to own uses the same calculation path.
    const leaseToOwn = solveTargetPayment(
      targetInput({
        mode: "LEASE_TO_OWN",
        targetPaymentCents: 45_000,
        lease: { residualValueCents: LEASE_RESIDUAL_CENTS },
      }),
    );
    expect(leaseToOwn.modeLabel).toBe("Lease to own");
    expect(leaseToOwn.recommended?.termMonths).toBe(18);
    expect(leaseToOwn.recommended?.paymentAmountCents).toBe(44_583);
  });

  it("reports a lease option's amount financed as the lease depreciation", () => {
    const lease = solveTargetPayment(
      targetInput({
        mode: "LEASE",
        targetPaymentCents: 45_000,
        lease: { residualValueCents: LEASE_RESIDUAL_CENTS },
      }),
    );
    expect(lease.options).toHaveLength(TERMS.length);
    for (const option of lease.options) {
      const label = `term ${option.termMonths}`;
      // The customer funds the value consumed, not the whole vehicle:
      // adjusted cap cost ($18,000) - residual ($12,000) = $6,000, whatever the
      // term. A loan-equivalent "amount financed" of $18,000 would be wrong.
      expect(option.amountFinancedCents, `${label}: depreciation`).toBe(600_000);
      expect(option.structure.lease?.depreciationCents, `${label}: engine depreciation`).toBe(600_000);
      expect(option.structure.amounts.amountFinancedCents, `${label}: structure agrees`).toBe(
        option.amountFinancedCents,
      );
    }
  });

  // BUG (found while writing this suite; the frozen source was NOT modified):
  // `solveTargetPayment` derives `maxAmountFinancedCents` and
  // `requiredDownPaymentCents` from `maxPrincipalForPaymentCents`, which is LOAN
  // amortisation. A lease payment is not a loan payment, so for the lease modes
  // those two figures describe a loan that was never written, and they can
  // contradict the option's own `fits` flag.
  //   exact expression:
  //     solveTargetPayment({ mode: "LEASE", sellingPriceCents: 2_000_000,
  //       landedCostCents: 1_700_000, downPaymentCents: 200_000,
  //       aprBasisPoints: 900, targetPaymentCents: 61_250,
  //       lease: { residualValueCents: 1_200_000 } })
  //       .options.find((o) => o.termMonths === 12)!.requiredDownPaymentCents
  //   expected: <= 200_000 (the option FITS at $612.50, the target, so it cannot
  //             need more down payment than the $2,000 the customer already has;
  //             lease arithmetic needs exactly $2,000 there)
  //   actual:   1_299_606
  // The same contradiction appears at 18/24/30/36 months ($972,267 / $659,279 /
  // $360,013 / $73,868). At 42+ months the loan-equivalent principal happens to
  // exceed the amount due, so `requiredDownPaymentCents` clamps to 0 and the
  // contradiction is hidden by arithmetic luck rather than by lease maths.
  // FIXED DURING PHASE 9D. `solveTargetPayment` used to derive
  // `maxAmountFinancedCents` and `requiredDownPaymentCents` from
  // `maxPrincipalForPaymentCents`, which is LOAN amortisation. A lease payment is
  // not a loan payment: on a lease the rent charge sits on `adjusted cap cost +
  // residual`, so money down cuts BOTH the depreciation and the rent. The loan
  // inversion therefore demanded $12,996 down for a 12-month term that FIT with
  // the customer's existing $2,000 (and $9,722 / $6,592 / $3,600 / $738 at
  // 18/24/30/36 months). The solver now bisects the cap cost reduction through
  // the canonical lease engine instead, so the figure is one the engine itself
  // confirmed.
  it("a fitting LEASE option must not require more down than the customer has", () => {
    const lease = solveTargetPayment(
      targetInput({
        mode: "LEASE",
        targetPaymentCents: 61_250, // the actual 12-month lease payment at $2,000 down
        lease: { residualValueCents: LEASE_RESIDUAL_CENTS },
      }),
    );

    const twelveMonth = lease.options.find((option) => option.termMonths === 12);
    expect(twelveMonth, "the 12-month option exists").toBeDefined();
    expect(twelveMonth!.fits, "the 12-month option fits the target").toBe(true);
    expect(
      twelveMonth!.requiredDownPaymentCents,
      `term 12: ${formatCents(twelveMonth!.requiredDownPaymentCents)} down cannot be required of a term that fits`,
    ).toBeLessThanOrEqual(DOWN_PAYMENT_CENTS);

    // The requirement is the MINIMUM down payment at which this term reaches the
    // target, verified by the canonical lease engine on both sides. It can land a
    // few cents below what the customer happens to have, because the engine
    // rounds the payment to the cent: a small plateau of cap cost reductions
    // produces the same rounded payment. What matters is that it never exceeds
    // the cash the customer brought.
    expect(twelveMonth!.requiredDownPaymentCents).toBeLessThanOrEqual(DOWN_PAYMENT_CENTS);

    const atRequirement = structureForLeaseRequirementCheck(twelveMonth!.requiredDownPaymentCents);
    expect(atRequirement.paymentAmountCents, "the requirement reaches the target").toBeLessThanOrEqual(61_250);
    const oneCentLess = structureForLeaseRequirementCheck(twelveMonth!.requiredDownPaymentCents - 1);
    expect(oneCentLess.paymentAmountCents, "one cent less down would miss the target").toBeGreaterThan(61_250);

    for (const option of lease.feasible) {
      expect(
        option.requiredDownPaymentCents,
        `term ${option.termMonths}: a fitting option cannot need more than ${formatCents(DOWN_PAYMENT_CENTS)} down`,
      ).toBeLessThanOrEqual(DOWN_PAYMENT_CENTS);
    }
  });

  /** The canonical engine's own answer at a given cap cost reduction. */
  function structureForLeaseRequirementCheck(downPaymentCents: number) {
    return structureDeal({
      mode: "LEASE",
      sellingPriceCents: PRICE_CENTS,
      landedCostCents: LANDED_COST_CENTS,
      downPaymentCents,
      aprBasisPoints: BPS_900,
      termMonths: 12,
      paymentFrequency: "MONTHLY",
      lease: { residualValueCents: LEASE_RESIDUAL_CENTS },
    });
  }

  it("solves lease-to-own even though contract generation is blocked", () => {
    const leaseToOwn = solveTargetPayment(
      targetInput({
        mode: "LEASE_TO_OWN",
        targetPaymentCents: 45_000,
        lease: { residualValueCents: LEASE_RESIDUAL_CENTS },
      }),
    );
    const recommended = leaseToOwn.recommended;
    expect(recommended).not.toBeNull();
    expect(recommended!.structure.feasible).toBe(true);
    expect(recommended!.structure.contractGeneration).toBe("BLOCKED");
    expect(recommended!.structure.contractBlockedReason).toContain("Lease-to-own");
    expect(recommended!.structure.riskFlags).toContain("LEASE_TO_OWN_CONTRACT_BLOCKED");
    // Blocked contract generation does not block the arithmetic.
    expect(recommended!.paymentAmountCents).toBeGreaterThan(0);
    expect(recommended!.numberOfPayments).toBe(18);
  });

  it("fabricates no gross and no score for a viewer who cannot see the cost basis", () => {
    const masked = solveTargetPayment(targetInput({ landedCostCents: null }));
    expect(masked.options).toHaveLength(TERMS.length);
    for (const option of masked.options) {
      const label = `term ${option.termMonths}`;
      // Null is not zero: a "gross" computed against a cost of 0 would be the
      // whole selling price, which is a fabricated number, not a disclosure.
      expect(option.vehicleGrossCents, `${label}: no vehicle gross`).toBeNull();
      expect(option.vehicleGrossCents, `${label}: the price is not passed off as gross`).not.toBe(PRICE_CENTS);
      expect(option.structure.vehicleGrossCents, `${label}: structure gross`).toBeNull();
      expect(option.structure.combinedExpectedEconomicsCents, `${label}: no combined economics`).toBeNull();
      expect(option.structure.score, `${label}: no score without a cost basis`).toBeNull();
      // The customer's own terms are still fully costed.
      expect(option.amountFinancedCents, `${label}: amount financed is real`).toBe(FINANCED_CENTS);
      expect(option.paymentAmountCents, `${label}: payment is real`).toBeGreaterThan(0);
    }
  });

  it("warns, and does not throw, when a mode cannot be built", () => {
    // A lease with no residual value cannot be scheduled at all.
    const noResidual = solveTargetPayment(
      targetInput({ mode: "LEASE", targetPaymentCents: 45_000, lease: null }),
    );
    expect(noResidual.options).toHaveLength(0);
    expect(noResidual.feasible).toHaveLength(0);
    expect(noResidual.recommended).toBeNull();
    expect(noResidual.headline).toBe("NO STRUCTURE COULD BE BUILT");
    expect(noResidual.warnings).toHaveLength(TERMS.length);
    expect(noResidual.warnings[0]).toBe("12 months: A lease needs a contractual residual value.");
    expect(noResidual.warnings.at(-1)).toBe("84 months: A lease needs a contractual residual value.");
    expect(noResidual.reasons[0]).toContain("No candidate term produced a structure");
  });

  it("is deterministic: the same call twice gives the same headline, options and payments", () => {
    const first = solveTargetPayment(targetInput({ targetPaymentCents: 100_000 }));
    const second = solveTargetPayment(targetInput({ targetPaymentCents: 100_000 }));
    expect(second.headline).toBe(first.headline);
    expect(second.options).toHaveLength(first.options.length);
    expect(second.options.map((option) => option.paymentAmountCents)).toEqual(
      first.options.map((option) => option.paymentAmountCents),
    );
    expect(second.shortestFeasibleTermMonths).toBe(first.shortestFeasibleTermMonths);
    expect(second.recommended?.termMonths).toBe(first.recommended?.termMonths);
  });
});

/* -------------------------------------------------------------------------- */
/* C. fitPaymentBudget                                                         */
/* -------------------------------------------------------------------------- */

describe("payment-solver — fitPaymentBudget", () => {
  it("keeps only in-budget options in options and every built option in allOptions", () => {
    const result = fitPaymentBudget(budgetInput());

    expect(result.options.length).toBeGreaterThan(0);
    // Nothing inside the budget may be dropped: a dealer comparing options must
    // see both the shortlist and the complete build list.
    expect(result.allOptions.length).toBeGreaterThanOrEqual(result.options.length);
    expect(result.allOptions).toHaveLength(4 * TERMS.length); // 4 modes x 10 terms
    expect(result.options).toHaveLength(40);
    expect(result.headline.startsWith("FITS:")).toBe(true);

    for (const option of result.options) {
      const label = `${option.mode}/${option.termMonths}`;
      expect(option.withinBudget, `${label}: within budget`).toBe(true);
      expect(option.paymentAmountCents, `${label}: payment is positive`).toBeGreaterThan(0);
      expect(option.paymentAmountCents, `${label}: payment is inside the budget`).toBeLessThanOrEqual(
        result.maxPaymentCents,
      );
      expect(option.modeLabel, `${label}: label`).toBeTruthy();
    }

    expect(result.recommended).not.toBeNull();
    expect(result.options).toContain(result.recommended);
  });

  it("headlines a fit with FITS: and reports NO FEASIBLE STRUCTURE when nothing fits", () => {
    const fits = fitPaymentBudget(budgetInput({ maxPaymentCents: 200_000 }));
    expect(fits.headline).toMatch(/^FITS: /);

    // $1 a month against a $20,000 car: no structure can be inside that budget.
    const nothing = fitPaymentBudget(budgetInput({ maxPaymentCents: 100 }));
    expect(nothing.options).toHaveLength(0);
    expect(nothing.recommended).toBeNull();
    expect(nothing.shortestFeasibleTermMonths).toBeNull();
    expect(nothing.headline).toBe("NO FEASIBLE STRUCTURE");
    // Structures were still built — the budget is what failed, not the build.
    expect(nothing.allOptions.length).toBeGreaterThan(0);
  });

  it("names the closest option and its distance above the budget when nothing fits", () => {
    const result = fitPaymentBudget(budgetInput({ maxPaymentCents: 100 }));
    const cheapest = result.allOptions.reduce((best, option) =>
      option.paymentAmountCents < best.paymentAmountCents ? option : best,
    );

    // The cheapest structure is the 84-month lease: depreciation $6,000 over 84
    // months ($71.43) plus rent on the average balance ($112.50) = $183.93.
    expect(cheapest.mode).toBe("LEASE");
    expect(cheapest.termMonths).toBe(84);
    expect(cheapest.paymentAmountCents).toBe(18_393);

    const closest = result.reasons.find((reason) => reason.includes("closest option"));
    expect(closest, "the no-fit reasons name the closest option").toBeDefined();
    expect(closest).toContain("Lease");
    expect(closest).toContain("84 months");
    expect(closest).toContain(formatCents(18_393)); // "$184" a month
    expect(closest, "and how far above the budget it sits").toContain(formatCents(18_393 - 100)); // "$183"
    expect(closest).toContain("above the budget");
    expect(result.reasons[0]).toContain("Nothing fits");
  });

  it("reports the shortest feasible term across the in-budget options", () => {
    const result = fitPaymentBudget(budgetInput());
    expect(result.shortestFeasibleTermMonths).toBe(
      Math.min(...result.options.map((option) => option.termMonths)),
    );
    expect(result.shortestFeasibleTermMonths).toBe(12);
  });

  it("lists a requested mode with no rate as unavailable and builds no options for it", () => {
    const result = fitPaymentBudget(
      budgetInput({
        modes: ["EXTERNAL_FINANCE", "LEASE"],
        aprBasisPointsByMode: { EXTERNAL_FINANCE: BPS_900 },
      }),
    );

    expect(result.unavailable).toHaveLength(1);
    expect(result.unavailable[0]!.mode).toBe("LEASE");
    expect(result.unavailable[0]!.reason).toContain("No rate was supplied for Lease");

    expect(result.options.length).toBeGreaterThan(0);
    for (const option of [...result.options, ...result.allOptions]) {
      expect(option.mode, "a mode without a rate quote cannot appear").toBe("EXTERNAL_FINANCE");
    }
  });

  it("honours a mode restriction: only the requested mode is built", () => {
    const result = fitPaymentBudget(
      budgetInput({
        modes: ["BUY_HERE_PAY_HERE"],
        aprBasisPointsByMode: { BUY_HERE_PAY_HERE: BPS_2400 },
      }),
    );

    expect(result.options.length).toBeGreaterThan(0);
    expect(result.allOptions).toHaveLength(TERMS.length);
    for (const option of [...result.options, ...result.allOptions]) {
      expect(option.mode).toBe("BUY_HERE_PAY_HERE");
    }
    expect(result.unavailable).toHaveLength(0);
    expect(result.headline).toContain("BUY HERE, PAY HERE");
  });

  it("can only add options when the budget rises", () => {
    // $300, $450 and $2,000 a month on one mode: 84 months only; then 84/72/60;
    // then every candidate term.
    const budgets = [30_000, 45_000, 200_000];
    const results = budgets.map((maxPaymentCents) =>
      fitPaymentBudget(
        budgetInput({
          modes: ["EXTERNAL_FINANCE"],
          aprBasisPointsByMode: { EXTERNAL_FINANCE: BPS_900 },
          maxPaymentCents,
        }),
      ),
    );

    expect(results.map((result) => result.options.length)).toEqual([1, 4, 10]);

    for (let index = 1; index < results.length; index += 1) {
      const smaller = new Set(results[index - 1]!.options.map((option) => `${option.mode}:${option.termMonths}`));
      const larger = new Set(results[index]!.options.map((option) => `${option.mode}:${option.termMonths}`));
      expect(larger.size, `budget ${budgets[index]}: count is non-decreasing`).toBeGreaterThanOrEqual(
        smaller.size,
      );
      // Membership only grows: nothing affordable becomes unaffordable.
      for (const key of smaller) {
        expect(larger.has(key), `${key} must still fit a budget of ${budgets[index]}`).toBe(true);
      }
    }
  });

  it("puts the same structure first that rankDealStructures ranks first", () => {
    const result = fitPaymentBudget(budgetInput());
    const fitting = result.options.map((option) => option.structure);
    const ranked = rankDealStructures(fitting);

    expect(result.recommended).not.toBeNull();
    // The Deal Desk and the budget fitter share one comparison: with the cost
    // basis visible they cannot disagree about the winner.
    expect(ranked[0]).toBe(result.recommended!.structure);
    expect(ranked).toHaveLength(fitting.length); // every in-budget structure is rankable here
    for (const structure of ranked.slice(1)) {
      expect(structure.score!.total).toBeLessThanOrEqual(result.recommended!.structure.score!.total);
    }
    expect(result.recommended!.structure.score).not.toBeNull();
  });

  it("orders masked options by payment then term and says so instead of inventing a ranking", () => {
    const result = fitPaymentBudget(budgetInput({ landedCostCents: null }));

    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      expect(option.structure.score, `${option.mode}/${option.termMonths}: no score`).toBeNull();
      expect(option.vehicleGrossCents, `${option.mode}/${option.termMonths}: no gross`).toBeNull();
    }

    for (let index = 1; index < result.options.length; index += 1) {
      const previous = result.options[index - 1]!;
      const current = result.options[index]!;
      expect(
        current.paymentAmountCents,
        `option ${index} (${current.mode}/${current.termMonths}) is ordered by payment`,
      ).toBeGreaterThanOrEqual(previous.paymentAmountCents);
      if (current.paymentAmountCents === previous.paymentAmountCents) {
        expect(
          current.termMonths,
          `option ${index} breaks a payment tie on the shorter term`,
        ).toBeGreaterThanOrEqual(previous.termMonths);
      }
    }

    expect(result.reasons.some((reason) => reason.includes("ordered by payment and term"))).toBe(true);
    // With no ranking available the first option is the recommendation, and the
    // headline still reports a fit rather than a ranking.
    expect(result.recommended).toBe(result.options[0]);
    expect(result.headline.startsWith("FITS:")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* D. Cross-checks against the canonical engine                                */
/* -------------------------------------------------------------------------- */

describe("payment-solver — cross-checks against the canonical engine", () => {
  const combinations: { label: string; input: TargetPaymentInput }[] = [
    {
      label: "external finance at a $1,600 target",
      input: targetInput({ targetPaymentCents: 160_000 }),
    },
    {
      label: "buy here, pay here at a $900 target",
      input: targetInput({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: BPS_2400, targetPaymentCents: 90_000 }),
    },
    {
      label: "lease at a $450 target",
      input: targetInput({
        mode: "LEASE",
        targetPaymentCents: 45_000,
        lease: { residualValueCents: LEASE_RESIDUAL_CENTS },
      }),
    },
  ];

  it("reproduces structureDeal cent-for-cent for the recommended option", () => {
    for (const { label, input } of combinations) {
      const result = solveTargetPayment(input);
      const recommended = result.recommended;
      expect(recommended, `${label}: a recommendation exists`).not.toBeNull();

      // Rebuild the SAME structure straight through the canonical engine: the
      // solver must not disagree with it by a single cent.
      const rebuilt = structureDeal({
        mode: input.mode as DealPaymentMode,
        sellingPriceCents: input.sellingPriceCents,
        landedCostCents: input.landedCostCents,
        downPaymentCents: input.downPaymentCents,
        aprBasisPoints: input.aprBasisPoints,
        termMonths: recommended!.termMonths,
        paymentFrequency: input.paymentFrequency,
        lease: input.lease ?? null,
      });

      expect(rebuilt.feasible, `${label}: the rebuild is feasible`).toBe(true);
      expect(rebuilt.paymentAmountCents, `${label}: payment`).toBe(recommended!.paymentAmountCents);
      expect(rebuilt.amounts.amountFinancedCents, `${label}: amount financed`).toBe(
        recommended!.amountFinancedCents,
      );
      expect(rebuilt.financeChargeCents, `${label}: finance charge`).toBe(recommended!.financeChargeCents);
      expect(rebuilt.totalOfPaymentsCents, `${label}: total of payments`).toBe(
        recommended!.totalCustomerOutlayCents - input.downPaymentCents,
      );
      expect(rebuilt.numberOfPayments, `${label}: payment count`).toBe(recommended!.numberOfPayments);
    }
  });

  it("never returns a negative payment or amount financed, and only candidate terms", () => {
    const solverResults = [
      solveTargetPayment(targetInput({ targetPaymentCents: 160_000 })),
      solveTargetPayment(targetInput({ targetPaymentCents: 5_000 })),
      solveTargetPayment(
        targetInput({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: BPS_2400, targetPaymentCents: 90_000 }),
      ),
      solveTargetPayment(
        targetInput({
          mode: "LEASE",
          targetPaymentCents: 45_000,
          lease: { residualValueCents: LEASE_RESIDUAL_CENTS },
        }),
      ),
      solveTargetPayment(
        targetInput({
          mode: "LEASE_TO_OWN",
          targetPaymentCents: 45_000,
          lease: { residualValueCents: LEASE_RESIDUAL_CENTS },
        }),
      ),
    ];
    const budget = fitPaymentBudget(budgetInput());
    const solverOptions = solverResults.flatMap((result) => result.options);
    const budgetOptions = [...budget.options, ...budget.allOptions];
    expect(solverOptions.length).toBeGreaterThan(0);
    expect(budgetOptions.length).toBeGreaterThan(0);

    const checkMoney = (
      label: string,
      option: {
        termMonths: number;
        paymentAmountCents: Cents;
        amountFinancedCents: Cents;
        financeChargeCents: Cents;
        totalCustomerOutlayCents: Cents;
      },
    ): void => {
      expect(option.paymentAmountCents, `${label}: payment is not negative`).toBeGreaterThanOrEqual(0);
      expect(option.amountFinancedCents, `${label}: amount financed is not negative`).toBeGreaterThanOrEqual(0);
      expect(option.financeChargeCents, `${label}: finance charge is not negative`).toBeGreaterThanOrEqual(0);
      expect(option.totalCustomerOutlayCents, `${label}: outlay is not negative`).toBeGreaterThanOrEqual(0);
      expect(
        (TERMS as readonly number[]).includes(option.termMonths),
        `${label}: the term is one of the candidate terms`,
      ).toBe(true);
    };

    for (const option of solverOptions) checkMoney(`solveTargetPayment term ${option.termMonths}`, option);
    for (const option of budgetOptions) checkMoney(`${option.mode}/${option.termMonths}`, option);
  });
});
