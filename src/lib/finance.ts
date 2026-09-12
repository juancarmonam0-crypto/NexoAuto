import {
  computeContractAmounts,
  computeLevelPaymentCents,
} from "./finance-engine";
import { type BasisPoints, type Cents, applyBasisPoints, toCents } from "./money";

/**
 * Financing estimator.
 *
 * This is a PAYMENT ESTIMATOR, not a lending decision. It performs standard
 * amortisation arithmetic on numbers the dealer configures. It never claims,
 * implies or records an approval, and it does not store credit application data.
 *
 * Adapter-ready: a real lender integration supplies rate/term/approval data
 * through src/lib/providers; this module only does the math.
 */

export const FINANCING_DISCLAIMER =
  "Estimate only. Not an offer, approval, or guarantee of credit. Actual terms depend on the lender, your credit, taxes, fees and down payment.";

export const MIN_TERM_MONTHS = 12;
export const MAX_TERM_MONTHS = 96;
export const MAX_APR_BASIS_POINTS = 3_000; // 30.00%

export interface PaymentEstimateInput {
  priceCents: Cents;
  downPaymentCents?: Cents;
  tradeInAllowanceCents?: Cents;
  aprBasisPoints?: BasisPoints;
  termMonths?: number;
  /** Sales tax applied to the taxable amount (price minus trade-in in Texas). */
  salesTaxBasisPoints?: BasisPoints;
  dealerFeesCents?: Cents;
}

export interface PaymentEstimate {
  priceCents: Cents;
  downPaymentCents: Cents;
  tradeInAllowanceCents: Cents;
  taxableAmountCents: Cents;
  salesTaxCents: Cents;
  dealerFeesCents: Cents;
  amountFinancedCents: Cents;
  aprBasisPoints: BasisPoints;
  termMonths: number;
  monthlyPaymentCents: Cents;
  totalInterestCents: Cents;
  totalOfPaymentsCents: Cents;
  /** Inputs that were clamped, so the UI can explain itself honestly. */
  warnings: string[];
  disclaimer: string;
}

/**
 * Standard amortised monthly payment:
 *   i = apr / 12
 *   payment = P * i * (1+i)^n / ((1+i)^n - 1)
 * With 0% APR this reduces to P / n.
 *
 * PHASE 9B: the arithmetic itself lives in `finance-engine.ts`, the canonical
 * engine. This function keeps the estimator's historical clamping (a term of at
 * least one month, a non-negative rate) and delegates the formula, so the
 * public estimator and a contracted deal can never disagree about what a
 * payment is.
 */
export function estimateMonthlyPaymentCents(
  principalCents: Cents,
  aprBasisPoints: BasisPoints,
  termMonths: number,
): Cents {
  const principal = toCents(principalCents);
  if (principal === 0) return 0;
  const months = Math.max(1, Math.round(termMonths));
  return computeLevelPaymentCents(principal, Math.max(0, Math.round(aprBasisPoints)), months, "MONTHLY");
}

export function estimatePayment(input: PaymentEstimateInput): PaymentEstimate {
  const warnings: string[] = [];

  let termMonths = Math.round(input.termMonths ?? 60);
  if (termMonths < MIN_TERM_MONTHS) {
    warnings.push(`Term raised to the ${MIN_TERM_MONTHS}-month minimum.`);
    termMonths = MIN_TERM_MONTHS;
  }
  if (termMonths > MAX_TERM_MONTHS) {
    warnings.push(`Term capped at ${MAX_TERM_MONTHS} months.`);
    termMonths = MAX_TERM_MONTHS;
  }

  let aprBasisPoints = Math.round(input.aprBasisPoints ?? 0);
  if (aprBasisPoints < 0) {
    warnings.push("Negative APR treated as 0%.");
    aprBasisPoints = 0;
  }
  if (aprBasisPoints > MAX_APR_BASIS_POINTS) {
    warnings.push(`APR capped at ${(MAX_APR_BASIS_POINTS / 100).toFixed(0)}%.`);
    aprBasisPoints = MAX_APR_BASIS_POINTS;
  }

  const priceCents = toCents(input.priceCents);
  const downPaymentCents = toCents(input.downPaymentCents ?? 0);
  const tradeInAllowanceCents = toCents(input.tradeInAllowanceCents ?? 0);
  const dealerFeesCents = toCents(input.dealerFeesCents ?? 0);

  // Texas sales tax is calculated on the price less the trade-in allowance.
  const taxableAmountCents = Math.max(0, priceCents - tradeInAllowanceCents);
  const salesTaxCents = applyBasisPoints(taxableAmountCents, Math.max(0, input.salesTaxBasisPoints ?? 0));

  // The contract arithmetic is the canonical engine's; the sales tax computed
  // just above is passed in so this estimator keeps its exact historical result.
  const contract = computeContractAmounts({
    sellingPriceCents: priceCents,
    dealerFeesCents,
    salesTaxCents,
    tradeInAllowanceCents,
    downPaymentCents: downPaymentCents,
  });
  const amountFinancedCents = contract.amountFinancedCents;

  const monthlyPaymentCents = estimateMonthlyPaymentCents(amountFinancedCents, aprBasisPoints, termMonths);
  const totalOfPaymentsCents = monthlyPaymentCents * termMonths;
  const totalInterestCents = Math.max(0, totalOfPaymentsCents - amountFinancedCents);

  if (downPaymentCents + tradeInAllowanceCents > priceCents + salesTaxCents + dealerFeesCents) {
    warnings.push("Down payment and trade-in exceed the amount due; financed amount is $0.");
  }

  return {
    priceCents,
    downPaymentCents,
    tradeInAllowanceCents,
    taxableAmountCents,
    salesTaxCents,
    dealerFeesCents,
    amountFinancedCents,
    aprBasisPoints,
    termMonths,
    monthlyPaymentCents,
    totalInterestCents,
    totalOfPaymentsCents,
    warnings,
    disclaimer: FINANCING_DISCLAIMER,
  };
}

export const DEFAULT_TERM_OPTIONS_MONTHS = [24, 36, 48, 60, 66, 72, 84] as const;
