import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFER_TERMS_MONTHS,
  OFFER_BLOCKER_LABELS,
  OFFER_BLOCKERS,
  OFFER_VERDICT_LABELS,
  type CustomerOfferInput,
  type CustomerOfferOption,
  type CustomerOfferResult,
  describeOfferApr,
  recommendCustomerOffer,
} from "@/lib/customer-offer";
import {
  type DealPaymentMode,
  computeRecommendedPricing,
  rankDealStructures,
  structureDeal,
} from "@/lib/deal-structuring";
import {
  computeContractAmounts,
  computeLevelPaymentCents,
  numberOfPaymentsFor,
} from "@/lib/finance-engine";
import {
  ABOVE_RATE_POLICY,
  NO_RATE_POLICY_CONFIGURED,
  type FinanceRatePolicy,
} from "@/lib/rate-policy";

/**
 * The SELL-side customer offer engine — `recommendCustomerOffer`.
 *
 * WHAT THIS FILE PINS
 * The engine answers one question: "what is the best deal Nexo can responsibly
 * OFFER, given what this customer can put down and pay per period?" It is pure,
 * deterministic arithmetic over the canonical forward chain — no underwriting, no
 * credit data, no model opinion. So this file pins the POLICY and the arithmetic:
 *
 *   - a CASH offer is a structure with no periodic payment at all and is never
 *     thrown away for lacking one (pinned in A, after the first version of this
 *     file caught the engine dropping it);
 *   - the offer is never priced BELOW the canonical economic floor, and never
 *     priced ABOVE what the operator proposed;
 *   - VEHICLE GROSS and FINANCE INCOME are separate fields and are never merged;
 *   - the engine reports what would have to change (more down, a longer allowed
 *     term) instead of quietly moving the price;
 *   - "no rate policy configured" is NOT the same as "within the rate policy".
 *
 * THE FIXTURE
 * A 2021 used SUV, 61,400 miles, that Nexo owns for $18,500:
 *   landed cost            $18,500    (integer cents: 1_850_000)
 *   asking price           $23,990    (the ceiling the offer engine may quote)
 *   market retail target   $24,500    (external comps; caps the ladder's asking)
 *   dealer floors          $2,500 gross and a 12.00% return on cost
 *   doc fee                $399
 *   sales tax              6.25%      (Texas: taxed on price less the trade)
 *   trade-in               $4,000 allowance against a $2,500 lien payoff
 *   customer               $2,000 down, 9.90% APR, terms 36/48/60/72 months
 *
 * HAND-COMPUTED LADDER (comment repeated at the assertion that relies on it)
 *   gross floor   = 1_850_000 + 250_000                  = 2_100_000
 *   ROI floor     = ceil(1_850_000 x 11_200 / 10_000)    = 2_072_000
 *   floor         = max(2_100_000, 2_072_000) rounded up to $1 = 2_100_000
 *   target        = the floor, because this input configures no target gross/ROI
 *   binding       = "gross-profit-floor"
 *
 * Every money assertion is on INTEGER CENTS. Where a value is independently
 * knowable (contract arithmetic, a level payment) the test derives it from the
 * fixture with the canonical helpers rather than restating the implementation.
 */

/* -------------------------------------------------------------------------- */
/* Fixture                                                                     */
/* -------------------------------------------------------------------------- */

/** $18,500 — what this 2021 SUV cost Nexo, all in. */
const LANDED_COST = 1_850_000;
/** $23,990 — the advertised asking price, and the ceiling a payment search may use. */
const ASKING_PRICE = 2_399_000;
/** $24,500 — the external retail reference the ladder caps its asking price at. */
const MARKET_TARGET = 2_450_000;
/** The dealership's own floors: $2,500 gross, 12.00% return on cost. */
const MIN_GROSS = 250_000;
const MIN_ROI_BPS = 1_200;
const DEALER_FEES = 39_900; // $399 documentary fee
const TAX_BPS = 625; // 6.25% sales tax
const TRADE_ALLOWANCE = 400_000; // $4,000 trade-in allowance
const TRADE_PAYOFF = 250_000; // $2,500 still owed on the trade
const DOWN_PAYMENT = 200_000; // $2,000 down
const APR_BPS = 990; // 9.90% — a believable used-car rate
const TERMS = [36, 48, 60, 72] as const;

/** 1_850_000 + 250_000, because the 12% ROI floor (2_072_000) is lower. */
const FLOOR_CENTS = 2_100_000;
/** At the asking price: taxable 1_999_000, tax 124_938, due 2_563_838. */
const ASKING_TAX_CENTS = 124_938;
const ASKING_AMOUNT_DUE_CENTS = 2_563_838;
/** The same contract at the floor: taxable 1_700_000, tax 106_250, due 2_246_150. */
const FLOOR_TAX_CENTS = 106_250;
const FLOOR_AMOUNT_DUE_CENTS = 2_246_150;

function offerInput(overrides: Partial<CustomerOfferInput> = {}): CustomerOfferInput {
  const defaults: CustomerOfferInput = {
    landedCostCents: LANDED_COST,
    askingPriceCents: ASKING_PRICE,
    targetRetailPriceCents: MARKET_TARGET,
    minGrossProfitCents: MIN_GROSS,
    minRoiBasisPoints: MIN_ROI_BPS,
    daysInInventory: 41,
    dealerFeesCents: DEALER_FEES,
    salesTaxBasisPoints: TAX_BPS,
    tradeInAllowanceCents: TRADE_ALLOWANCE,
    tradeInPayoffCents: TRADE_PAYOFF,
    downPaymentCents: DOWN_PAYMENT,
    maxPaymentCents: 60_000,
    mode: "EXTERNAL_FINANCE",
    aprBasisPoints: APR_BPS,
    allowedTermsMonths: [...TERMS],
  };
  return { ...defaults, ...overrides };
}

/** Runs the engine on the fixture, with only the named fields changed. */
function offer(overrides: Partial<CustomerOfferInput> = {}): CustomerOfferResult {
  return recommendCustomerOffer(offerInput(overrides));
}

/**
 * The contract arithmetic for a sale price, derived from the fixture with the
 * canonical helper rather than re-implemented here. `downPaymentCents` is the
 * down payment the ENGINE applied to the option (a cash deal settles the whole
 * balance at delivery, so its applied down payment is the balance).
 */
function fixtureAmounts(salePriceCents: number, downPaymentCents = DOWN_PAYMENT) {
  return computeContractAmounts({
    sellingPriceCents: salePriceCents,
    dealerFeesCents: DEALER_FEES,
    salesTaxBasisPoints: TAX_BPS,
    tradeInAllowanceCents: TRADE_ALLOWANCE,
    tradeInPayoffCents: TRADE_PAYOFF,
    downPaymentCents,
  });
}

/** Every money-bearing field an option exposes. */
function optionMoneyFields(option: CustomerOfferOption): Array<[string, number | null]> {
  return [
    ["salePriceCents", option.salePriceCents],
    ["maxSalePriceForTargetCents", option.maxSalePriceForTargetCents],
    ["downPaymentCents", option.downPaymentCents],
    ["amountFinancedCents", option.amountFinancedCents],
    ["paymentAmountCents", option.paymentAmountCents],
    ["financeChargeCents", option.financeChargeCents],
    ["totalCustomerOutlayCents", option.totalCustomerOutlayCents],
    ["vehicleGrossCents", option.vehicleGrossCents],
    ["vehicleRoiBasisPoints", option.vehicleRoiBasisPoints],
    ["projectedFinanceIncomeCents", option.projectedFinanceIncomeCents],
    ["dealerCashReceivedAtClosingCents", option.dealerCashReceivedAtClosingCents],
    ["dealerCapitalStillExposedCents", option.dealerCapitalStillExposedCents],
  ];
}

/** Keys anywhere in a serialised result — used to prove no merged-profit field exists. */
function allKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      found.push(key);
      allKeys(nested, found);
    }
  }
  return found;
}

const POLICY_CEILING_BPS = 600; // 6.00% configured ceiling, below the 9.90% requested

const RATE_POLICY: FinanceRatePolicy = {
  id: "TX-USED-2025-01",
  jurisdiction: "TX",
  effectiveFrom: "2025-01-01",
  effectiveTo: null,
  maxAprBasisPoints: POLICY_CEILING_BPS,
  source: {
    label: "Dealer compliance manual",
    reference: "Section 4.2 — used-vehicle rate ceiling",
    retrievedOn: "2025-01-02",
  },
};

/* -------------------------------------------------------------------------- */
/* Fixture sanity: the ladder the rest of the file rests on                    */
/* -------------------------------------------------------------------------- */

describe("customer-offer — the canonical price ladder behind the offer", () => {
  it("derives the floor from landed cost and the configured floors, and confirms it independently", () => {
    const result = offer({});

    // The engine reports the floor it used.
    expect(result.minimumSalePriceCents).toBe(FLOOR_CENTS);
    expect(result.pricePolicy.floorCents).toBe(FLOOR_CENTS);
    expect(result.pricePolicy.bindingConstraint).toBe("gross-profit-floor");
    expect(result.pricePolicy.reasons.length).toBeGreaterThan(0);

    // Independently: the same ladder, built from the frozen pricing engine.
    //   gross floor 1_850_000 + 250_000 = 2_100_000 beats the 12% ROI floor
    //   ceil(1_850_000 x 11_200 / 10_000) = 2_072_000, so gross profit binds.
    const ladder = computeRecommendedPricing({
      landedCostCents: LANDED_COST,
      policy: {
        minGrossProfitCents: MIN_GROSS,
        minRoiBasisPoints: MIN_ROI_BPS,
        marketTargetCents: MARKET_TARGET,
      },
      daysInInventory: 41,
    });
    expect(ladder.minimumApproved.priceCents).toBe(FLOOR_CENTS);
    expect(result.minimumSalePriceCents).toBe(ladder.minimumApproved.priceCents);
    // No target gross/ROI is configured, so the ladder collapses the target onto
    // the floor: the offer's job is to price between the floor and the asking price.
    expect(result.targetSellingPriceCents).toBe(FLOOR_CENTS);
    expect(result.askingPriceCents).toBe(ASKING_PRICE);
    // The fixture's own contract arithmetic, for the comments below.
    expect(fixtureAmounts(ASKING_PRICE).salesTaxCents).toBe(ASKING_TAX_CENTS);
    expect(fixtureAmounts(ASKING_PRICE).amountDueCents).toBe(ASKING_AMOUNT_DUE_CENTS);
    expect(fixtureAmounts(FLOOR_CENTS).salesTaxCents).toBe(FLOOR_TAX_CENTS);
    expect(fixtureAmounts(FLOOR_CENTS).amountDueCents).toBe(FLOOR_AMOUNT_DUE_CENTS);
  });
});

/* -------------------------------------------------------------------------- */
/* A. CASH acceptable offer                                                    */
/* -------------------------------------------------------------------------- */

describe("customer-offer — A. a cash offer at or above the floor", () => {
  it("A (structure): the canonical CASH structure is feasible, settles in full and keeps no capital exposed", () => {
    // The structure the offer engine has to be able to carry. `structureDeal` builds
    // a complete cash sale — it honestly reports `numberOfPayments: 0` and a zero
    // payment, because a cash deal has no schedule. The offer engine now mirrors that
    // truth with `financesSomething = amountFinanced > 0`, so only a structure that
    // actually finances money while having no schedule is treated as unbuildable.
    const structure = structureDeal({
      mode: "CASH",
      sellingPriceCents: ASKING_PRICE,
      landedCostCents: LANDED_COST,
      dealerFeesCents: DEALER_FEES,
      salesTaxBasisPoints: TAX_BPS,
      tradeInAllowanceCents: TRADE_ALLOWANCE,
      tradeInPayoffCents: TRADE_PAYOFF,
      downPaymentCents: DOWN_PAYMENT,
      aprBasisPoints: APR_BPS,
      termMonths: 48,
    });

    expect(structure.feasible).toBe(true);
    expect(structure.numberOfPayments).toBe(0);
    expect(structure.paymentAmountCents).toBe(0);
    expect(structure.financeChargeCents).toBe(0);
    expect(structure.amounts.amountFinancedCents).toBe(0);
    expect(structure.dealerCapitalStillExposedCents).toBe(0);
    // A cash deal settles the whole balance at delivery, so the engine's applied
    // down payment is the balance due (2_563_838 - 400_000 trade allowance).
    expect(structure.amounts.downPaymentCents).toBe(ASKING_AMOUNT_DUE_CENTS - TRADE_ALLOWANCE);
    // Cash in at closing = the settled balance less the trade lien the dealership
    // pays off: 2_163_838 - 250_000 = 1_913_838.
    expect(structure.dealerCashReceivedAtClosingCents).toBe(
      ASKING_AMOUNT_DUE_CENTS - TRADE_ALLOWANCE - TRADE_PAYOFF,
    );
    expect(structure.dealerCashReceivedAtClosingCents).toBe(1_913_838);
    // $23,990 - $18,500 = $5,490 of vehicle gross, realised at closing.
    expect(structure.vehicleGrossCents).toBe(ASKING_PRICE - LANDED_COST);
    expect(structure.vehicleGrossRealizedAtClosing).toBe(true);
  });

  it("A: a cash offer at or above the floor is ACCEPT, with a zero-payment option and no capital exposed", () => {
    // FIXED (was the A bug): a CASH sale finances nothing, so "no schedule" is the
    // truth rather than a failure, and the cash offer is now built and accepted.
    //
    //   recommendCustomerOffer({ ...fixture, mode: "CASH", maxPaymentCents: null })
    //     -> verdict "ACCEPT", 4 options (one per allowed term), 4 feasible,
    //        recommended.paymentAmountCents === 0, amountFinancedCents === 0,
    //        dealerCapitalStillExposedCents === 0,
    //        vehicleGrossCents === 549_000 (23_990_000 - 18_500_000), blockers []
    const result = offer({ mode: "CASH", maxPaymentCents: null });

    expect(result.verdict).toBe("ACCEPT");
    expect(result.verdictLabel).toBe(OFFER_VERDICT_LABELS.ACCEPT);
    // One option per allowed term, and a cash deal fits every one of them: there is
    // no payment that could fail the target and no capital that stays exposed.
    expect(result.options).toHaveLength(TERMS.length);
    expect(result.feasible).toHaveLength(TERMS.length);
    expect(result.blockers).toEqual([]);
    expect(result.recommended).not.toBeNull();

    const cash = result.recommended!;
    // A cash deal has no periodic payment at all — and that is precisely why it must
    // NOT be treated as "no payment => not feasible".
    expect(cash.paymentAmountCents).toBe(0);
    expect(cash.numberOfPayments).toBe(0);
    expect(cash.amountFinancedCents).toBe(0);
    expect(cash.financeChargeCents).toBe(0);
    expect(cash.dealerCapitalStillExposedCents).toBe(0);
    expect(cash.projectedFinanceIncomeCents).toBe(0);
    // The vehicle gross is realised at closing: 2_399_000 - 1_850_000.
    expect(cash.vehicleGrossCents).toBe(ASKING_PRICE - LANDED_COST);
    expect(cash.vehicleGrossCents).toBe(549_000);
    expect(cash.vehicleGrossCents).toBeGreaterThan(0);
    // Cash in at closing = the settled balance less the trade lien the dealership pays
    // off: (2_563_838 - 400_000) - 250_000 = 1_913_838.
    expect(cash.dealerCashReceivedAtClosingCents).toBe(
      ASKING_AMOUNT_DUE_CENTS - TRADE_ALLOWANCE - TRADE_PAYOFF,
    );
    // Every term is priced at the asking ceiling and is genuinely feasible.
    for (const option of result.options) {
      expect(option.paymentAmountCents).toBe(0);
      expect(option.amountFinancedCents).toBe(0);
      expect(option.fitsPaymentTarget).toBe(true);
      expect(option.meetsEconomicFloor).toBe(true);
      expect(option.withinRatePolicy).toBeNull(); // no policy configured
      expect(result.feasible).toContain(option);
    }
    // And the recommendation is one of them, by identity.
    expect(result.feasible.some((option) => option === cash)).toBe(true);
  });

  it("A: a cash buyer who states a zero periodic maximum is still accepted", () => {
    // The same trap in its sharpest form: the customer's stated maximum is $0/month.
    // A cash deal never makes a payment, so it fits, and the offer must still be ACCEPT.
    const result = offer({ mode: "CASH", maxPaymentCents: 0 });

    expect(result.verdict).toBe("ACCEPT");
    expect(result.recommended).not.toBeNull();
    const cash = result.recommended!;
    expect(cash.paymentAmountCents).toBe(0);
    expect(cash.amountFinancedCents).toBe(0);
    expect(cash.dealerCapitalStillExposedCents).toBe(0);
    expect(cash.vehicleGrossCents).toBeGreaterThan(0);
    // FIXED (was defect P1): the price search is skipped for cash, so the $0/month
    // statement changes nothing — the offer stands at the asking ceiling, reports no
    // per-term price ceiling, and raises no PAYMENT_TARGET_TOO_LOW blocker.
    expect(cash.salePriceCents).toBe(ASKING_PRICE);
    expect(cash.vehicleGrossCents).toBe(ASKING_PRICE - LANDED_COST);
    expect(cash.maxSalePriceForTargetCents).toBeNull();
    expect(result.blockers).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* B. CASH below the minimum price                                             */
/* -------------------------------------------------------------------------- */

describe("customer-offer — B. a cash offer below the minimum price", () => {
  it("B: a cash offer below the floor is never accepted and names the price as the blocker", () => {
    // $19,500 against a $21,000 floor. The price is the problem, and the engine
    // says so in the blocker, in the human label and in the warning.
    const result = offer({
      mode: "CASH",
      maxPaymentCents: null,
      proposedSalePriceCents: 1_950_000,
    });

    expect(result.verdict).not.toBe("ACCEPT");
    expect(result.blockers).toContain("PRICE_BELOW_ECONOMIC_MINIMUM");
    expect(result.blockerLabels).toContain(OFFER_BLOCKER_LABELS.PRICE_BELOW_ECONOMIC_MINIMUM);
    // The label is the operator-facing sentence the brief asks for.
    expect(OFFER_BLOCKER_LABELS.PRICE_BELOW_ECONOMIC_MINIMUM).toMatch(
      /below the dealership's (economic )?minimum/,
    );
    expect(result.blockerLabels.join(" | ")).toMatch(/below the dealership's economic minimum/);
    expect(result.warnings.some((warning) => /below the minimum acceptable sale price/.test(warning))).toBe(true);

    // Nothing about this offer is presented as a deal.
    expect(result.minimumSalePriceCents).toBe(FLOOR_CENTS);
    expect(result.feasible).toHaveLength(0);
    expect(result.recommended).toBeNull();
    expect(result.recommendedSalePriceCents).toBeNull();
  });

  it("B: a cash offer below the floor is ADJUST, not REJECT — the price is the only thing wrong", () => {
    // FIXED (was the B bug): the cash option is now built, so a below-floor cash price
    // takes the "a deal is possible, change something" branch. REJECT is documented in
    // the module as reserved for "an unsupported finance mode, no allowed terms, or a
    // mode the structure builder cannot cost" — a COSTED cash structure is none of those.
    //
    //   recommendCustomerOffer({
    //     ...fixture, mode: "CASH",
    //     proposedSalePriceCents: 1_950_000, maxPaymentCents: null,
    //   }) -> verdict "ADJUST", 4 cash options at $19,500, 0 feasible,
    //        blockers ["PRICE_BELOW_ECONOMIC_MINIMUM"], recommended null
    const result = offer({
      mode: "CASH",
      maxPaymentCents: null,
      proposedSalePriceCents: 1_950_000,
    });

    expect(result.verdict).toBe("ADJUST");
    expect(result.verdictLabel).toBe(OFFER_VERDICT_LABELS.ADJUST);
    expect(result.blockers).toContain("PRICE_BELOW_ECONOMIC_MINIMUM");
    expect(result.blockers).not.toContain("UNSUPPORTED_FINANCE_MODE");
    // With no stated payment target the cash options are built at the operator's price
    // and are correctly refused: the price is the only thing wrong with this offer.
    expect(result.options).toHaveLength(TERMS.length);
    expect(result.feasible).toHaveLength(0);
    expect(result.recommended).toBeNull();
    for (const option of result.options) {
      expect(option.salePriceCents).toBe(1_950_000);
      expect(option.meetsEconomicFloor).toBe(false);
      expect(option.paymentAmountCents).toBe(0);
    }
  });

  it("B: a cash offer below the floor reports the price as the adjustment — minimumViable stays null", () => {
    // A cash customer whose stated periodic maximum is zero, against a price under the
    // floor. The adjustment for a cash deal is the PRICE, never "more money down":
    // a cash sale has no periodic payment to fit, so `minimumViable` (which exists to
    // fit a payment) is correctly null, and the price the deal must move to is
    // reported as `minimumSalePriceCents` alongside the blocker.
    const result = offer({
      mode: "CASH",
      maxPaymentCents: 0,
      proposedSalePriceCents: 1_950_000,
    });

    expect(result.verdict).toBe("ADJUST");
    expect(result.verdictLabel).toBe(OFFER_VERDICT_LABELS.ADJUST);
    expect(result.blockers).toContain("PRICE_BELOW_ECONOMIC_MINIMUM");
    // No down-payment adjustment is invented for a deal that makes no payments.
    expect(result.minimumViable).toBeNull();
    expect(result.blockers).not.toContain("DOWN_PAYMENT_TOO_LOW");
    // Nor is a payment target "too low" for a deal with no payment (defect P1).
    expect(result.blockers).not.toContain("PAYMENT_TARGET_TOO_LOW");
    // The price carries the adjustment: the floor is the number to move to...
    expect(result.minimumSalePriceCents).toBe(FLOOR_CENTS);
    expect(result.pricePolicy.floorCents).toBe(FLOOR_CENTS);
    // ...and the blocker label says so in the operator's words.
    expect(result.blockerLabels.join(" | ")).toMatch(/price is below the dealership's economic minimum/);
    // A cash sale still cannot be accepted below the floor, whatever the payment says.
    expect(result.verdict).not.toBe("ACCEPT");
    // FIXED (was defect P2): the option shows the OPERATOR'S price, flagged as below the
    // floor, rather than being repriced up to the floor. Nothing is recommended at a
    // price under the floor, so there is no recommended price to report.
    expect(result.options).toHaveLength(TERMS.length);
    for (const option of result.options) {
      expect(option.salePriceCents).toBe(1_950_000);
      expect(option.meetsEconomicFloor).toBe(false);
      expect(option.paymentAmountCents).toBe(0);
    }
    expect(result.recommended).toBeNull();
    expect(result.recommendedSalePriceCents).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* C. External finance fit                                                     */
/* -------------------------------------------------------------------------- */

describe("customer-offer — C. external finance", () => {
  it("C: a down payment plus a generous maximum payment is ACCEPT and the lender funds the balance", () => {
    // $750/month clears every allowed term at the asking price, so no price has to
    // be reduced and every option is the same contract over a different term.
    const result = offer({ mode: "EXTERNAL_FINANCE", maxPaymentCents: 75_000 });

    expect(result.verdict).toBe("ACCEPT");
    expect(result.recommended).not.toBeNull();
    expect(result.feasible.length).toBe(TERMS.length);

    // The financed balance at the asking price is derived from the fixture:
    //   due 2_563_838 - 200_000 down - 400_000 trade allowance = 1_963_838.
    const amounts = fixtureAmounts(ASKING_PRICE);
    expect(amounts.amountFinancedCents).toBe(1_963_838);

    for (const option of result.options) {
      expect(option.salePriceCents).toBe(ASKING_PRICE);
      expect(option.amountFinancedCents).toBe(amounts.amountFinancedCents);
      expect(option.downPaymentCents).toBe(DOWN_PAYMENT);
      // The lender advances the balance, so no dealership capital stays at work.
      expect(option.dealerCapitalStillExposedCents).toBe(0);
      // Cash at closing = down payment + lender proceeds - trade-in payoff.
      expect(option.dealerCashReceivedAtClosingCents).toBe(
        option.downPaymentCents + option.amountFinancedCents - TRADE_PAYOFF,
      );
      // 200_000 + 1_963_838 - 250_000 = 1_913_838 paid to the dealership at delivery.
      expect(option.dealerCashReceivedAtClosingCents).toBe(1_913_838);
      // The customer's own money at the counter: down payment + every payment.
      expect(option.totalCustomerOutlayCents).toBe(
        option.downPaymentCents + option.structure.totalOfPaymentsCents,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* D. Nexo financing fit                                                       */
/* -------------------------------------------------------------------------- */

describe("customer-offer — D. buy here, pay here", () => {
  it("D: Nexo's own note is ACCEPT at a workable target and Nexo carries exactly what it financed", () => {
    // An 18.00% in-house note. $700/month is workable on every term.
    const result = offer({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 1_800, maxPaymentCents: 70_000 });

    expect(result.verdict).toBe("ACCEPT");
    const recommended = result.recommended;
    expect(recommended).not.toBeNull();
    expect(recommended!.aprBasisPoints).toBe(1_800);

    // Nothing is sold to a lender, so the dealership's capital out is the whole
    // amount financed.
    expect(recommended!.dealerCapitalStillExposedCents).toBeGreaterThan(0);
    expect(recommended!.dealerCapitalStillExposedCents).toBe(recommended!.amountFinancedCents);

    // Finance income is the contract's finance charge, and it is real money.
    expect(recommended!.projectedFinanceIncomeCents).toBe(recommended!.financeChargeCents);
    expect(recommended!.projectedFinanceIncomeCents).toBeGreaterThan(0);
    expect(recommended!.financeChargeCents).toBe(
      recommended!.structure.totalOfPaymentsCents - recommended!.structure.amounts.amountFinancedCents,
    );

    // Every term is feasible at this target, and each one prices at or below the
    // asking price and at or above the floor.
    expect(result.options).toHaveLength(TERMS.length);
    for (const option of result.options) {
      expect(option.dealerCapitalStillExposedCents).toBe(option.amountFinancedCents);
      expect(option.salePriceCents).toBeGreaterThanOrEqual(FLOOR_CENTS);
      expect(option.salePriceCents).toBeLessThanOrEqual(ASKING_PRICE);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* E. Target payment too low                                                   */
/* -------------------------------------------------------------------------- */

describe("customer-offer — E. the payment target is too low", () => {
  it("E: a target below even the floor's own payment blocks and never prices under the floor", () => {
    // $150/month cannot buy this vehicle at any allowed term: at the FLOOR price the
    // cheapest allowed term (72 months) still needs 1_646_150 financed, which is
    // 30_413 cents per month — more than double the stated maximum.
    const result = offer({ maxPaymentCents: 15_000 });

    expect(result.blockers).toContain("PAYMENT_TARGET_TOO_LOW");
    // ADJUST, not REJECT: the engine DID build options (at the floor, the cheapest
    // honest price) and hands the operator a concrete adjustment. REJECT is reserved
    // for inputs where no structure can be built at all.
    expect(result.verdict).toBe("ADJUST");
    expect(result.verdictLabel).toBe(OFFER_VERDICT_LABELS.ADJUST);
    expect(result.recommended).toBeNull();
    expect(result.feasible).toHaveLength(0);

    // The engine never silently prices below the floor to reach the target: with no
    // price fitting the target, every option sits exactly ON the floor.
    expect(result.minimumSalePriceCents).toBe(FLOOR_CENTS);
    expect(result.options).toHaveLength(TERMS.length);
    for (const option of result.options) {
      expect(option.maxSalePriceForTargetCents).toBeNull();
      expect(option.salePriceCents).toBeGreaterThanOrEqual(result.minimumSalePriceCents!);
      expect(option.salePriceCents).toBe(FLOOR_CENTS);
      expect(option.fitsPaymentTarget).toBe(false);
      // The floor's own payment, for the record: 53_039 / 41_672 / 34_895 / 30_413.
      expect(option.paymentAmountCents).toBeGreaterThan(15_000);
    }

    // The engine still tells the operator what would have to change (asserted in F).
    expect(result.minimumViable).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* F. Down payment too low                                                     */
/* -------------------------------------------------------------------------- */

describe("customer-offer — F. the down payment is too low", () => {
  it("F: a target that needs more money down reports the exact minimum-viable adjustment", () => {
    // $280/month at the FLOOR price still exceeds the target on every term
    // (72 months needs 30_413), so the only honest change at this price is more down.
    const result = offer({ maxPaymentCents: 28_000 });

    expect(result.blockers).toContain("DOWN_PAYMENT_TOO_LOW");
    expect(result.recommended).toBeNull();

    const viable = result.minimumViable;
    expect(viable).not.toBeNull();
    // The adjustment is priced at the floor — the cheapest honest price.
    expect(viable!.salePriceCents).toBe(FLOOR_CENTS);
    // It asks for strictly more money down than the customer offered...
    expect(viable!.downPaymentCents).toBeGreaterThan(DOWN_PAYMENT);
    // ...and it actually reaches the target at that floor price.
    expect(viable!.paymentAmountCents).toBeLessThanOrEqual(28_000);
    // 2_246_150 due - 400_000 trade allowance - 330_599 down = 1_515_551 financed.
    expect(viable!.amountFinancedCents).toBe(FLOOR_AMOUNT_DUE_CENTS - TRADE_ALLOWANCE - viable!.downPaymentCents);
    expect(viable!.vehicleGrossCents).toBe(FLOOR_CENTS - LANDED_COST);
    expect(viable!.reason).toMatch(/more down than the customer offered/);
    expect(result.reasons).toContain(viable!.reason);
  });

  it("F: the minimum-viable down payment is the cheapest one across every allowed term", () => {
    const result = offer({ maxPaymentCents: 28_000 });
    const viable = result.minimumViable!;

    // Cross-check the engine's choice by re-running it one allowed term at a time:
    // no single term may reach the target with LESS money down than the engine's
    // minimum-viable answer.
    for (const termMonths of TERMS) {
      const singleTerm = offer({ maxPaymentCents: 28_000, allowedTermsMonths: [termMonths] });
      if (singleTerm.minimumViable === null) {
        // Only possible when even paying the whole balance down cannot reach the
        // target — the engine must then say the term cannot do it at all.
        expect(singleTerm.blockers, `term ${termMonths}`).toContain("TERM_NOT_ALLOWED");
        continue;
      }
      expect(
        singleTerm.minimumViable.downPaymentCents,
        `term ${termMonths} should need at least as much down as the engine's minimum`,
      ).toBeGreaterThanOrEqual(viable.downPaymentCents);
      expect(singleTerm.minimumViable.paymentAmountCents, `term ${termMonths}`).toBeLessThanOrEqual(28_000);
    }

    // And the adjustment is not just arithmetic: taking it turns the offer into an
    // ACCEPT at that term.
    const accepted = offer({
      maxPaymentCents: 28_000,
      downPaymentCents: viable.downPaymentCents,
      allowedTermsMonths: [viable.termMonths],
    });
    expect(accepted.verdict).toBe("ACCEPT");
    expect(accepted.recommended).not.toBeNull();
    expect(accepted.recommended!.paymentAmountCents).toBeLessThanOrEqual(28_000);
    expect(accepted.recommended!.salePriceCents).toBeGreaterThanOrEqual(FLOOR_CENTS);
  });
});

/* -------------------------------------------------------------------------- */
/* G. Term selection, ranking and determinism                                  */
/* -------------------------------------------------------------------------- */

describe("customer-offer — G. term selection, ranking and determinism", () => {
  it("G: the recommendation is the structure rankDealStructures puts first among the feasible ones", () => {
    const result = offer({ mode: "EXTERNAL_FINANCE", maxPaymentCents: 75_000 });

    // Every allowed term fits at this generous target, so all four are feasible.
    expect(result.feasible.length).toBe(TERMS.length);

    const ranked = rankDealStructures(result.feasible.map((option) => option.structure));
    expect(ranked.length).toBe(result.feasible.length);
    expect(result.recommended).not.toBeNull();
    // Object identity: the recommendation IS the canonical ranking's winner.
    expect(result.recommended!.structure).toBe(ranked[0]);

    // And the rest of the ranked order is drawn from the same feasible set.
    for (const structure of ranked) {
      expect(result.feasible.some((option) => option.structure === structure)).toBe(true);
    }
  });

  it("G: the recommendation is not automatically the longest term", () => {
    const result = offer({ mode: "EXTERNAL_FINANCE", maxPaymentCents: 75_000 });
    const recommended = result.recommended!;
    const longest = Math.max(...TERMS);

    expect(recommended.termMonths).toBe(36);
    expect(recommended.termMonths).toBeLessThan(longest);

    // The longest allowed term is feasible and costs the customer the least per
    // month, but it is NOT the recommendation: the canonical ranking weights
    // capital velocity, cash recovery, margin and term length above the extra
    // finance income a longer note would earn.
    const longestOption = result.options.find((option) => option.termMonths === longest);
    expect(longestOption).toBeDefined();
    expect(longestOption!.fitsPaymentTarget).toBe(true);
    expect(longestOption!.paymentAmountCents).toBeLessThan(recommended.paymentAmountCents);
    expect(longestOption!.structure.score!.total).toBeLessThan(recommended.structure.score!.total);
    // 36 months at the asking price: 63_275/month. 72 months: 36_283/month.
    expect(longestOption!.paymentAmountCents).toBe(36_283);
  });

  it("G: two identical calls produce identical offers", () => {
    const first = offer({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 1_800, maxPaymentCents: 70_000 });
    const second = offer({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 1_800, maxPaymentCents: 70_000 });

    expect(second.verdict).toBe(first.verdict);
    expect(second.blockers).toEqual(first.blockers);
    expect(second.blockerLabels).toEqual(first.blockerLabels);
    expect(second.reasons).toEqual(first.reasons);
    expect(second.options.map((option) => option.paymentAmountCents)).toEqual(
      first.options.map((option) => option.paymentAmountCents),
    );
    expect(second.options.map((option) => option.salePriceCents)).toEqual(
      first.options.map((option) => option.salePriceCents),
    );
    expect(second.recommended?.termMonths).toBe(first.recommended?.termMonths);
    // Nothing in the result carries a clock, a random value or a model opinion.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

/* -------------------------------------------------------------------------- */
/* H. Vehicle gross and finance income stay separate                           */
/* -------------------------------------------------------------------------- */

describe("customer-offer — H. vehicle gross and finance income never merge", () => {
  it("H: gross is the vehicle metric, finance income is the finance metric, and no field adds them", () => {
    const result = offer({ mode: "EXTERNAL_FINANCE", maxPaymentCents: 60_000 });
    const recommended = result.recommended!;
    expect(recommended.termMonths).toBe(48);
    expect(recommended.salePriceCents).toBe(ASKING_PRICE);

    // VEHICLE metric: sale price - canonical landed cost = 2_399_000 - 1_850_000.
    expect(recommended.vehicleGrossCents).toBe(ASKING_PRICE - LANDED_COST);
    expect(recommended.vehicleGrossCents).toBe(549_000);
    // ROI is the gross over the dealer's cost basis: 549_000 / 1_850_000 = 29.68%.
    expect(recommended.vehicleRoiBasisPoints).toBe(2_968);

    // FINANCE metric: the finance charge on the note, and nothing else.
    expect(recommended.projectedFinanceIncomeCents).toBe(recommended.financeChargeCents);
    expect(recommended.projectedFinanceIncomeCents).toBeGreaterThan(0);
    expect(recommended.financeChargeCents).toBe(
      recommended.structure.totalOfPaymentsCents - recommended.structure.amounts.amountFinancedCents,
    );

    // They are different numbers, reported separately.
    expect(recommended.vehicleGrossCents).not.toBe(recommended.projectedFinanceIncomeCents);

    const mergedTotal = recommended.vehicleGrossCents! + recommended.projectedFinanceIncomeCents;

    // No field ON THE OPTION is the merged total. (`structure` is excluded on
    // purpose: it carries `combinedExpectedEconomicsCents`, a presentation-only
    // aggregate the RANKING uses, documented in deal-structuring.ts as never to be
    // stored or reported as profit — and it is deliberately not copied onto the
    // option, which is asserted here.)
    const ownFields = Object.entries(recommended).filter(([key]) => key !== "structure");
    expect(ownFields.map(([key]) => key)).not.toContain("combinedExpectedEconomicsCents");
    for (const [key, value] of ownFields) {
      expect(value, `${key} must not be the merged gross+finance total`).not.toBe(mergedTotal);
    }

    // And nowhere in the serialised result is there a "profit" field that merges them.
    const serialised = JSON.parse(JSON.stringify(result)) as unknown;
    expect(allKeys(serialised).filter((key) => /profit/i.test(key))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* I. Capital exposure                                                         */
/* -------------------------------------------------------------------------- */

describe("customer-offer — I. capital exposure by mode", () => {
  it("I: CASH holds none, EXTERNAL_FINANCE releases it, BHPH keeps exactly what it financed", () => {
    // FIXED: the CASH leg now runs. One test, three modes, three answers.
    const cash = offer({ mode: "CASH", maxPaymentCents: 0 });
    const external = offer({ mode: "EXTERNAL_FINANCE", maxPaymentCents: 75_000 });
    const bhph = offer({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 1_800, maxPaymentCents: 70_000 });

    // CASH: the balance is settled at delivery, so there is nothing to carry.
    expect(cash.options).toHaveLength(TERMS.length);
    expect(cash.options.map((option) => option.dealerCapitalStillExposedCents)).toEqual([0, 0, 0, 0]);
    expect(cash.options.map((option) => option.amountFinancedCents)).toEqual([0, 0, 0, 0]);

    // EXTERNAL_FINANCE: the lender advances the balance at delivery => exposure 0.
    expect(external.feasible.length).toBeGreaterThan(0);
    for (const option of external.feasible) {
      expect(option.dealerCapitalStillExposedCents).toBe(0);
      expect(option.amountFinancedCents).toBeGreaterThan(0);
    }

    // BUY_HERE_PAY_HERE: the dealership carries the note => exposure = the balance.
    expect(bhph.feasible.length).toBeGreaterThan(0);
    for (const option of bhph.feasible) {
      expect(option.dealerCapitalStillExposedCents).toBeGreaterThan(0);
      expect(option.dealerCapitalStillExposedCents).toBe(option.amountFinancedCents);
    }

    // The three-way contrast, explicitly: 0 / 0 / the amount financed.
    expect([
      cash.recommended!.dealerCapitalStillExposedCents,
      external.recommended!.dealerCapitalStillExposedCents,
      bhph.recommended!.dealerCapitalStillExposedCents,
    ]).toEqual([0, 0, bhph.recommended!.amountFinancedCents]);
    expect(bhph.recommended!.amountFinancedCents).toBeGreaterThan(0);
  });

  it("I: the two financed modes contrast exactly as required", () => {
    const external = offer({ mode: "EXTERNAL_FINANCE", maxPaymentCents: 75_000 });
    const bhph = offer({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 1_800, maxPaymentCents: 70_000 });

    expect(external.recommended).not.toBeNull();
    expect(bhph.recommended).not.toBeNull();

    // EXTERNAL_FINANCE: the lender advances the balance at delivery => exposure 0.
    expect(external.recommended!.dealerCapitalStillExposedCents).toBe(0);
    // BUY_HERE_PAY_HERE: the dealership carries the note => exposure = the balance.
    expect(bhph.recommended!.dealerCapitalStillExposedCents).toBeGreaterThan(0);
    expect(bhph.recommended!.dealerCapitalStillExposedCents).toBe(bhph.recommended!.amountFinancedCents);

    // The same vehicle, the same kind of contract, opposite capital positions —
    // which is the whole point of the contrast.
    expect(external.recommended!.dealerCapitalStillExposedCents).not.toBe(
      bhph.recommended!.dealerCapitalStillExposedCents,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* J. Configured APR ceiling                                                   */
/* -------------------------------------------------------------------------- */

describe("customer-offer — J. the configured rate policy", () => {
  it("J: a rate above the configured ceiling is reported on every option, blocked, and never ACCEPT", () => {
    // 9.90% requested against a configured 6.00% ceiling.
    const result = offer({
      aprBasisPoints: APR_BPS,
      ratePolicy: {
        policies: [RATE_POLICY],
        jurisdiction: "TX",
        asOf: "2025-06-01",
        vehicleModelYear: 2021,
      },
    });

    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      expect(option.withinRatePolicy).toBe(false);
      // The option's own flag, and the full evaluation it carries.
      expect(option.structure.ratePolicy.withinConfiguredRatePolicy).toBe(false);
      expect(option.structure.ratePolicy.status).toBe(ABOVE_RATE_POLICY);
      expect(option.structure.ratePolicy.policyId).toBe(RATE_POLICY.id);
      expect(option.structure.ratePolicy.policyCeilingBasisPoints).toBe(POLICY_CEILING_BPS);
      expect(option.structure.ratePolicy.statement).toMatch(/above the configured rate policy/);
      // The status and the sentence are also surfaced on the option ITSELF, so a
      // caller never has to reach into `structure` for them.
      expect(option.ratePolicyStatus).toBe(ABOVE_RATE_POLICY);
      expect(option.ratePolicyStatus).toBe("ABOVE_CONFIGURED_RATE_POLICY");
      expect(option.ratePolicyStatement).toBe(option.structure.ratePolicy.statement);
      expect(option.ratePolicyStatement).toMatch(/9.90% is above the configured rate policy TX-USED-2025-01/);
      // The structure is honest about it in its risk flags too.
      expect(option.structure.riskFlags).toContain("ABOVE_CONFIGURED_RATE_POLICY");
    }

    expect(result.blockers).toContain("RATE_POLICY_VIOLATION");
    expect(result.verdict).not.toBe("ACCEPT");
    expect(result.verdict).toBe("ADJUST");
    // Nothing that violates the configured ceiling is offered as feasible.
    expect(result.feasible).toHaveLength(0);
    expect(result.recommended).toBeNull();
  });

  it("J: with no policy configured the offer is not 'within policy' — it is unmeasured, and can still be ACCEPT", () => {
    const result = offer({ maxPaymentCents: 60_000 });

    expect(result.verdict).toBe("ACCEPT");
    expect(result.blockers).not.toContain("RATE_POLICY_VIOLATION");
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      // null, NOT true: "no ceiling configured" is not "inside the ceiling".
      expect(option.withinRatePolicy).toBeNull();
      expect(option.structure.ratePolicy.status).toBe(NO_RATE_POLICY_CONFIGURED);
      expect(option.structure.ratePolicy.statement).toMatch(/No rate policy is configured/);
      // The option-level status says the same thing, and still asserts no ceiling.
      expect(option.ratePolicyStatus).toBe(NO_RATE_POLICY_CONFIGURED);
      expect(option.ratePolicyStatus).not.toBe(ABOVE_RATE_POLICY);
      expect(option.ratePolicyStatement).toBe(option.structure.ratePolicy.statement);
      expect(option.structure.riskFlags).toContain("NO_CONFIGURED_RATE_POLICY");
    }
  });

  it("J: the option itself carries the rate-policy status and statement", () => {
    // FIXED (was the J shape gap): `CustomerOfferOption.ratePolicyStatus` and
    // `ratePolicyStatement` now exist, so a caller never has to reach into `structure`.
    const result = offer({
      ratePolicy: {
        policies: [RATE_POLICY],
        jurisdiction: "TX",
        asOf: "2025-06-01",
        vehicleModelYear: 2021,
      },
    });

    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      expect(option.ratePolicyStatus).toBe("ABOVE_CONFIGURED_RATE_POLICY");
      expect(option.ratePolicyStatement).toMatch(/above the configured rate policy/);
      // Same values the engine evaluated on the structure — no second opinion.
      expect(option.ratePolicyStatus).toBe(option.structure.ratePolicy.status);
      expect(option.ratePolicyStatement).toBe(option.structure.ratePolicy.statement);
    }

    // And with a ceiling that IS respected, the same field reports the honest answer.
    const withinPolicy = offer({
      aprBasisPoints: 500, // 5.00%, inside the 6.00% configured ceiling
      ratePolicy: {
        policies: [RATE_POLICY],
        jurisdiction: "TX",
        asOf: "2025-06-01",
        vehicleModelYear: 2021,
      },
      maxPaymentCents: 60_000,
    });
    expect(withinPolicy.verdict).toBe("ACCEPT");
    expect(withinPolicy.blockers).not.toContain("RATE_POLICY_VIOLATION");
    for (const option of withinPolicy.options) {
      expect(option.withinRatePolicy).toBe(true);
      expect(option.ratePolicyStatus).not.toBe("ABOVE_CONFIGURED_RATE_POLICY");
      expect(option.ratePolicyStatement).toMatch(/is within the configured rate policy/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* K. Manual sale price override                                               */
/* -------------------------------------------------------------------------- */

describe("customer-offer — K. a manual sale price override", () => {
  it("K: a proposed price below the floor is blocked and never ACCEPT, however easy the payment", () => {
    // A $500/month maximum is trivially met by this vehicle, and it changes nothing:
    // the price the operator proposed is under the dealership's floor.
    const result = offer({ proposedSalePriceCents: 1_950_000, maxPaymentCents: 500_000 });

    expect(result.blockers).toContain("PRICE_BELOW_ECONOMIC_MINIMUM");
    expect(result.verdict).not.toBe("ACCEPT");
    expect(result.verdict).toBe("ADJUST");
    expect(result.recommended).toBeNull();
    expect(result.feasible).toHaveLength(0);
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      expect(option.salePriceCents).toBe(1_950_000);
      expect(option.meetsEconomicFloor).toBe(false);
      expect(option.fitsPaymentTarget).toBe(true);
    }
  });

  it("K: a proposed price above the floor and above the asking price is honoured as a ceiling and never inflated", () => {
    // The operator has negotiated $26,000 — above both the $21,000 floor and the
    // $23,990 asking price. The engine may REDUCE that price to fit the payment, and
    // must never raise it to reach a target.
    const proposed = 2_600_000;
    const result = offer({ proposedSalePriceCents: proposed, maxPaymentCents: 60_000 });

    expect(result.options).toHaveLength(TERMS.length);
    for (const option of result.options) {
      expect(option.salePriceCents).toBeLessThanOrEqual(proposed);
      expect(option.salePriceCents).toBeGreaterThanOrEqual(FLOOR_CENTS);
    }
    // Priced AT the operator's number where the payment allows (48/60/72 months)...
    expect(Math.max(...result.options.map((option) => option.salePriceCents))).toBe(proposed);
    expect(result.recommendedSalePriceCents).toBeLessThanOrEqual(proposed);
    // ...and REDUCED where it does not (36 months cannot carry 2_600_000 at $600/month).
    const reduced = result.options.filter((option) => option.salePriceCents < proposed);
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced.every((option) => option.fitsPaymentTarget)).toBe(true);
    // The override is a ceiling above the asking price, and the engine used it as one.
    expect(proposed).toBeGreaterThan(ASKING_PRICE);
    expect(result.options.some((option) => option.salePriceCents > ASKING_PRICE)).toBe(true);
    expect(result.askingPriceCents).toBe(ASKING_PRICE);
  });
});

/* -------------------------------------------------------------------------- */
/* L. The three verdicts, explicitly                                           */
/* -------------------------------------------------------------------------- */

describe("customer-offer — L. the three verdicts", () => {
  it("L: ACCEPT — a deal that fits the customer's numbers, the floor and the payment target", () => {
    const result = offer({ mode: "EXTERNAL_FINANCE", maxPaymentCents: 75_000 });

    expect(result.verdict).toBe("ACCEPT");
    expect(result.verdictLabel).toBe(OFFER_VERDICT_LABELS.ACCEPT);
    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.fitsPaymentTarget).toBe(true);
    expect(result.recommended!.meetsEconomicFloor).toBe(true);
    expect(result.recommended!.withinRatePolicy).toBeNull(); // no policy configured
    expect(result.blockers).toEqual([]);
  });

  it("L: ADJUST — the deal is close, but the customer's stated maximum is too low", () => {
    const result = offer({ maxPaymentCents: 15_000 });

    expect(result.verdict).toBe("ADJUST");
    expect(result.verdictLabel).toBe(OFFER_VERDICT_LABELS.ADJUST);
    expect(result.blockers).toContain("PAYMENT_TARGET_TOO_LOW");
    expect(result.recommended).toBeNull();
    // ADJUST is "something has to change", so the result must say what.
    expect(result.minimumViable).not.toBeNull();
    expect(result.reasons.some((reason) => /does not work as asked/.test(reason))).toBe(true);
  });

  it("L: REJECT — no structure can be built at all, for two honestly different reasons", () => {
    // (1) NO ALLOWED TERMS. Every option is built per allowed term, so with an empty
    // term list there is nothing to build, no minimum-viable adjustment is possible
    // (there is no term to compute one at), and the engine must refuse rather than
    // invent a term.
    const noTerms = offer({ allowedTermsMonths: [] });
    expect(noTerms.verdict).toBe("REJECT");
    expect(noTerms.verdictLabel).toBe(OFFER_VERDICT_LABELS.REJECT);
    expect(noTerms.blockers).toContain("NO_ALLOWED_TERMS");
    expect(noTerms.options).toEqual([]);
    expect(noTerms.minimumViable).toBeNull();
    expect(noTerms.recommended).toBeNull();
    expect(noTerms.reasons.some((reason) => /No structure can be built/.test(reason))).toBe(true);

    // (2) A LEASE WITH NO CONTRACTUAL RESIDUAL. A lease cannot be priced without the
    // residual value, `structureDeal` reports it infeasible for every term, so the
    // engine refuses instead of pricing a lease it cannot cost.
    const leaseWithoutResidual = offer({
      mode: "LEASE",
      allowedTermsMonths: [48],
      lease: null,
      maxPaymentCents: 60_000,
    });
    expect(leaseWithoutResidual.verdict).toBe("REJECT");
    expect(leaseWithoutResidual.blockers).toContain("UNSUPPORTED_FINANCE_MODE");
    expect(leaseWithoutResidual.options).toEqual([]);
    expect(leaseWithoutResidual.minimumViable).toBeNull();
    expect(leaseWithoutResidual.warnings.some((warning) => /residual value/.test(warning))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* M. Impossible and degraded inputs                                           */
/* -------------------------------------------------------------------------- */

describe("customer-offer — M. impossible and degraded inputs", () => {
  it("M: no allowed terms is reported, not crashed", () => {
    const result = offer({ allowedTermsMonths: [] });

    expect(result.blockers).toContain("NO_ALLOWED_TERMS");
    expect(result.blockerLabels).toContain(OFFER_BLOCKER_LABELS.NO_ALLOWED_TERMS);
    expect(result.verdict).toBe("REJECT");
    expect(result.options).toEqual([]);
    expect(result.feasible).toEqual([]);
    expect(result.minimumViable).toBeNull();
    // The floor is still computed and reported — only the terms are missing.
    expect(result.minimumSalePriceCents).toBe(FLOOR_CENTS);
  });

  it("M: a masked viewer gets exact payment maths and no fabricated margin", () => {
    // `landedCostCents: null` is a role that may not see the dealership's cost. Null
    // is not zero: no gross, no ROI, no score, no floor, and no acceptance.
    const result = offer({ landedCostCents: null, maxPaymentCents: 60_000 });

    expect(result.minimumSalePriceCents).toBeNull();
    expect(result.blockers).toContain("VEHICLE_COST_UNKNOWN");
    expect(result.verdict).not.toBe("ACCEPT");
    expect(result.verdict).toBe("ADJUST");
    expect(result.recommended).toBeNull();
    expect(result.feasible).toHaveLength(0);

    // The price policy block is empty — there is nothing to report.
    expect(result.pricePolicy.floorCents).toBeNull();
    expect(result.pricePolicy.targetCents).toBeNull();
    expect(result.pricePolicy.bindingConstraint).toBeNull();
    expect(result.pricePolicy.reasons).toEqual([]);

    // Without a floor there is no payment-driven price search, so every option is
    // priced at the asking ceiling — and the margin fields stay genuinely absent.
    const amounts = fixtureAmounts(ASKING_PRICE);
    expect(amounts.amountFinancedCents).toBe(1_963_838);
    expect(result.options).toHaveLength(TERMS.length);
    for (const option of result.options) {
      expect(option.salePriceCents).toBe(ASKING_PRICE);
      expect(option.maxSalePriceForTargetCents).toBeNull();
      expect(option.vehicleGrossCents).toBeNull();
      expect(option.vehicleRoiBasisPoints).toBeNull();
      expect(option.meetsEconomicFloor).toBe(false);
      expect(option.structure.score).toBeNull();
      expect(option.withinRatePolicy).toBeNull();
      // The payment maths is still exact: the canonical level payment on the
      // canonical amount financed for that term.
      const periods = numberOfPaymentsFor(option.termMonths, "MONTHLY");
      expect(option.numberOfPayments).toBe(periods);
      expect(option.amountFinancedCents).toBe(amounts.amountFinancedCents);
      expect(option.paymentAmountCents).toBe(
        computeLevelPaymentCents(amounts.amountFinancedCents, APR_BPS, periods, "MONTHLY"),
      );
      // 36/48/60/72 months at 9.90% on $19,638.38: 63_275 / 49_714 / 41_629 / 36_283.
      expect(option.paymentAmountCents).toBeGreaterThan(0);
    }
    expect(result.options.map((option) => option.paymentAmountCents)).toEqual([63_275, 49_714, 41_629, 36_283]);
  });

  it("M: with no stated payment target every option fits and there is no price ceiling per term", () => {
    const result = offer({ maxPaymentCents: null });

    // No stated maximum is not a zero maximum: nothing can fail a target that was
    // never given, so every allowed term is feasible...
    expect(result.options).toHaveLength(TERMS.length);
    for (const option of result.options) {
      expect(option.fitsPaymentTarget).toBe(true);
      // ...and there is no payment-driven price search to report.
      expect(option.maxSalePriceForTargetCents).toBeNull();
      expect(option.salePriceCents).toBe(ASKING_PRICE);
      expect(option.paymentAmountCents).toBeGreaterThan(0);
    }
    expect(result.verdict).toBe("ACCEPT");
    // The engine says the budget is open, rather than inventing a limit.
    expect(result.reasons.some((reason) => /no maximum was given/.test(reason))).toBe(true);
  });

  it("M: a zero down payment still works and finances the amount due less the trade-in", () => {
    const result = offer({ downPaymentCents: 0, maxPaymentCents: 75_000 });

    // 2_563_838 due - 0 down - 400_000 trade allowance = 2_163_838 financed.
    const amounts = fixtureAmounts(ASKING_PRICE, 0);
    expect(amounts.amountDueCents).toBe(ASKING_AMOUNT_DUE_CENTS);
    expect(amounts.amountFinancedCents).toBe(2_163_838);

    expect(result.verdict).toBe("ACCEPT");
    expect(result.options).toHaveLength(TERMS.length);
    for (const option of result.options) {
      expect(option.downPaymentCents).toBe(0);
      expect(option.amountFinancedCents).toBe(amounts.amountFinancedCents);
      expect(option.amountFinancedCents).toBe(amounts.amountDueCents - TRADE_ALLOWANCE);
      expect(option.salePriceCents).toBe(ASKING_PRICE);
      // A zero-down deal is allowed, and flagged as the risk it is.
      expect(option.structure.riskFlags).toContain("ZERO_DOWN_PAYMENT");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* N. Invariants across a matrix                                               */
/* -------------------------------------------------------------------------- */

const MATRIX_MODES: readonly DealPaymentMode[] = ["CASH", "EXTERNAL_FINANCE", "BUY_HERE_PAY_HERE"];
const MATRIX_TARGETS: readonly (number | null)[] = [null, 45_000, 60_000, 90_000];
const MATRIX_DOWNS: readonly number[] = [0, 200_000, 1_500_000];

describe("customer-offer — N. invariants across a mode/target/down matrix", () => {
  it("N: every option in the sweep obeys the contract invariants", () => {
    let optionsChecked = 0;

    for (const mode of MATRIX_MODES) {
      for (const maxPaymentCents of MATRIX_TARGETS) {
        for (const downPaymentCents of MATRIX_DOWNS) {
          const label = `${mode} / target ${String(maxPaymentCents)} / down ${downPaymentCents}`;
          const result = offer({ mode, maxPaymentCents, downPaymentCents });

          // CASH included: every allowed term produces an option, for all three modes
          // (the cash path used to be dropped entirely — see test A).
          expect(result.options, label).toHaveLength(TERMS.length);

          if (mode === "CASH") {
            // A cash deal makes no periodic payment, so there is no payment to fit and
            // therefore no "more money down" adjustment to invent: `minimumViable` is
            // never produced for CASH. The adjustment for a cash offer is the PRICE
            // (the floor plus the PRICE_BELOW_ECONOMIC_MINIMUM blocker), which test B
            // asserts directly.
            expect(result.minimumViable, `${label}: no down-payment adjustment for cash`).toBeNull();
          }

          optionsChecked += result.options.length;
          expect(result.minimumSalePriceCents, label).toBe(FLOOR_CENTS);

          for (const option of result.options) {
            const optionLabel = `${label} / ${option.termMonths} months`;

            // (1) Integer cents everywhere — money never leaves this engine as a float.
            for (const [field, value] of optionMoneyFields(option)) {
              if (value !== null) {
                expect(Number.isInteger(value), `${optionLabel}: ${field} must be whole cents`).toBe(true);
              }
            }

            // (2) amountFinanced = max(0, amount due - down - trade-in allowance),
            //     with the down payment the engine APPLIED (a cash deal settles the
            //     whole balance at delivery, so its applied down payment is the balance).
            const amounts = fixtureAmounts(option.salePriceCents, option.downPaymentCents);
            expect(option.amountFinancedCents, `${optionLabel}: amount financed`).toBe(
              Math.max(0, amounts.amountDueCents - option.downPaymentCents - TRADE_ALLOWANCE),
            );
            if (mode !== "CASH") {
              expect(option.downPaymentCents, `${optionLabel}: the customer's own down payment`).toBe(
                downPaymentCents,
              );
            }

            // (3) The floor is respected: a known floor is never undershot.
            expect(option.salePriceCents, `${optionLabel}: at or above the floor`).toBeGreaterThanOrEqual(
              result.minimumSalePriceCents!,
            );

            // (4) fitsPaymentTarget agrees with the arithmetic it claims to summarise.
            expect(option.fitsPaymentTarget, `${optionLabel}: fits the target`).toBe(
              maxPaymentCents === null || option.paymentAmountCents <= maxPaymentCents,
            );

            // (5) No negative money value, EXCEPT `dealerCashReceivedAtClosingCents`,
            //     which is signed on purpose: on a note the dealership carries itself
            //     there are no lender proceeds to cover the trade-in payoff, so the
            //     dealership can be out of pocket at delivery. Its exact formula is
            //     asserted below, and it is asserted non-negative across the whole
            //     matrix in the lien-free test that follows.
            for (const [field, value] of optionMoneyFields(option)) {
              if (value === null || field === "dealerCashReceivedAtClosingCents") continue;
              expect(value, `${optionLabel}: ${field} must not be negative`).toBeGreaterThanOrEqual(0);
            }
            const thirdPartyProceeds = mode === "EXTERNAL_FINANCE" ? option.amountFinancedCents : 0;
            expect(option.dealerCashReceivedAtClosingCents, `${optionLabel}: cash at closing`).toBe(
              option.downPaymentCents + thirdPartyProceeds - TRADE_PAYOFF,
            );

            // (6) The customer's outlay is the down payment plus every payment.
            expect(option.totalCustomerOutlayCents, `${optionLabel}: customer outlay`).toBe(
              option.downPaymentCents + option.structure.totalOfPaymentsCents,
            );
          }
        }
      }
    }

    // The sweep must actually have exercised options, not passed vacuously.
    expect(optionsChecked).toBeGreaterThan(0);
  });

  it("N: with no trade lien every money field on every option is non-negative", () => {
    // Same matrix, a trade with nothing owed on it, so every cash-at-closing figure
    // is money IN and the non-negativity invariant holds for every money field.
    let optionsChecked = 0;

    for (const mode of MATRIX_MODES) {
      for (const maxPaymentCents of MATRIX_TARGETS) {
        for (const downPaymentCents of MATRIX_DOWNS) {
          const label = `${mode} / target ${String(maxPaymentCents)} / down ${downPaymentCents}`;
          const result = offer({ mode, maxPaymentCents, downPaymentCents, tradeInPayoffCents: 0 });

          // CASH included: no mode is allowed to produce an empty option list.
          expect(result.options, label).toHaveLength(TERMS.length);

          optionsChecked += result.options.length;
          for (const option of result.options) {
            for (const [field, value] of optionMoneyFields(option)) {
              if (value === null) continue;
              expect(value, `${label} / ${option.termMonths} months: ${field} must not be negative`).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }

    expect(optionsChecked).toBeGreaterThan(0);
  });

  it("N: cash at closing is SIGNED and may be negative when the dealership funds a trade-in lien it carries", () => {
    // "No negative money anywhere" is NOT a real invariant for
    // `dealerCashReceivedAtClosingCents`. The formula is
    //
    //     cash at closing = down payment + third-party proceeds - trade-in payoff
    //
    // and on a BUY_HERE_PAY_HERE deal there ARE no third-party proceeds: no lender
    // advances the balance at delivery, so the dealership must fund the trade lien
    // itself out of its own pocket. Here that is
    //
    //     200_000 down + 0 proceeds - 250_000 payoff = -50_000 cents
    //
    // i.e. $500 OUT at closing. That is arithmetically correct and economically
    // meaningful (the dealership buys the lien and collects it back through the note),
    // so it is asserted as the signed quantity it is.
    const result = offer({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 1_800, maxPaymentCents: 70_000 });

    expect(result.options).toHaveLength(TERMS.length);
    for (const option of result.options) {
      expect(option.dealerCashReceivedAtClosingCents).toBe(
        option.downPaymentCents + 0 - TRADE_PAYOFF,
      );
      expect(option.dealerCashReceivedAtClosingCents).toBe(DOWN_PAYMENT - TRADE_PAYOFF);
      expect(option.dealerCashReceivedAtClosingCents).toBe(-50_000);
      // Every OTHER money field on the same option is strictly non-negative.
      for (const [field, value] of optionMoneyFields(option)) {
        if (value === null || field === "dealerCashReceivedAtClosingCents") continue;
        expect(value, `${field} must not be negative`).toBeGreaterThanOrEqual(0);
      }
      // The negative figure is money the dealership pays OUT to clear the lien, and
      // the same trade's equity (allowance - payoff) is positive: +150_000.
      expect(option.structure.amounts.tradeEquityCents).toBe(TRADE_ALLOWANCE - TRADE_PAYOFF);
    }

    // The contrast that makes the sign meaningful: when a lender DOES advance the
    // balance (EXTERNAL_FINANCE) the same worksheet is comfortably positive.
    const external = offer({ mode: "EXTERNAL_FINANCE", maxPaymentCents: 75_000 });
    for (const option of external.options) {
      expect(option.dealerCashReceivedAtClosingCents).toBe(
        option.downPaymentCents + option.amountFinancedCents - TRADE_PAYOFF,
      );
      expect(option.dealerCashReceivedAtClosingCents).toBeGreaterThan(0);
    }

    // A CASH deal settles the whole balance, so it is always cash IN, even with the
    // same lien: (2_563_838 - 400_000) - 250_000 = 1_913_838.
    const cash = offer({ mode: "CASH", maxPaymentCents: null });
    for (const option of cash.options) {
      expect(option.dealerCashReceivedAtClosingCents).toBe(1_913_838);
      expect(option.dealerCashReceivedAtClosingCents).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* O. Leases stay separate and honest                                          */
/* -------------------------------------------------------------------------- */

describe("customer-offer — O. leases are not loans", () => {
  /** The lease the fixture is quoted with: a $12,000 contractual residual. */
  const LEASE = { residualValueCents: 1_200_000 } as const;
  /** Gross cap cost = 2_399_000 price + 39_900 fees = 2_438_900. */
  const GROSS_CAP_COST = ASKING_PRICE + DEALER_FEES;
  /** Adjusted cap cost = 2_438_900 - 200_000 cap cost reduction = 2_238_900. */
  const ADJUSTED_CAP_COST = GROSS_CAP_COST - DOWN_PAYMENT;
  /** Depreciation = 2_238_900 - 1_200_000 residual = 1_038_900. */
  const DEPRECIATION = ADJUSTED_CAP_COST - LEASE.residualValueCents;

  it("O: a lease finances the depreciation, not the vehicle price", () => {
    const result = offer({
      mode: "LEASE",
      maxPaymentCents: 80_000,
      allowedTermsMonths: [36, 48],
      lease: LEASE,
    });

    expect(result.verdict).not.toBe("REJECT");
    expect(result.options).toHaveLength(2);

    const loanStyleBalance = GROSS_CAP_COST - DOWN_PAYMENT; // 2_238_900, what a loan would carry

    for (const option of result.options) {
      expect(option.salePriceCents).toBe(ASKING_PRICE);
      // The amount financed is the DEPRECIATION the customer consumes...
      expect(option.amountFinancedCents).toBe(DEPRECIATION);
      expect(option.amountFinancedCents).toBe(1_038_900);
      // ...not the price, and not the loan-style balance.
      expect(option.amountFinancedCents).not.toBe(GROSS_CAP_COST);
      expect(option.amountFinancedCents).not.toBe(loanStyleBalance);
      expect(option.amountFinancedCents).toBeLessThan(GROSS_CAP_COST);

      // The lease summary the structure carries agrees, and states the residual.
      expect(option.structure.lease).not.toBeNull();
      expect(option.structure.lease!.residualValueCents).toBe(LEASE.residualValueCents);
      expect(option.structure.lease!.depreciationCents).toBe(option.amountFinancedCents);
      expect(option.structure.lease!.grossCapCostCents).toBe(GROSS_CAP_COST);
      expect(option.structure.lease!.adjustedCapCostCents).toBe(ADJUSTED_CAP_COST);
      expect(option.structure.lease!.capCostReductionCents).toBe(DOWN_PAYMENT);

      // The rent charge is charged on the average balance, and the vehicle's gross
      // is still a separate vehicle metric.
      expect(option.financeChargeCents).toBeGreaterThan(0);
      expect(option.financeChargeCents).toBe(option.projectedFinanceIncomeCents);
      expect(option.vehicleGrossCents).toBe(ASKING_PRICE - LANDED_COST);
      // 2_238_900 adjusted cap cost - 200_000 cap reduction = 2_038_900 of residual risk.
      expect(option.dealerCapitalStillExposedCents).toBe(ADJUSTED_CAP_COST - DOWN_PAYMENT);
    }
  });

  it("O: lease-to-own still calculates, but its contract is blocked", () => {
    const result = offer({
      mode: "LEASE_TO_OWN",
      maxPaymentCents: 80_000,
      allowedTermsMonths: [48],
      lease: LEASE,
    });

    expect(result.options).toHaveLength(1);
    const option = result.options[0]!;

    // The calculation runs: a lease payment and the depreciation financing exist.
    expect(option.paymentAmountCents).toBeGreaterThan(0);
    expect(option.amountFinancedCents).toBe(DEPRECIATION);
    expect(option.structure.lease!.depreciationCents).toBe(DEPRECIATION);
    // Ownership transfer is deliberately undefined for lease-to-own...
    expect(option.structure.lease!.ownershipTransfer).toBe("NOT_DEFINED");
    // ...so no customer contract may be generated from this structure.
    expect(option.structure.contractGeneration).toBe("BLOCKED");
    expect(option.structure.contractBlockedReason).not.toBeNull();
    expect(option.structure.contractBlockedReason).toMatch(/cannot be generated/i);
    expect(option.structure.riskFlags).toContain("LEASE_TO_OWN_CONTRACT_BLOCKED");
    // The engine's verdict is about whether the NUMBERS fit — the contract block is
    // reported on the structure, and it is not a payment-schedule failure.
    expect(result.verdict).not.toBe("REJECT");
  });
});

/* -------------------------------------------------------------------------- */
/* The module's small surface                                                  */
/* -------------------------------------------------------------------------- */

describe("customer-offer — module surface", () => {
  it("keeps every blocker and verdict labelled, formats an APR, and accepts the default terms", () => {
    // Every enumerated blocker has a non-empty operator-facing label, and the two
    // label maps agree with their key unions.
    expect(OFFER_BLOCKERS).toHaveLength(9);
    for (const blocker of OFFER_BLOCKERS) {
      expect(OFFER_BLOCKER_LABELS[blocker], blocker).toBeTruthy();
      expect(typeof OFFER_BLOCKER_LABELS[blocker]).toBe("string");
    }
    expect(Object.keys(OFFER_BLOCKER_LABELS).sort()).toEqual([...OFFER_BLOCKERS].sort());
    expect(Object.keys(OFFER_VERDICT_LABELS).sort()).toEqual(["ACCEPT", "ADJUST", "REJECT"]);

    // 990 basis points is 9.90%.
    expect(describeOfferApr(990)).toBe("9.90%");
    expect(describeOfferApr(0)).toBe("0.00%");

    // The default terms are explicit, positive and ascending, and the engine builds
    // one option per allowed term.
    expect(DEFAULT_OFFER_TERMS_MONTHS.length).toBeGreaterThan(0);
    expect([...DEFAULT_OFFER_TERMS_MONTHS]).toEqual([...DEFAULT_OFFER_TERMS_MONTHS].sort((a, b) => a - b));
    expect([...DEFAULT_OFFER_TERMS_MONTHS].every((term) => Number.isInteger(term) && term > 0)).toBe(true);

    const result = offer({ maxPaymentCents: null, allowedTermsMonths: DEFAULT_OFFER_TERMS_MONTHS });
    expect(result.options.map((option) => option.termMonths)).toEqual([...DEFAULT_OFFER_TERMS_MONTHS]);
    for (const option of result.options) {
      expect(option.salePriceCents).toBeGreaterThanOrEqual(FLOOR_CENTS);
      expect(option.fitsPaymentTarget).toBe(true); // no target was stated
    }
    expect(result.verdict).toBe("ACCEPT");
  });
});

/* -------------------------------------------------------------------------- */
/* P. Price-search edges found while fixing CASH (fixed, pinned here)           */
/* -------------------------------------------------------------------------- */

/**
 * Two defects found while pinning requirement A, both in the PRICE SEARCH (step 2/3
 * of `recommendCustomerOffer`) rather than in the contract arithmetic. Both are now
 * fixed in the source and pinned here as regression tests:
 *
 *   P1  the payment-driven price search ran for CASH, so a cash deal's price was
 *       decided by loan arithmetic on a monthly payment the cash buyer never makes;
 *   P2  when no price fitted the target, the option was priced at the FLOOR even when
 *       that was ABOVE the price the operator proposed.
 */
describe("customer-offer — P. price-search edges (regression tests)", () => {
  it("P1: a cash offer's price does not depend on a monthly payment it will never make", () => {
    // FIXED: the price search is skipped for CASH (`mode !== "CASH"` in step 3), so a
    // cash deal is priced at the operator's asking price and reports no per-term price
    // ceiling at all. Before the fix the cash price was driven by loan arithmetic:
    // target 45_000 produced [2_100_000, 2_223_766, 2_399_000, 2_399_000].
    const zeroTarget = offer({ mode: "CASH", maxPaymentCents: 0 });

    // A cash deal has no periodic payment, so nothing can be "too low" for it...
    expect(zeroTarget.blockers).not.toContain("PAYMENT_TARGET_TOO_LOW");
    expect(zeroTarget.blockers).toEqual([]);
    // ...and there is no payment-driven price search to report.
    expect(zeroTarget.options.map((option) => option.maxSalePriceForTargetCents)).toEqual([null, null, null, null]);
    // The cash price is the operator's asking price, at every term, for every customer
    // who states a monthly maximum.
    expect(zeroTarget.options.map((option) => option.salePriceCents)).toEqual([
      ASKING_PRICE,
      ASKING_PRICE,
      ASKING_PRICE,
      ASKING_PRICE,
    ]);
    // Which restores the full vehicle gross on a cash sale: 2_399_000 - 1_850_000.
    expect(zeroTarget.options.every((option) => option.vehicleGrossCents === ASKING_PRICE - LANDED_COST)).toBe(
      true,
    );
    expect(zeroTarget.verdict).toBe("ACCEPT");

    // The cash price must be invariant to a number the cash buyer never pays.
    const cashPrices = (maxPaymentCents: number | null) =>
      offer({ mode: "CASH", maxPaymentCents }).options.map((option) => option.salePriceCents);
    expect(cashPrices(45_000)).toEqual(cashPrices(0));
    expect(cashPrices(60_000)).toEqual(cashPrices(0));
    expect(cashPrices(90_000)).toEqual(cashPrices(0));
    expect(cashPrices(null)).toEqual(cashPrices(0));
  });

  it("P2: the option price is clamped to what the operator proposed, never inflated to the floor", () => {
    // FIXED: when no price at or above the floor fits the target, the option price is
    //   min(priceCeilingCents, minimumSalePriceCents)
    // i.e. the OPERATOR'S number when that is lower, flagged as below the floor, instead
    // of quoting the higher floor price back at them. Before the fix every option here
    // was priced at 2_100_000, 150_000 cents ABOVE the operator's 1_950_000.
    const proposed = 1_950_000;
    const result = offer({ mode: "EXTERNAL_FINANCE", proposedSalePriceCents: proposed, maxPaymentCents: 15_000 });

    expect(result.blockers).toContain("PRICE_BELOW_ECONOMIC_MINIMUM");
    expect(result.blockers).toContain("PAYMENT_TARGET_TOO_LOW");
    expect(result.options).toHaveLength(TERMS.length);
    for (const option of result.options) {
      // The operator's number is shown, and flagged, never exceeded.
      expect(option.salePriceCents).toBe(proposed);
      expect(option.salePriceCents).toBeLessThanOrEqual(proposed);
      expect(option.meetsEconomicFloor).toBe(false);
      // The vehicle gross reported is the gross AT THE OPERATOR'S PRICE: 1_950_000 - 1_850_000.
      expect(option.vehicleGrossCents).toBe(proposed - LANDED_COST);
      expect(option.vehicleGrossCents).toBe(100_000);
    }
    // Nothing is recommended at a price below the floor, and the adjustment offered is
    // the one at the FLOOR (more down), never a higher price.
    expect(result.recommended).toBeNull();
    expect(result.recommendedSalePriceCents).toBeNull();
    expect(result.minimumViable).not.toBeNull();
    expect(result.minimumViable!.salePriceCents).toBe(FLOOR_CENTS);
    expect(result.minimumSalePriceCents).toBe(FLOOR_CENTS);
  });

  it("P2: no option exceeds the proposed price when a price does fit, nor ever exceeds the asking price", () => {
    // The same ceiling rule with a proposal ABOVE the floor and above the asking price:
    // the engine may reduce a price to fit a payment, and must never raise one.
    const proposed = 2_600_000;
    const result = offer({ proposedSalePriceCents: proposed, maxPaymentCents: 60_000 });
    expect(Math.max(...result.options.map((option) => option.salePriceCents))).toBe(proposed);
    for (const option of result.options) {
      expect(option.salePriceCents).toBeLessThanOrEqual(proposed);
    }
    // With no proposal at all, the asking price is the hard ceiling for every mode.
    for (const mode of MATRIX_MODES) {
      for (const maxPaymentCents of MATRIX_TARGETS) {
        const priced = offer({ mode, maxPaymentCents });
        for (const option of priced.options) {
          expect(option.salePriceCents, `${mode} / ${String(maxPaymentCents)}`).toBeLessThanOrEqual(ASKING_PRICE);
        }
      }
    }
  });
});
