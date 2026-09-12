/**
 * The amortisation engine — one canonical implementation of retail instalment
 * math for the whole product.
 *
 * RULES THIS FILE OBEYS
 *
 * 1. EVERY STORED MONEY VALUE IS AN INTEGER NUMBER OF CENTS. The compounding
 *    factor `(1+i)^n` is necessarily a floating-point intermediate (no integer
 *    type can express it), but it is IMMEDIATELY rounded to whole cents and
 *    never leaves this module as a monetary value. `Math.round` is the only
 *    rounding rule in the file, so the result is identical on every platform.
 *
 * 2. THE SCHEDULE CLOSES TO ZERO. Rather than multiplying a rounded payment by
 *    the term and calling the few stray cents "interest", the engine walks the
 *    schedule: each period accrues interest on the OUTSTANDING balance, the
 *    level payment is applied, and the FINAL payment is whatever clears the
 *    balance exactly. `financeChargeCents` is then, by construction,
 *    `totalOfPaymentsCents - amountFinancedCents` — the invariant the database
 *    constraint `deals_payments_arithmetic` also enforces.
 *
 * 3. THE ENGINE NEVER CLAMPS A RATE OR A TERM. Silently capping a contract rate
 *    would misrepresent a deal. Bad input raises a RangeError; unusual but
 *    legal input (a 24% BHPH note) is computed and flagged by the caller.
 *    `src/lib/finance.ts` keeps the clamping because it is a *public payment
 *    estimator*, not a contract.
 *
 * 4. NO SERVICING. This module schedules payments; it does not collect them,
 *    report them, or decide credit. There is no ACH, no autopay, no ledger.
 */

import { type BasisPoints, type Cents, assertCents, toCents } from "./money";

export const PAYMENT_FREQUENCIES = ["MONTHLY", "SEMIMONTHLY", "BIWEEKLY", "WEEKLY"] as const;

export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

/** Payments per year for each frequency. Bi-weekly is 26, not 24. */
export const PERIODS_PER_YEAR: Record<PaymentFrequency, number> = {
  MONTHLY: 12,
  SEMIMONTHLY: 24,
  BIWEEKLY: 26,
  WEEKLY: 52,
};

export const PAYMENT_FREQUENCY_LABELS: Record<PaymentFrequency, string> = {
  MONTHLY: "Monthly",
  SEMIMONTHLY: "Semi-monthly",
  BIWEEKLY: "Bi-weekly",
  WEEKLY: "Weekly",
};

/** Sanity bound on the schedule length, to make a runaway loop impossible. */
export const MAX_NUMBER_OF_PAYMENTS = 1_200;
/** Sanity bound on a contract rate (100%). Above this the input is a typo. */
export const MAX_CONTRACT_APR_BASIS_POINTS = 10_000;

export function periodsPerYear(frequency: PaymentFrequency): number {
  return PERIODS_PER_YEAR[frequency];
}

/**
 * How many payments a term in months produces at a frequency.
 *   60 months monthly   -> 60
 *   24 months bi-weekly -> 52
 *   12 months weekly    -> 52
 */
export function numberOfPaymentsFor(termMonths: number, frequency: PaymentFrequency): number {
  if (!Number.isFinite(termMonths) || termMonths <= 0) {
    throw new RangeError(`termMonths must be a positive number, received ${String(termMonths)}`);
  }
  const payments = Math.round((termMonths * periodsPerYear(frequency)) / 12);
  if (payments < 1) {
    throw new RangeError(
      `A ${termMonths}-month term at ${frequency} produces no payment periods; use a longer term.`,
    );
  }
  if (payments > MAX_NUMBER_OF_PAYMENTS) {
    throw new RangeError(
      `A ${termMonths}-month term at ${frequency} produces ${payments} payments, above the ${MAX_NUMBER_OF_PAYMENTS} sanity limit.`,
    );
  }
  return payments;
}

/** The periodic rate as a fraction (0.06 APR monthly -> 0.005). */
export function periodicRate(aprBasisPoints: BasisPoints, frequency: PaymentFrequency): number {
  const apr = Math.max(0, Math.round(aprBasisPoints)) / 10_000;
  return apr / periodsPerYear(frequency);
}

/**
 * The level payment that fully amortises `principalCents` over `periods`:
 *
 *   payment = P * i * (1+i)^n / ((1+i)^n - 1)
 *
 * At i = 0 this degenerates safely to P / n. The result is rounded to whole
 * cents; the final scheduled payment absorbs the rounding (see the schedule).
 */
export function computeLevelPaymentCents(
  principalCents: Cents,
  aprBasisPoints: BasisPoints,
  periods: number,
  frequency: PaymentFrequency = "MONTHLY",
): Cents {
  const principal = toCents(principalCents);
  if (principal === 0) return 0;

  // Rule 3 applies here too: this is the function that builds the payment, so
  // it enforces the same rate ceiling as the schedule builder rather than
  // silently computing a payment at an impossible rate.
  const apr = Math.round(aprBasisPoints);
  if (!Number.isFinite(apr) || apr < 0) {
    throw new RangeError(`aprBasisPoints must be a non-negative number, received ${String(aprBasisPoints)}`);
  }
  if (apr > MAX_CONTRACT_APR_BASIS_POINTS) {
    throw new RangeError(
      `aprBasisPoints above ${MAX_CONTRACT_APR_BASIS_POINTS} (${MAX_CONTRACT_APR_BASIS_POINTS / 100}%) is not a contract rate; received ${apr}`,
    );
  }

  const n = Math.round(periods);
  if (!Number.isFinite(n) || n < 1) {
    throw new RangeError(`periods must be at least 1, received ${String(periods)}`);
  }
  if (n > MAX_NUMBER_OF_PAYMENTS) {
    throw new RangeError(`periods must be at most ${MAX_NUMBER_OF_PAYMENTS}, received ${n}`);
  }

  const i = periodicRate(apr, frequency);
  if (i === 0) return Math.round(principal / n);

  const growth = (1 + i) ** n;
  const payment = (principal * i * growth) / (growth - 1);
  return Math.round(payment);
}

/**
 * The honest bound on how far the FINAL payment can sit from the level payment.
 *
 * WHY IT IS NOT A SIMPLE COUNT. Interest is rounded to the cent every period,
 * and each period's rounding error feeds back into the balance, which changes
 * the NEXT period's interest, and so on to the end of the schedule. The last
 * payment absorbs that amplified residue. So the drift grows with the rate, not
 * just with the number of payments: a 48-month note at 24% drifts 27 cents
 * (more than 48/2), and an 84-month note at 24% drifts 97 cents.
 *
 * The bound below follows the propagation: a half-cent error introduced in
 * period k is carried for the remaining `n - k` periods, compounding at `i`, so
 * the total effect is at most `0.5 * sum((1+i)^k for k in 0..n-1)`.
 *
 * At 0% APR there is no compounding and the bound is half a cent per payment.
 *
 * This does not weaken the contract: the schedule still closes to exactly zero
 * and `totalOfPaymentsCents === amountFinancedCents + financeChargeCents` still
 * holds cent-exact. The bound exists so a caller sizing a reserve knows the
 * real worst case instead of a comfortable fiction.
 */
export function finalPaymentDriftBoundCents(
  numberOfPayments: number,
  aprBasisPoints: BasisPoints = 0,
  frequency: PaymentFrequency = "MONTHLY",
): Cents {
  const n = Math.max(0, Math.round(numberOfPayments));
  if (!Number.isFinite(n) || n === 0) return 0;

  const i = periodicRate(aprBasisPoints, frequency);
  if (i === 0) return Math.ceil(n / 2);

  const growth = (1 + i) ** n;
  return Math.ceil((0.5 * (growth - 1)) / i);
}

export interface AmortizationRow {
  /** 1-based payment number. */
  period: number;
  openingBalanceCents: Cents;
  paymentCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  closingBalanceCents: Cents;
}

export interface AmortizationResult {
  amountFinancedCents: Cents;
  aprBasisPoints: BasisPoints;
  paymentFrequency: PaymentFrequency;
  numberOfPayments: number;
  /** The regular scheduled payment (all but the last, when they differ). */
  paymentAmountCents: Cents;
  /**
   * The last scheduled payment, which clears the balance exactly. It absorbs
   * BOTH the level payment's own rounding and every period's rounded interest,
   * so its distance from the level payment is bounded by
   * `finalPaymentDriftBoundCents()` — not by half the number of payments.
   */
  finalPaymentCents: Cents;
  /** Sum of every scheduled payment, cent-exact. */
  totalOfPaymentsCents: Cents;
  /** totalOfPayments - amountFinanced. Never negative. */
  financeChargeCents: Cents;
  rows: AmortizationRow[];
  /** True when the final payment is materially larger than the level payment. */
  balloonFinalPayment: boolean;
  /**
   * True when the level payment does not even cover the first period's
   * interest, so the balance never amortises and the final payment becomes a
   * balloon. A real risk on long-term, high-rate notes.
   */
  negativeAmortization: boolean;
}

/**
 * Walks the schedule period by period.
 *
 * Interest each period is `round(openingBalance * i)` — the standard retail
 * instalment practice of rounding the periodic interest to the cent — and the
 * final payment is `openingBalance + interest`, so the closing balance is
 * exactly 0 and the total of payments is exact.
 */
export function buildAmortizationSchedule(input: {
  amountFinancedCents: Cents;
  aprBasisPoints: BasisPoints;
  numberOfPayments: number;
  paymentFrequency?: PaymentFrequency;
}): AmortizationResult {
  const amountFinancedCents = assertCents(input.amountFinancedCents, "amountFinancedCents");
  const aprBasisPoints = Math.max(0, Math.round(input.aprBasisPoints));
  if (aprBasisPoints > MAX_CONTRACT_APR_BASIS_POINTS) {
    throw new RangeError(
      `aprBasisPoints above ${MAX_CONTRACT_APR_BASIS_POINTS} (${MAX_CONTRACT_APR_BASIS_POINTS / 100}%) is not a contract rate; received ${aprBasisPoints}`,
    );
  }

  const paymentFrequency = input.paymentFrequency ?? "MONTHLY";
  const n = Math.round(input.numberOfPayments);
  if (!Number.isFinite(n) || n < 1) {
    throw new RangeError(`numberOfPayments must be at least 1, received ${String(input.numberOfPayments)}`);
  }
  if (n > MAX_NUMBER_OF_PAYMENTS) {
    throw new RangeError(`numberOfPayments must be at most ${MAX_NUMBER_OF_PAYMENTS}, received ${n}`);
  }

  // No principal to finance: there is no schedule and no finance charge.
  if (amountFinancedCents === 0) {
    return {
      amountFinancedCents: 0,
      aprBasisPoints,
      paymentFrequency,
      numberOfPayments: 0,
      paymentAmountCents: 0,
      finalPaymentCents: 0,
      totalOfPaymentsCents: 0,
      financeChargeCents: 0,
      rows: [],
      balloonFinalPayment: false,
      negativeAmortization: false,
    };
  }

  const i = periodicRate(aprBasisPoints, paymentFrequency);
  const levelPaymentCents = computeLevelPaymentCents(amountFinancedCents, aprBasisPoints, n, paymentFrequency);

  const rows: AmortizationRow[] = [];
  let balance = amountFinancedCents;
  let totalOfPaymentsCents = 0;
  let negativeAmortization = false;

  for (let period = 1; period <= n; period += 1) {
    const openingBalanceCents = balance;
    const interestCents = Math.round(openingBalanceCents * i);

    const isFinal = period === n;
    // A non-final payment never overpays the outstanding balance: rounding the
    // level payment UP can make the balance reach zero a period early, and
    // without this clamp the final payment would come out negative.
    const paymentCents = isFinal
      ? openingBalanceCents + interestCents
      : Math.min(levelPaymentCents, openingBalanceCents + interestCents);

    if (!isFinal && paymentCents < interestCents) {
      // The payment does not cover the interest: the balance grows. The math is
      // still computed honestly; the caller flags it.
      negativeAmortization = true;
    }

    const principalCents = paymentCents - interestCents;
    const closingBalanceCents = openingBalanceCents + interestCents - paymentCents;

    rows.push({
      period,
      openingBalanceCents,
      paymentCents,
      interestCents,
      principalCents,
      closingBalanceCents,
    });

    totalOfPaymentsCents += paymentCents;
    balance = closingBalanceCents;
  }

  const finalPaymentCents = rows.length > 0 ? rows[rows.length - 1]!.paymentCents : 0;
  const totalInterestCents = rows.reduce((total, row) => total + row.interestCents, 0);

  return {
    amountFinancedCents,
    aprBasisPoints,
    paymentFrequency,
    numberOfPayments: n,
    paymentAmountCents: levelPaymentCents,
    finalPaymentCents,
    totalOfPaymentsCents,
    // By construction this equals totalOfPayments - amountFinanced; summing the
    // rows keeps it true even if a future change altered the schedule shape.
    financeChargeCents: Math.max(0, totalInterestCents),
    rows,
    balloonFinalPayment: finalPaymentCents > levelPaymentCents * 2,
    negativeAmortization,
  };
}

export interface ContractAmounts {
  sellingPriceCents: Cents;
  dealerFeesCents: Cents;
  taxableAmountCents: Cents;
  salesTaxCents: Cents;
  tradeInAllowanceCents: Cents;
  tradeInPayoffCents: Cents;
  /** price + dealer fees + sales tax. */
  amountDueCents: Cents;
  downPaymentCents: Cents;
  /** Everything the customer still owes after the down payment and trade. */
  amountFinancedCents: Cents;
  /** trade-in allowance minus the lien payoff on the trade. May be negative. */
  tradeEquityCents: Cents;
}

/**
 * Sales tax on the taxable amount. Texas taxes the price LESS the trade-in
 * allowance; a jurisdiction that taxes the full price passes the full price in.
 */
export function computeSalesTaxCents(taxableAmountCents: Cents, salesTaxBasisPoints: BasisPoints): Cents {
  const taxable = toCents(taxableAmountCents);
  const rawRate = Math.round(salesTaxBasisPoints);
  // A non-finite rate is unusable input, not a rate: treat it as no tax rather
  // than propagating NaN into a contract. Math.max(0, NaN) is NaN, so the
  // finiteness check has to come first.
  const rate = Number.isFinite(rawRate) ? Math.max(0, rawRate) : 0;
  if (rate === 0 || taxable === 0) return 0;
  // round(taxable * rate / 10000) with a single integer division, half up.
  return Math.round((taxable * rate) / 10_000);
}

/** The amount a tax rate applies to: the price less the trade-in allowance. */
export function computeTaxableAmountCents(sellingPriceCents: Cents, tradeInAllowanceCents: Cents = 0): Cents {
  return Math.max(0, toCents(sellingPriceCents) - toCents(tradeInAllowanceCents));
}

/**
 * The contract's arithmetic, exactly once.
 *
 *   amountDue       = price + dealer fees + sales tax
 *   amountFinanced  = max(0, amountDue - down payment - trade-in allowance)
 *
 * A negative `amountFinanced` can only mean the customer over-paid, which is
 * reported as 0 and surfaced by the caller as a warning rather than silently
 * becoming a negative loan.
 */
export function computeContractAmounts(input: {
  sellingPriceCents: Cents;
  dealerFeesCents?: Cents;
  salesTaxBasisPoints?: BasisPoints;
  salesTaxCents?: Cents;
  tradeInAllowanceCents?: Cents;
  tradeInPayoffCents?: Cents;
  downPaymentCents?: Cents;
}): ContractAmounts {
  const sellingPriceCents = assertCents(input.sellingPriceCents, "sellingPriceCents");
  const dealerFeesCents = toCents(input.dealerFeesCents ?? 0);
  const tradeInAllowanceCents = toCents(input.tradeInAllowanceCents ?? 0);
  const tradeInPayoffCents = toCents(input.tradeInPayoffCents ?? 0);
  const downPaymentCents = toCents(input.downPaymentCents ?? 0);

  const taxableAmountCents = computeTaxableAmountCents(sellingPriceCents, tradeInAllowanceCents);
  const salesTaxCents =
    input.salesTaxCents !== undefined
      ? toCents(input.salesTaxCents)
      : computeSalesTaxCents(taxableAmountCents, input.salesTaxBasisPoints ?? 0);

  const amountDueCents = sellingPriceCents + dealerFeesCents + salesTaxCents;
  const amountFinancedCents = Math.max(0, amountDueCents - downPaymentCents - tradeInAllowanceCents);

  return {
    sellingPriceCents,
    dealerFeesCents,
    taxableAmountCents,
    salesTaxCents,
    tradeInAllowanceCents,
    tradeInPayoffCents,
    amountDueCents,
    downPaymentCents,
    amountFinancedCents,
    tradeEquityCents: tradeInAllowanceCents - tradeInPayoffCents,
  };
}

/**
 * The money factor a lease quotes, expressed as an APR-equivalent so the whole
 * codebase can stay in integer basis points:
 *
 *   APR% = money factor x 2400   =>   APR basis points = money factor x 240000
 *
 * A money factor of 0.000625 is therefore 150 basis points (1.50%).
 */
export const MONEY_FACTOR_TO_BASIS_POINTS = 240_000;

export function moneyFactorToAprBasisPoints(moneyFactor: number): BasisPoints {
  if (!Number.isFinite(moneyFactor) || moneyFactor < 0) {
    throw new RangeError(`moneyFactor must be a non-negative number, received ${String(moneyFactor)}`);
  }
  return Math.round(moneyFactor * MONEY_FACTOR_TO_BASIS_POINTS);
}

export function aprBasisPointsToMoneyFactor(aprBasisPoints: BasisPoints): number {
  return Math.max(0, Math.round(aprBasisPoints)) / MONEY_FACTOR_TO_BASIS_POINTS;
}

export interface LeaseScheduleInput {
  /** Gross capitalised cost: the negotiated price plus any capitalised fees. */
  grossCapCostCents: Cents;
  /** Upfront cash the customer puts into the deal (cap cost reduction). */
  capCostReductionCents?: Cents;
  /** Contractual end-of-term value of the vehicle. */
  residualValueCents: Cents;
  aprBasisPoints: BasisPoints;
  numberOfPayments: number;
  paymentFrequency?: PaymentFrequency;
}

export interface LeaseScheduleResult {
  grossCapCostCents: Cents;
  capCostReductionCents: Cents;
  adjustedCapCostCents: Cents;
  residualValueCents: Cents;
  /** The portion of the cap cost the customer pays down over the term. */
  depreciationCents: Cents;
  /** Total rent charge: (adjusted cap cost + residual) x money factor x n. */
  rentChargeCents: Cents;
  /** Principal-equivalent amount financed, i.e. the depreciation. */
  amountFinancedCents: Cents;
  moneyFactor: number;
  paymentAmountCents: Cents;
  finalPaymentCents: Cents;
  totalOfPaymentsCents: Cents;
  numberOfPayments: number;
  rows: AmortizationRow[];
  balloonFinalPayment: boolean;
}

/**
 * True lease arithmetic — NOT a loan formula.
 *
 *   depreciation  = adjusted cap cost - residual
 *   rent charge   = (adjusted cap cost + residual) x money factor x n
 *   payment       = depreciation / n + (adjusted cap + residual) x money factor
 *
 * The rent charge is levied on the AVERAGE outstanding balance (cap cost plus
 * residual), which is what makes a lease cheaper than financing the same
 * amount: the customer is charged for the value they consume, not for the
 * whole vehicle. Running a loan formula here would overstate the payment and
 * misrepresent the product, so it is not done.
 */
export function buildLeaseSchedule(input: LeaseScheduleInput): LeaseScheduleResult {
  const grossCapCostCents = assertCents(input.grossCapCostCents, "grossCapCostCents");
  const residualValueCents = assertCents(input.residualValueCents, "residualValueCents");
  const capCostReductionCents = toCents(input.capCostReductionCents ?? 0);
  const aprBasisPoints = Math.max(0, Math.round(input.aprBasisPoints));
  if (aprBasisPoints > MAX_CONTRACT_APR_BASIS_POINTS) {
    throw new RangeError(
      `aprBasisPoints above ${MAX_CONTRACT_APR_BASIS_POINTS} is not a lease rate; received ${aprBasisPoints}`,
    );
  }

  const n = Math.round(input.numberOfPayments);
  if (!Number.isFinite(n) || n < 1) {
    throw new RangeError(`numberOfPayments must be at least 1, received ${String(input.numberOfPayments)}`);
  }
  if (n > MAX_NUMBER_OF_PAYMENTS) {
    throw new RangeError(`numberOfPayments must be at most ${MAX_NUMBER_OF_PAYMENTS}, received ${n}`);
  }

  const paymentFrequency = input.paymentFrequency ?? "MONTHLY";
  const adjustedCapCostCents = Math.max(0, grossCapCostCents - capCostReductionCents);
  const depreciationCents = Math.max(0, adjustedCapCostCents - residualValueCents);
  const moneyFactor = aprBasisPointsToMoneyFactor(aprBasisPoints);

  // (adjusted cap cost + residual) x money factor x n, rounded once.
  const rentChargeCents = Math.round((adjustedCapCostCents + residualValueCents) * moneyFactor * n);

  const basePaymentCents = Math.round(depreciationCents / n + (adjustedCapCostCents + residualValueCents) * moneyFactor);

  // Walk the lease the same way as a loan: level payment, then a final payment
  // that clears the remaining depreciation exactly, so
  // totalOfPayments = depreciation + rentCharge, cent-exact.
  //
  // The rent charge is spread with Math.floor so that (n-1) periods can never
  // distribute more than the total: the last period takes the remainder, which
  // is therefore always >= 0.
  const rows: AmortizationRow[] = [];
  let remainingDepreciation = depreciationCents;
  let totalOfPaymentsCents = 0;
  const rentPerPeriod = Math.floor(rentChargeCents / n);

  for (let period = 1; period <= n; period += 1) {
    const openingBalanceCents = remainingDepreciation;
    const isFinal = period === n;
    const interestCents = isFinal
      ? Math.max(0, rentChargeCents - rentPerPeriod * (n - 1))
      : rentPerPeriod;
    const paymentCents = isFinal
      ? openingBalanceCents + interestCents
      : Math.min(Math.max(0, basePaymentCents), openingBalanceCents + interestCents);
    const principalCents = paymentCents - interestCents;
    const closingBalanceCents = openingBalanceCents - principalCents;

    rows.push({
      period,
      openingBalanceCents,
      paymentCents,
      interestCents,
      principalCents,
      closingBalanceCents,
    });

    totalOfPaymentsCents += paymentCents;
    remainingDepreciation = closingBalanceCents;
  }

  const finalPaymentCents = rows.length > 0 ? rows[rows.length - 1]!.paymentCents : 0;

  return {
    grossCapCostCents,
    capCostReductionCents,
    adjustedCapCostCents,
    residualValueCents,
    depreciationCents,
    rentChargeCents,
    amountFinancedCents: depreciationCents,
    moneyFactor,
    paymentAmountCents: basePaymentCents,
    finalPaymentCents,
    totalOfPaymentsCents,
    numberOfPayments: n,
    rows,
    balloonFinalPayment: finalPaymentCents > basePaymentCents * 2,
  };
}
