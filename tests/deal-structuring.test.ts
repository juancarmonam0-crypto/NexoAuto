import { describe, expect, it } from "vitest";
import {
  BLOCKING_DEAL_RISK_FLAGS,
  DEFAULT_DEAL_SCORING_WEIGHTS,
  DEAL_PAYMENT_MODES,
  RISK_THRESHOLDS,
  compareDealStructures,
  computeRecommendedPricing,
  dealStructureColumns,
  financeTypeForMode,
  rankDealStructures,
  structureDeal,
  type DealStructure,
  type DealStructureInput,
} from "@/lib/deal-structuring";
import { ABOVE_RATE_POLICY, WITHIN_RATE_POLICY, type FinanceRatePolicy } from "@/lib/rate-policy";
import { computeEstimatedGrossProfit, computeRoiBasisPoints } from "@/lib/economics";

/**
 * Phase 9B — deal structuring: the price ladder, the five payment modes, the
 * risk flags and the comparison.
 *
 * Every money assertion is on integer cents. The tests that matter most here are
 * the SEPARATION tests: the vehicle's gross profit is a vehicle metric and the
 * finance charge is a finance metric, and nothing may merge them.
 */

const LANDED_COST = 1_500_000; // $15,000
const PRICE = 2_000_000; // $20,000

const POLICY: FinanceRatePolicy = {
  id: "TX-USED-2025",
  jurisdiction: "TX",
  effectiveFrom: "2025-01-01",
  effectiveTo: null,
  maxAprBasisPoints: 1_800,
  source: {
    label: "Dealer compliance manual",
    reference: "Section 4.2, used-vehicle rate ceiling",
    retrievedOn: "2025-01-02",
  },
};

/** The canonical external-finance deal every test starts from. */
function deal(overrides: Partial<DealStructureInput> = {}): DealStructure {
  const defaults: DealStructureInput = {
    mode: "EXTERNAL_FINANCE",
    sellingPriceCents: PRICE,
    landedCostCents: LANDED_COST,
    downPaymentCents: 200_000,
    aprBasisPoints: 600,
    termMonths: 60,
  };
  return structureDeal({ ...defaults, ...overrides });
}

describe("deal-structuring — computeRecommendedPricing: floors", () => {
  const base = {
    minGrossProfitCents: 200_000,
    minRoiBasisPoints: 1_000,
    targetGrossProfitCents: 400_000,
  };

  it("adds the minimum gross profit to landed cost to get the gross floor", () => {
    // 15,000 landed + 2,000 minimum gross = 17,000 floor. The 10% ROI floor is
    // 15,000 x 1.10 = 16,500, which is lower, so gross profit binds.
    const pricing = computeRecommendedPricing({ landedCostCents: LANDED_COST, policy: base });
    expect(pricing.minimumApproved.priceCents).toBe(1_700_000);
    expect(pricing.bindingConstraint).toBe("gross-profit-floor");
  });

  it("lets the ROI floor bind when a higher return is required", () => {
    // A 20% minimum return sets the floor at 15,000 x 1.20 = 18,000, above the
    // 17,000 gross floor, so the return requirement wins.
    const pricing = computeRecommendedPricing({
      landedCostCents: LANDED_COST,
      policy: { ...base, minRoiBasisPoints: 2_000 },
    });
    expect(pricing.minimumApproved.priceCents).toBe(1_800_000);
    expect(pricing.bindingConstraint).toBe("roi-floor");
    expect(pricing.minimumApproved.roiBasisPoints).toBe(2_000);
  });

  it("satisfies BOTH floors at the minimum approved price", () => {
    for (const minRoiBasisPoints of [0, 500, 1_000, 2_000, 5_000]) {
      const pricing = computeRecommendedPricing({
        landedCostCents: LANDED_COST,
        policy: { ...base, minRoiBasisPoints },
      });
      const { priceCents, grossProfitCents, roiBasisPoints } = pricing.minimumApproved;
      expect(grossProfitCents, `roi ${minRoiBasisPoints}`).toBeGreaterThanOrEqual(base.minGrossProfitCents);
      expect(roiBasisPoints ?? 0, `roi ${minRoiBasisPoints}`).toBeGreaterThanOrEqual(minRoiBasisPoints);
      // And the price is derived from cost, not invented.
      expect(priceCents).toBeGreaterThanOrEqual(LANDED_COST);
    }
  });

  it("never places the target below the minimum approved price", () => {
    // A target gross of $1,000 is below the $2,000 floor, so the floor wins and
    // the target is clamped up to the minimum approved price.
    const pricing = computeRecommendedPricing({
      landedCostCents: LANDED_COST,
      policy: { ...base, targetGrossProfitCents: 100_000 },
    });
    expect(pricing.target.priceCents).toBe(pricing.minimumApproved.priceCents);
    expect(pricing.target.priceCents).toBe(1_700_000);
    expect(pricing.target.grossProfitCents).toBe(200_000);
    expect(pricing.target.grossProfitCents).toBeGreaterThanOrEqual(base.minGrossProfitCents);
  });

  it("raises the target above the floor when the ROI floor is the higher one", () => {
    // A 20% ROI floor puts the minimum at 18,000 even though the target gross of
    // $2,500 would only reach 17,500. The target must still clear both floors.
    const pricing = computeRecommendedPricing({
      landedCostCents: LANDED_COST,
      policy: { minGrossProfitCents: 200_000, minRoiBasisPoints: 2_000, targetGrossProfitCents: 250_000 },
    });
    expect(pricing.minimumApproved.priceCents).toBe(1_800_000);
    expect(pricing.target.priceCents).toBe(1_800_000);
    expect(pricing.target.grossProfitCents).toBe(300_000);
    // NOTE: the "target price yields less than the minimum gross profit" warning
    // in computeRecommendedPricing is unreachable for any input, because the
    // target is clamped UP to the minimum approved price (whose gross profit is
    // by construction at least minGrossProfitCents) before the warning is
    // evaluated. The clamp is the right behaviour — a warning that can never fire
    // is just dead code.
    expect(pricing.warnings).toEqual([]);
  });

  it("never drops the asking price below the minimum approved price", () => {
    // Aggressive market target AND an aggressive ageing discount at the same
    // time: the market reference is below the floor, so the unit simply cannot
    // meet both, and the engine says so rather than pricing under the floor.
    const pricing = computeRecommendedPricing({
      landedCostCents: LANDED_COST,
      policy: {
        ...base,
        negotiationAllowanceBasisPoints: 500,
        marketTargetCents: 1_600_000,
        aging: { afterDays: 30, discountBasisPointsPer30Days: 500, maxDiscountBasisPoints: 2_000 },
      },
      daysInInventory: 400,
    });
    expect(pricing.minimumApproved.priceCents).toBe(1_700_000);
    expect(pricing.asking.priceCents).toBe(1_700_000);
    expect(pricing.belowMarketTarget).toBe(true);
    expect(pricing.marketTargetApplied).toBe(false);
    expect(pricing.warnings).toHaveLength(1);
    expect(pricing.warnings[0]).toMatch(/below the minimum approved price/);
  });

  it("rounds every tier UP to whole dollars", () => {
    // 1,234,567 landed + 100,000 = 1,334,567, which rounds up to 1,334,600; the
    // floor is never undershot by the rounding step.
    const pricing = computeRecommendedPricing({
      landedCostCents: 1_234_567,
      policy: { minGrossProfitCents: 100_000, minRoiBasisPoints: 0, roundingCents: 100 },
    });
    expect(pricing.minimumApproved.priceCents).toBe(1_334_600);
    expect(pricing.minimumApproved.priceCents % 100).toBe(0);
    expect(pricing.asking.priceCents % 100).toBe(0);
    expect(pricing.target.priceCents % 100).toBe(0);
    // An odd rounding step is honoured too.
    const odd = computeRecommendedPricing({
      landedCostCents: 1_234_567,
      policy: { minGrossProfitCents: 100_000, minRoiBasisPoints: 0, roundingCents: 1_000 },
    });
    expect(odd.minimumApproved.priceCents).toBe(1_335_000);
  });

  it("does not divide by zero when the landed cost is 0", () => {
    // A cost of zero makes ROI undefined, not infinite: the tier reports null
    // ROI and no NaN ever reaches the price.
    const pricing = computeRecommendedPricing({
      landedCostCents: 0,
      policy: { minGrossProfitCents: 200_000, minRoiBasisPoints: 1_000, targetGrossProfitCents: 400_000 },
    });
    expect(pricing.minimumApproved.priceCents).toBe(200_000);
    expect(pricing.minimumApproved.grossProfitCents).toBe(200_000);
    expect(pricing.minimumApproved.roiBasisPoints).toBeNull();
    expect(pricing.target.priceCents).toBe(400_000);
    expect(pricing.asking.priceCents).toBe(400_000);
    expect(pricing.bindingConstraint).toBe("none");
    for (const value of [pricing.minimumApproved.priceCents, pricing.target.priceCents, pricing.asking.priceCents]) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });
});

describe("deal-structuring — computeRecommendedPricing: market, ageing, negotiation", () => {
  const base = {
    minGrossProfitCents: 200_000,
    minRoiBasisPoints: 1_000,
    targetGrossProfitCents: 400_000,
  };

  it("caps the asking price at the market target and names the constraint", () => {
    // Floors put the minimum at 17,000 and the +5% negotiation room puts the
    // asking price at 19,950; a market reference of 18,500 is above the floor
    // but below that, so it becomes the cap.
    const pricing = computeRecommendedPricing({
      landedCostCents: LANDED_COST,
      policy: { ...base, negotiationAllowanceBasisPoints: 500, marketTargetCents: 1_850_000 },
    });
    expect(pricing.target.priceCents).toBe(1_900_000);
    expect(pricing.asking.priceCents).toBe(1_850_000);
    expect(pricing.marketTargetApplied).toBe(true);
    expect(pricing.bindingConstraint).toBe("market-target");
    expect(pricing.asking.grossProfitCents).toBe(350_000);
    expect(pricing.asking.roiBasisPoints).toBe(2_333);
  });

  it("warns instead of inventing a price when the market is below the floor", () => {
    const pricing = computeRecommendedPricing({
      landedCostCents: LANDED_COST,
      policy: { ...base, marketTargetCents: 1_600_000 },
    });
    expect(pricing.belowMarketTarget).toBe(true);
    // The unit is priced at the floor it must hold, and the conflict is stated.
    expect(pricing.asking.priceCents).toBe(1_700_000);
    expect(pricing.asking.grossProfitCents).toBe(200_000);
    expect(pricing.bindingConstraint).toBe("market-target");
    expect(pricing.warnings).toHaveLength(1);
    expect(pricing.warnings[0]).toMatch(/cannot meet both at the same price/);
  });

  it("applies no ageing discount at or before afterDays", () => {
    const aging = { afterDays: 30, discountBasisPointsPer30Days: 200, maxDiscountBasisPoints: 400 };
    for (const daysInInventory of [0, 15, 29, 30]) {
      const pricing = computeRecommendedPricing({
        landedCostCents: LANDED_COST,
        policy: { ...base, negotiationAllowanceBasisPoints: 500, aging },
        daysInInventory,
      });
      expect(pricing.agingDiscountCents, `day ${daysInInventory}`).toBe(0);
      expect(pricing.asking.priceCents, `day ${daysInInventory}`).toBe(1_995_000);
    }
  });

  it("applies 200bp per full 30 days past afterDays and caps the total", () => {
    const aging = { afterDays: 30, discountBasisPointsPer30Days: 200, maxDiscountBasisPoints: 400 };
    const policy = { minGrossProfitCents: 50_000, minRoiBasisPoints: 0, targetGrossProfitCents: 400_000, negotiationAllowanceBasisPoints: 500, aging };
    // Day 59 is still inside the first full 30-day period past day 30.
    expect(computeRecommendedPricing({ landedCostCents: LANDED_COST, policy, daysInInventory: 59 }).agingDiscountCents).toBe(0);
    // Day 60 is one full period: 200bp of the 19,950 asking price = 399 cents.
    const onePeriod = computeRecommendedPricing({ landedCostCents: LANDED_COST, policy, daysInInventory: 60 });
    expect(onePeriod.agingDiscountCents).toBe(39_900);
    expect(onePeriod.asking.priceCents).toBe(1_955_100);
    expect(onePeriod.bindingConstraint).toBe("aging-adjustment");
    // Day 90 is two periods: 400bp = 79,800 cents.
    const twoPeriods = computeRecommendedPricing({ landedCostCents: LANDED_COST, policy, daysInInventory: 90 });
    expect(twoPeriods.agingDiscountCents).toBe(79_800);
    expect(twoPeriods.asking.priceCents).toBe(1_915_200);
    // Day 365 would be far more than 400bp, but the cap holds it at 400bp.
    const capped = computeRecommendedPricing({ landedCostCents: LANDED_COST, policy, daysInInventory: 365 });
    expect(capped.agingDiscountCents).toBe(79_800);
    expect(capped.asking.priceCents).toBe(1_915_200);
  });

  it("never lets the ageing discount push the price under the floor", () => {
    const policy = {
      minGrossProfitCents: 200_000,
      minRoiBasisPoints: 1_000,
      targetGrossProfitCents: 400_000,
      negotiationAllowanceBasisPoints: 500,
      // An extreme ageing policy: 2,000bp per 30 days, ten periods' worth.
      aging: { afterDays: 30, discountBasisPointsPer30Days: 2_000, maxDiscountBasisPoints: 20_000 },
    };
    const pricing = computeRecommendedPricing({ landedCostCents: LANDED_COST, policy, daysInInventory: 400 });
    // The discount is computed on 19,950 and would take 15,960 off, i.e. down to
    // 3,990 — far below the 17,000 floor — so the price is pinned at the floor.
    expect(pricing.agingDiscountCents).toBeGreaterThan(1_000_000);
    expect(pricing.minimumApproved.priceCents).toBe(1_700_000);
    expect(pricing.asking.priceCents).toBe(1_700_000);
    expect(pricing.asking.priceCents).toBeGreaterThanOrEqual(pricing.minimumApproved.priceCents);
    expect(pricing.asking.grossProfitCents).toBeGreaterThanOrEqual(200_000);
  });

  it("raises the asking price above the target by the negotiation allowance", () => {
    const pricing = computeRecommendedPricing({
      landedCostCents: LANDED_COST,
      policy: { ...base, negotiationAllowanceBasisPoints: 500 },
    });
    expect(pricing.target.priceCents).toBe(1_900_000);
    // 5% of 19,000 is 950 cents of room, and the asking price rounds up to the
    // next whole dollar: 19,000 + 95,000 = 19,950.
    expect(pricing.negotiationAllowanceCents).toBe(95_000);
    expect(pricing.asking.priceCents).toBe(1_995_000);
    expect(pricing.asking.priceCents).toBeGreaterThan(pricing.target.priceCents);
    expect(pricing.bindingConstraint).toBe("negotiation-allowance");

    // With no allowance the asking price is the target.
    const noRoom = computeRecommendedPricing({ landedCostCents: LANDED_COST, policy: base });
    expect(noRoom.negotiationAllowanceCents).toBe(0);
    expect(noRoom.asking.priceCents).toBe(noRoom.target.priceCents);
  });

  it("derives every tier's gross and ROI from the economics helpers", () => {
    const pricing = computeRecommendedPricing({
      landedCostCents: LANDED_COST,
      policy: { ...base, negotiationAllowanceBasisPoints: 500 },
      daysInInventory: 90,
    });
    for (const tier of [pricing.minimumApproved, pricing.target, pricing.asking]) {
      expect(tier.grossProfitCents).toBe(computeEstimatedGrossProfit(tier.priceCents, LANDED_COST));
      expect(tier.roiBasisPoints).toBe(computeRoiBasisPoints(tier.grossProfitCents, LANDED_COST));
    }
  });
});

describe("deal-structuring — structureDeal: CASH", () => {
  it("settles in full at delivery with no finance charge and no exposure", () => {
    const cash = deal({
      mode: "CASH",
      tradeInAllowanceCents: 500_000,
      // A down payment is meaningless in a cash sale: the whole balance settles.
      downPaymentCents: 999,
      aprBasisPoints: 2_400,
      termMonths: 60,
    });
    // 20,000 price - 5,000 trade-in allowance = 15,000 collected at delivery.
    expect(cash.amounts.amountDueCents).toBe(2_000_000);
    expect(cash.amounts.tradeInAllowanceCents).toBe(500_000);
    expect(cash.amounts.downPaymentCents).toBe(1_500_000);
    expect(cash.amounts.amountFinancedCents).toBe(0);
    expect(cash.financeChargeCents).toBe(0);
    expect(cash.projectedFinanceIncomeCents).toBe(0);
    expect(cash.totalOfPaymentsCents).toBe(0);
    expect(cash.numberOfPayments).toBe(0);
    expect(cash.paymentAmountCents).toBe(0);
    expect(cash.paymentQuoted).toBe(false);
    expect(cash.termMonths).toBe(0);
    expect(cash.dealerCapitalStillExposedCents).toBe(0);
    expect(cash.dealerCashReceivedAtClosingCents).toBe(1_500_000);
    // The vehicle's gross is a vehicle metric and is realised immediately.
    expect(cash.vehicleGrossCents).toBe(500_000);
    expect(cash.vehicleGrossRealizedAtClosing).toBe(true);
    expect(cash.lease).toBeNull();
    expect(cash.totalCustomerOutlayCents).toBe(1_500_000);
    expect(cash.totalCustomerOutlayWithOptionCents).toBeNull();
  });

  it("does not charge the customer a finance charge even when an APR is supplied", () => {
    // The APR argument is ignored for cash: there is no note to charge it on, so
    // the structure reports 0.00% and no money moves through a finance charge.
    const cash = deal({ mode: "CASH", aprBasisPoints: 2_400 });
    expect(cash.aprBasisPoints).toBe(0);
    expect(cash.financeChargeCents).toBe(0);
    expect(cash.projectedFinanceIncomeCents).toBe(0);
    expect(cash.paymentAmountCents).toBe(0);
    expect(cash.paymentQuoted).toBe(false);
    expect(cash.ratePolicy.aprBasisPoints).toBe(0);
  });
});

describe("deal-structuring — structureDeal: EXTERNAL_FINANCE", () => {
  it("has the lender advance the financed balance, so no dealer capital stays exposed", () => {
    const external = deal({ mode: "EXTERNAL_FINANCE" });
    // 20,000 price - 2,000 down = 18,000 financed by the lender.
    expect(external.amounts.amountFinancedCents).toBe(1_800_000);
    expect(external.numberOfPayments).toBe(60);
    expect(external.paymentAmountCents).toBe(34_799);
    // The dealer receives the down payment AND the lender's 18,000 advance.
    expect(external.dealerCashReceivedAtClosingCents).toBe(2_000_000);
    expect(external.dealerCapitalStillExposedCents).toBe(0);
    expect(external.vehicleGrossRealizedAtClosing).toBe(true);
    expect(external.riskFlags).not.toContain("DEALER_HELD_RECEIVABLE");
  });

  it("nets the trade-in payoff out of the cash received at closing", () => {
    const external = deal({
      mode: "EXTERNAL_FINANCE",
      tradeInAllowanceCents: 300_000,
      tradeInPayoffCents: 500_000,
    });
    // amount due 20,000, less the 2,000 down, less the 3,000 allowance = 15,000
    // advanced by the lender; plus 2,000 down, less the 5,000 lien payoff.
    expect(external.amounts.amountFinancedCents).toBe(1_500_000);
    expect(external.amounts.tradeEquityCents).toBe(-200_000);
    expect(external.dealerCashReceivedAtClosingCents).toBe(1_200_000);
    expect(external.dealerCapitalStillExposedCents).toBe(0);
  });
});

describe("deal-structuring — structureDeal: BUY_HERE_PAY_HERE", () => {
  const bhph = deal({
    mode: "BUY_HERE_PAY_HERE",
    aprBasisPoints: 2_400,
    salesTaxBasisPoints: 625,
  });

  it("keeps the financed principal exposed and books the finance charge separately", () => {
    // 20,000 + 6.25% tax of 1,250 = 21,250 due, less the 2,000 down = 19,250
    // carried by the dealership.
    expect(bhph.amounts.salesTaxCents).toBe(125_000);
    expect(bhph.amounts.amountFinancedCents).toBe(1_925_000);
    expect(bhph.dealerCapitalStillExposedCents).toBe(1_925_000);
    expect(bhph.dealerCashReceivedAtClosingCents).toBe(200_000);
    expect(bhph.vehicleGrossRealizedAtClosing).toBe(false);
    expect(bhph.riskFlags).toContain("DEALER_HELD_RECEIVABLE");
    expect(bhph.riskFlags).toContain("HIGH_APR");
    // The finance charge is projected finance INCOME, and is a separate field
    // from the vehicle's gross.
    expect(bhph.financeChargeCents).toBeGreaterThan(0);
    expect(bhph.projectedFinanceIncomeCents).toBe(bhph.financeChargeCents);
    expect(bhph.vehicleGrossCents).toBe(500_000);
    expect(bhph.combinedExpectedEconomicsCents).toBe(500_000 + bhph.financeChargeCents);
  });

  it("counts only the down payment as cash received at closing", () => {
    // Nothing else is collected at delivery: the rest is a receivable.
    expect(bhph.dealerCashReceivedAtClosingCents).toBe(bhph.amounts.downPaymentCents);
    // And because there IS a balance to collect, a real payment is quoted.
    expect(bhph.paymentQuoted).toBe(true);
    expect(bhph.paymentAmountCents).toBeGreaterThan(0);
    expect(bhph.totalOfPaymentsCents).toBe(bhph.amounts.amountFinancedCents + bhph.financeChargeCents);
  });

  it("charges more finance than the same deal financed by a lender", () => {
    const external = deal({ mode: "EXTERNAL_FINANCE", aprBasisPoints: 600, salesTaxBasisPoints: 625 });
    expect(bhph.financeChargeCents).toBeGreaterThan(external.financeChargeCents);
  });
});

describe("deal-structuring — structureDeal: LEASE and LEASE_TO_OWN", () => {
  const leaseInput: Partial<DealStructureInput> = {
    sellingPriceCents: PRICE,
    landedCostCents: LANDED_COST,
    downPaymentCents: 200_000,
    aprBasisPoints: 960,
    termMonths: 24,
    lease: { residualValueCents: 1_500_000 },
  };

  it("populates the lease fields and totals the depreciation plus rent charge", () => {
    const lease = deal({ mode: "LEASE", ...leaseInput });
    expect(lease.feasible).toBe(true);
    expect(lease.lease).not.toBeNull();
    // Gross cap cost 20,000, less the 2,000 cap cost reduction = 18,000
    // adjusted; less the 15,000 residual = 3,000 of depreciation over 24
    // payments at 960bp (a 0.0040 money factor).
    expect(lease.lease?.adjustedCapCostCents).toBe(1_800_000);
    expect(lease.lease?.residualValueCents).toBe(1_500_000);
    expect(lease.lease?.depreciationCents).toBe(300_000);
    expect(lease.lease?.rentChargeCents).toBe(316_800);
    expect(lease.lease?.moneyFactor).toBe(0.004);
    expect(lease.numberOfPayments).toBe(24);
    expect(lease.paymentAmountCents).toBe(25_700);
    expect(lease.totalOfPaymentsCents).toBe(616_800);
    expect(lease.amounts.amountFinancedCents).toBe(300_000);
    // The dealer keeps the vehicle on its books: 18,000 adjusted cap cost less
    // the 2,000 the customer paid in.
    expect(lease.dealerCapitalStillExposedCents).toBe(1_600_000);
    expect(lease.dealerCashReceivedAtClosingCents).toBe(200_000);
    expect(lease.vehicleGrossRealizedAtClosing).toBe(false);
    expect(lease.riskFlags).toContain("LEASE_RESIDUAL_RISK");
    expect(lease.riskFlags).toContain("LEASE_TAX_TREATMENT_NOT_COMPUTED");
    expect(lease.contractGeneration).toBe("ALLOWED");
    expect(lease.lease?.ownershipTransfer).toBe("PURCHASE_OPTION");
  });

  it("defaults the purchase option to the residual value and includes it in the outlay", () => {
    const lease = deal({ mode: "LEASE", ...leaseInput });
    expect(lease.lease?.purchaseOptionCents).toBe(1_500_000);
    // Outlay = 2,000 down + 6,168 of payments = 8,168; owning it adds the
    // 15,000 purchase option.
    expect(lease.totalCustomerOutlayCents).toBe(816_800);
    expect(lease.totalCustomerOutlayWithOptionCents).toBe(2_316_800);
    expect(lease.totalCustomerOutlayWithOptionCents).toBe(
      lease.totalCustomerOutlayCents + (lease.lease?.purchaseOptionCents ?? 0),
    );
  });

  it("honours an explicit purchase option and blocks the lease-to-own contract", () => {
    const leaseToOwn = deal({
      mode: "LEASE_TO_OWN",
      ...leaseInput,
      lease: { residualValueCents: 1_500_000, purchaseOptionCents: 250_000 },
    });
    expect(leaseToOwn.lease?.purchaseOptionCents).toBe(250_000);
    expect(leaseToOwn.totalCustomerOutlayWithOptionCents).toBe(816_800 + 250_000);
    expect(leaseToOwn.riskFlags).toContain("LEASE_RESIDUAL_RISK");
    expect(leaseToOwn.riskFlags).toContain("LEASE_TO_OWN_CONTRACT_BLOCKED");
    expect(leaseToOwn.contractGeneration).toBe("BLOCKED");
    expect(leaseToOwn.contractBlockedReason).toMatch(/ownership transfer and disclosure semantics/);
    // Ownership transfer cannot be stated yet, so it is not invented.
    expect(leaseToOwn.lease?.ownershipTransfer).toBe("NOT_DEFINED");
    // A plain lease, by contrast, may generate a contract.
    expect(deal({ mode: "LEASE", ...leaseInput }).contractGeneration).toBe("ALLOWED");
    expect(deal({ mode: "LEASE", ...leaseInput }).contractBlockedReason).toBeNull();
  });

  it("does not compute sales tax inside a lease", () => {
    // Lease taxation is jurisdiction-specific, so the engine refuses to invent
    // it and flags that it has not been computed.
    const lease = deal({ mode: "LEASE", ...leaseInput, salesTaxBasisPoints: 625 });
    expect(lease.amounts.salesTaxCents).toBe(0);
    expect(lease.riskFlags).toContain("LEASE_TAX_TREATMENT_NOT_COMPUTED");
  });
});

describe("deal-structuring — feasibility never throws and never fabricates", () => {
  it("marks a financed mode with no term infeasible and explains why", () => {
    const noTerm = deal({ mode: "EXTERNAL_FINANCE", termMonths: undefined });
    expect(noTerm.feasible).toBe(false);
    expect(noTerm.unavailableReason).toBe("A term in months is required to schedule payments.");
    expect(noTerm.paymentAmountCents).toBe(0);
    expect(noTerm.numberOfPayments).toBe(0);
    expect(noTerm.financeChargeCents).toBe(0);
    expect(noTerm.score).toBeNull();
  });

  it("marks a financed mode with no rate infeasible, but accepts an explicit 0%", () => {
    const noRate = deal({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: undefined });
    expect(noRate.feasible).toBe(false);
    expect(noRate.unavailableReason).toBe("A rate is required to quote payments on a financed structure.");
    expect(noRate.paymentAmountCents).toBe(0);
    expect(noRate.score).toBeNull();

    // A deliberate 0% promotion IS a rate, and must quote payments.
    const zeroPromo = deal({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 0 });
    expect(zeroPromo.feasible).toBe(true);
    expect(zeroPromo.paymentAmountCents).toBe(30_000);
    expect(zeroPromo.financeChargeCents).toBe(0);
    expect(zeroPromo.paymentQuoted).toBe(true);
  });

  it("marks a lease with no residual value infeasible", () => {
    const noResidual = deal({ mode: "LEASE", aprBasisPoints: 960, termMonths: 24 });
    expect(noResidual.feasible).toBe(false);
    expect(noResidual.unavailableReason).toBe("A lease needs a contractual residual value.");
    expect(noResidual.lease).toBeNull();
    expect(noResidual.paymentAmountCents).toBe(0);
    expect(noResidual.totalOfPaymentsCents).toBe(0);
    expect(noResidual.score).toBeNull();
  });

  it("marks a lease with no term infeasible", () => {
    const noTerm = deal({ mode: "LEASE", termMonths: 0, lease: { residualValueCents: 1_500_000 } });
    expect(noTerm.feasible).toBe(false);
    expect(noTerm.unavailableReason).toBe("A term in months is required to schedule lease payments.");
  });

  it("never throws for any combination of missing terms across every mode", () => {
    for (const mode of DEAL_PAYMENT_MODES) {
      expect(() => structureDeal({ mode, sellingPriceCents: PRICE, landedCostCents: LANDED_COST })).not.toThrow();
      expect(() =>
        structureDeal({ mode, sellingPriceCents: 0, landedCostCents: 0, termMonths: 0 }),
      ).not.toThrow();
    }
  });

  it("withholds a quote when nothing is actually financed", () => {
    // An over-paid deal finances 0: there is no schedule to quote, so the
    // structure must not present a payment of 0 as if it were a real quote.
    const overPaid = deal({ mode: "EXTERNAL_FINANCE", downPaymentCents: 3_000_000 });
    expect(overPaid.feasible).toBe(true);
    expect(overPaid.amounts.amountFinancedCents).toBe(0);
    expect(overPaid.paymentAmountCents).toBe(0);
    expect(overPaid.finalPaymentCents).toBe(0);
    expect(overPaid.financeChargeCents).toBe(0);
    expect(overPaid.totalOfPaymentsCents).toBe(0);
    expect(overPaid.paymentQuoted).toBe(false);
    // With no receivable there is no exposure and no finance income.
    expect(overPaid.dealerCapitalStillExposedCents).toBe(0);
    expect(overPaid.projectedFinanceIncomeCents).toBe(0);
    expect(overPaid.dealerCashReceivedAtClosingCents).toBe(3_000_000);
  });

  it("reports finance types that mirror the Prisma FinanceType values", () => {
    expect(financeTypeForMode("CASH")).toBe("CASH");
    expect(financeTypeForMode("EXTERNAL_FINANCE")).toBe("FINANCE");
    expect(financeTypeForMode("BUY_HERE_PAY_HERE")).toBe("BUY_HERE_PAY_HERE");
    expect(financeTypeForMode("LEASE")).toBe("LEASE");
    expect(financeTypeForMode("LEASE_TO_OWN")).toBe("LEASE_TO_OWN");
  });
});

describe("deal-structuring — the separation that must never break", () => {
  it("keeps vehicleGrossCents at price - landedCost no matter what the finance does", () => {
    for (const aprBasisPoints of [0, 600, 1_200, 2_400]) {
      for (const termMonths of [24, 36, 60, 72]) {
        for (const downPaymentCents of [0, 200_000, 1_000_000]) {
          const structure = deal({
            mode: "BUY_HERE_PAY_HERE",
            aprBasisPoints,
            termMonths,
            downPaymentCents,
          });
          expect(structure.vehicleGrossCents, `apr ${aprBasisPoints} term ${termMonths} down ${downPaymentCents}`).toBe(
            computeEstimatedGrossProfit(PRICE, LANDED_COST),
          );
          expect(structure.vehicleGrossCents).toBe(500_000);
          // The gross is a pure function of price and cost: it says nothing
          // about the note, however large the finance charge grows.
          expect(structure.vehicleGrossCents).toBe(computeEstimatedGrossProfit(PRICE, LANDED_COST));
          expect(structure.vehicleGrossCents).toBe(PRICE - LANDED_COST);
        }
      }
    }
  });

  it("moves the finance charge when only the APR changes, and leaves the gross alone", () => {
    const atSix = deal({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 600, termMonths: 60 });
    const atTwentyFour = deal({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 2_400, termMonths: 60 });
    expect(atTwentyFour.financeChargeCents).toBeGreaterThan(atSix.financeChargeCents);
    expect(atTwentyFour.paymentAmountCents).toBeGreaterThan(atSix.paymentAmountCents);
    expect(atSix.vehicleGrossCents).toBe(500_000);
    expect(atTwentyFour.vehicleGrossCents).toBe(500_000);
    expect(atSix.projectedFinanceIncomeCents).toBe(atSix.financeChargeCents);
    expect(atTwentyFour.projectedFinanceIncomeCents).toBe(atTwentyFour.financeChargeCents);
  });

  it("reports the finance charge as projected finance income in its own field", () => {
    const bhph = deal({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 2_400 });
    // Two separate fields, two separate metrics: the combined figure is
    // presentation-only and is exactly their sum.
    expect(bhph.projectedFinanceIncomeCents).toBe(bhph.financeChargeCents);
    expect(bhph.combinedExpectedEconomicsCents).toBe(bhph.vehicleGrossCents! + bhph.projectedFinanceIncomeCents);
  });

  it("does not let the down payment change the gross or corrupt the financed amount", () => {
    const small = deal({ mode: "BUY_HERE_PAY_HERE", downPaymentCents: 100_000 });
    const large = deal({ mode: "BUY_HERE_PAY_HERE", downPaymentCents: 900_000 });
    expect(small.vehicleGrossCents).toBe(large.vehicleGrossCents);
    expect(small.amounts.amountFinancedCents).toBe(1_900_000);
    expect(large.amounts.amountFinancedCents).toBe(1_100_000);
  });

  it("exposes the separation in the comparison columns", () => {
    const columns = dealStructureColumns(deal({ mode: "BUY_HERE_PAY_HERE" }));
    expect(columns.vehicleGrossCents).toBe(500_000);
    expect(columns.estimatedFinanceIncomeCents).toBe(columns.combinedExpectedEconomicsCents! - 500_000);
    expect(columns.paymentsPerYear).toBe(12);
    expect(columns.cashReceivedAtClosingCents).toBe(200_000);
    expect(columns.capitalStillExposedCents).toBe(1_800_000);
  });
});

describe("deal-structuring — the masked viewer never sees a fabricated gross", () => {
  const masked = deal({ mode: "EXTERNAL_FINANCE", landedCostCents: null });

  it("returns null economics rather than a gross computed against a cost of zero", () => {
    // Null is NOT zero. If the mask were treated as a cost of 0 the viewer
    // would be told the gross was the entire selling price.
    expect(masked.vehicleGrossCents).toBeNull();
    expect(masked.vehicleGrossCents).not.toBe(PRICE - 0);
    expect(masked.combinedExpectedEconomicsCents).toBeNull();
    expect(masked.score).toBeNull();
  });

  it("does not raise a flag it cannot substantiate", () => {
    // UNDERWATER_GROSS is a statement about cost versus price; with no cost
    // basis there is nothing to state.
    expect(masked.riskFlags).not.toContain("UNDERWATER_GROSS");
  });

  it("still costs the CUSTOMER's contract in full", () => {
    // Only the dealer economics are withheld.
    expect(masked.feasible).toBe(true);
    expect(masked.paymentAmountCents).toBe(34_799);
    expect(masked.financeChargeCents).toBe(287_941);
    expect(masked.amounts.amountFinancedCents).toBe(1_800_000);
    expect(masked.projectedFinanceIncomeCents).toBe(287_941);
  });

  it("produces no recommendation and says why", () => {
    const comparison = compareDealStructures([
      { mode: "EXTERNAL_FINANCE", sellingPriceCents: PRICE, landedCostCents: null, downPaymentCents: 200_000, aprBasisPoints: 600, termMonths: 60 },
      { mode: "CASH", sellingPriceCents: PRICE, landedCostCents: null },
    ]);
    expect(comparison.recommended).toBeNull();
    expect(comparison.ranked).toEqual([]);
    expect(comparison.headline).toBe("NO RANKING — DEAL ECONOMICS NOT VISIBLE TO THIS ROLE");
    expect(comparison.reasons.join(" ")).toMatch(/cost basis is not visible to your role/);
    // Every structure is still returned with its customer terms.
    expect(comparison.structures).toHaveLength(2);
    expect(comparison.structures.every((structure) => structure.vehicleGrossCents === null)).toBe(true);
  });
});

describe("deal-structuring — risk flags", () => {
  it("flags a zero down payment on a financed deal", () => {
    const structure = deal({ mode: "BUY_HERE_PAY_HERE", downPaymentCents: 0 });
    expect(structure.riskFlags).toContain("ZERO_DOWN_PAYMENT");
    expect(structure.riskFlags).not.toContain("LOW_DOWN_PAYMENT");
  });

  it("flags a thin down payment below 10% of the amount due", () => {
    // 500 of 20,000 is 2.5%, well under the 1,000bp threshold.
    const thin = deal({ mode: "BUY_HERE_PAY_HERE", downPaymentCents: 50_000 });
    expect(RISK_THRESHOLDS.lowDownPaymentBasisPoints).toBe(1_000);
    expect(thin.riskFlags).toContain("LOW_DOWN_PAYMENT");
    expect(thin.riskFlags).not.toContain("ZERO_DOWN_PAYMENT");

    // 2,000 of 20,000 is 10%, so it is NOT thin.
    const adequate = deal({ mode: "BUY_HERE_PAY_HERE", downPaymentCents: 200_000 });
    expect(adequate.riskFlags).not.toContain("LOW_DOWN_PAYMENT");
  });

  it("flags a high APR at or above the threshold", () => {
    expect(RISK_THRESHOLDS.highAprBasisPoints).toBe(1_800);
    expect(deal({ mode: "EXTERNAL_FINANCE", aprBasisPoints: 1_799 }).riskFlags).not.toContain("HIGH_APR");
    expect(deal({ mode: "EXTERNAL_FINANCE", aprBasisPoints: 1_800 }).riskFlags).toContain("HIGH_APR");
    expect(deal({ mode: "EXTERNAL_FINANCE", aprBasisPoints: 2_400 }).riskFlags).toContain("HIGH_APR");
  });

  it("flags a long term at or above the threshold", () => {
    expect(RISK_THRESHOLDS.longTermMonths).toBe(72);
    expect(deal({ mode: "EXTERNAL_FINANCE", termMonths: 71 }).riskFlags).not.toContain("LONG_TERM");
    expect(deal({ mode: "EXTERNAL_FINANCE", termMonths: 72 }).riskFlags).toContain("LONG_TERM");
    expect(deal({ mode: "EXTERNAL_FINANCE", termMonths: 84 }).riskFlags).toContain("LONG_TERM");
  });

  it("flags a dealer-held receivable only when the dealership holds it", () => {
    expect(deal({ mode: "BUY_HERE_PAY_HERE" }).riskFlags).toContain("DEALER_HELD_RECEIVABLE");
    expect(deal({ mode: "EXTERNAL_FINANCE" }).riskFlags).not.toContain("DEALER_HELD_RECEIVABLE");
    expect(deal({ mode: "CASH" }).riskFlags).not.toContain("DEALER_HELD_RECEIVABLE");
    expect(deal({ mode: "LEASE" }).riskFlags).not.toContain("DEALER_HELD_RECEIVABLE");
  });

  it("flags negative equity when the trade is worth less than its payoff", () => {
    const negative = deal({
      mode: "EXTERNAL_FINANCE",
      tradeInAllowanceCents: 300_000,
      tradeInPayoffCents: 500_000,
    });
    expect(negative.amounts.tradeEquityCents).toBe(-200_000);
    expect(negative.riskFlags).toContain("NEGATIVE_EQUITY_TRADE");

    const positive = deal({
      mode: "EXTERNAL_FINANCE",
      tradeInAllowanceCents: 500_000,
      tradeInPayoffCents: 300_000,
    });
    expect(positive.amounts.tradeEquityCents).toBe(200_000);
    expect(positive.riskFlags).not.toContain("NEGATIVE_EQUITY_TRADE");
  });

  it("flags an underwater gross when the price does not cover the cost", () => {
    const underwater = deal({ mode: "EXTERNAL_FINANCE", sellingPriceCents: 1_000_000 });
    expect(underwater.vehicleGrossCents).toBe(-500_000);
    expect(underwater.riskFlags).toContain("UNDERWATER_GROSS");

    // Break-even also counts: no gross profit at this price.
    const breakEven = deal({ mode: "EXTERNAL_FINANCE", sellingPriceCents: LANDED_COST });
    expect(breakEven.vehicleGrossCents).toBe(0);
    expect(breakEven.riskFlags).toContain("UNDERWATER_GROSS");
  });

  it("flags a missing rate policy for financed deals, but not for cash", () => {
    // No policy is configured in this repository, so every financed structure is
    // running without a ceiling — and says so.
    expect(deal({ mode: "EXTERNAL_FINANCE" }).riskFlags).toContain("NO_CONFIGURED_RATE_POLICY");
    expect(deal({ mode: "BUY_HERE_PAY_HERE" }).riskFlags).toContain("NO_CONFIGURED_RATE_POLICY");
    expect(deal({ mode: "LEASE" }).riskFlags).toContain("NO_CONFIGURED_RATE_POLICY");
    // A cash sale carries no rate, so there is no ceiling to miss.
    expect(deal({ mode: "CASH" }).riskFlags).not.toContain("NO_CONFIGURED_RATE_POLICY");
  });

  it("labels every flag it reports", () => {
    const structure = deal({ mode: "BUY_HERE_PAY_HERE", aprBasisPoints: 2_400, termMonths: 84, downPaymentCents: 0 });
    expect(structure.riskLabels).toHaveLength(structure.riskFlags.length);
    for (const label of structure.riskLabels) {
      expect(label).toMatch(/[A-Za-z]/);
    }
    expect(structure.riskLabels).toContain("Dealer carries the receivable");
    expect(structure.riskLabels).toContain("High rate");
  });

  it("treats negative amortization as a blocking flag", () => {
    // The only flag severe enough to say the structure is not sound.
    expect(BLOCKING_DEAL_RISK_FLAGS).toEqual(["NEGATIVE_AMORTIZATION"]);
  });
});

describe("deal-structuring — configured rate-policy integration", () => {
  const withPolicy = (aprBasisPoints: number): DealStructure =>
    deal({
      mode: "EXTERNAL_FINANCE",
      aprBasisPoints,
      termMonths: 60,
      ratePolicy: { policies: [POLICY], jurisdiction: "TX", asOf: "2025-06-01" },
    });

  it("is within policy one basis point below the ceiling", () => {
    const structure = withPolicy(1_799);
    expect(structure.ratePolicy.status).toBe(WITHIN_RATE_POLICY);
    expect(structure.ratePolicy.withinConfiguredRatePolicy).toBe(true);
    expect(structure.ratePolicy.policyId).toBe("TX-USED-2025");
    expect(structure.ratePolicy.policyCeilingBasisPoints).toBe(1_800);
    expect(structure.riskFlags).not.toContain("ABOVE_CONFIGURED_RATE_POLICY");
    expect(structure.riskFlags).not.toContain("NO_CONFIGURED_RATE_POLICY");
  });

  it("is within policy exactly at the ceiling", () => {
    const structure = withPolicy(1_800);
    expect(structure.ratePolicy.status).toBe(WITHIN_RATE_POLICY);
    expect(structure.ratePolicy.withinConfiguredRatePolicy).toBe(true);
    expect(structure.riskFlags).not.toContain("ABOVE_CONFIGURED_RATE_POLICY");
  });

  it("is above policy one basis point over the ceiling, and flags it", () => {
    const structure = withPolicy(1_801);
    expect(structure.ratePolicy.status).toBe(ABOVE_RATE_POLICY);
    expect(structure.ratePolicy.withinConfiguredRatePolicy).toBe(false);
    expect(structure.riskFlags).toContain("ABOVE_CONFIGURED_RATE_POLICY");
    expect(structure.ratePolicy.statement).toMatch(/above the configured rate policy/);
  });
});

describe("deal-structuring — compareDealStructures", () => {
  const base = {
    sellingPriceCents: PRICE,
    landedCostCents: LANDED_COST,
    downPaymentCents: 200_000,
    termMonths: 60,
  };
  const externalInput: DealStructureInput = { mode: "EXTERNAL_FINANCE", ...base, aprBasisPoints: 600 };
  const bhphInput: DealStructureInput = { mode: "BUY_HERE_PAY_HERE", ...base, aprBasisPoints: 2_400 };

  it("ranks external finance above buy-here-pay-here even though BHPH earns more interest", () => {
    const comparison = compareDealStructures([externalInput, bhphInput]);
    expect(comparison.recommended?.mode).toBe("EXTERNAL_FINANCE");
    expect(comparison.headline).toBe("RECOMMENDED: EXTERNAL FINANCE");

    const external = comparison.structures.find((structure) => structure.mode === "EXTERNAL_FINANCE")!;
    const bhph = comparison.structures.find((structure) => structure.mode === "BUY_HERE_PAY_HERE")!;
    // The "highest interest is not best" rule: the losing structure has 4.5x
    // the finance charge and still loses, because capital recovery, immediate
    // cash and margin outweigh risk-adjusted finance income.
    expect(bhph.financeChargeCents).toBeGreaterThan(external.financeChargeCents * 4);
    expect(bhph.combinedExpectedEconomicsCents!).toBeGreaterThan(external.combinedExpectedEconomicsCents!);
    expect(external.score!.total).toBeGreaterThan(bhph.score!.total);
    expect(external.score!.capitalVelocity).toBe(1_000);
    expect(bhph.score!.capitalVelocity).toBe(100);
    // The gross is identical; only the finance side differs.
    expect(external.vehicleGrossCents).toBe(bhph.vehicleGrossCents);
  });

  it("is deterministic and independent of the order the inputs arrive in", () => {
    const forward = compareDealStructures([externalInput, bhphInput]);
    const reversed = compareDealStructures([bhphInput, externalInput]);
    expect(forward.recommended?.mode).toBe(reversed.recommended?.mode);
    expect(forward.headline).toBe(reversed.headline);
    expect(forward.ranked.map((structure) => structure.mode)).toEqual(
      reversed.ranked.map((structure) => structure.mode),
    );
    expect(forward.ranked.map((structure) => structure.score?.total)).toEqual(
      reversed.ranked.map((structure) => structure.score?.total),
    );
  });

  it("ranks by score descending and breaks ties by the fixed mode order", () => {
    const allModes: DealStructureInput[] = [
      externalInput,
      bhphInput,
      { mode: "CASH", sellingPriceCents: PRICE, landedCostCents: LANDED_COST, downPaymentCents: 200_000 },
    ];
    const comparison = compareDealStructures(allModes);
    const totals = comparison.ranked.map((structure) => structure.score!.total);
    for (let index = 1; index < totals.length; index += 1) {
      expect(totals[index]!).toBeLessThanOrEqual(totals[index - 1]!);
    }
    // Ties follow DEAL_PAYMENT_MODES: CASH, EXTERNAL_FINANCE, BHPH, LEASE, LTO.
    for (let index = 1; index < comparison.ranked.length; index += 1) {
      const previous = comparison.ranked[index - 1]!;
      const current = comparison.ranked[index]!;
      if (previous.score!.total === current.score!.total) {
        expect(DEAL_PAYMENT_MODES.indexOf(previous.mode)).toBeLessThan(
          DEAL_PAYMENT_MODES.indexOf(current.mode),
        );
      }
    }
  });

  it("scores a dealer-held structure a lower creditRisk than a lender-funded one", () => {
    const external = structureDeal({ ...externalInput, aprBasisPoints: 2_400 });
    const dealerHeld = structureDeal({ ...bhphInput, aprBasisPoints: 2_400 });
    // Same APR, same term, same cash structure: the only difference is who
    // carries the receivable, and that is exactly what creditRisk measures.
    expect(external.financeChargeCents).toBe(dealerHeld.financeChargeCents);
    expect(external.score!.creditRisk).toBe(1_000);
    expect(dealerHeld.score!.creditRisk).toBe(610);
    expect(dealerHeld.score!.creditRisk).toBeLessThan(external.score!.creditRisk);
  });

  it("leaves structures ranking-free when it has no score to rank them on", () => {
    const unscored = structureDeal({ ...externalInput, landedCostCents: null });
    expect(unscored.score).toBeNull();
    expect(rankDealStructures([unscored])).toEqual([]);
  });

  it("lists the modes it could not build, and why", () => {
    const comparison = compareDealStructures([
      externalInput,
      { mode: "LEASE", sellingPriceCents: PRICE, landedCostCents: LANDED_COST, aprBasisPoints: 960, termMonths: 24 },
      { mode: "BUY_HERE_PAY_HERE", sellingPriceCents: PRICE, landedCostCents: LANDED_COST },
    ]);
    expect(comparison.unavailable).toHaveLength(2);
    expect(comparison.unavailable.map((entry) => entry.mode).sort()).toEqual(["BUY_HERE_PAY_HERE", "LEASE"]);
    for (const entry of comparison.unavailable) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
    expect(comparison.recommended?.mode).toBe("EXTERNAL_FINANCE");
  });

  it("recommends nothing when no structure can be built", () => {
    const comparison = compareDealStructures([
      { mode: "EXTERNAL_FINANCE", sellingPriceCents: PRICE, landedCostCents: LANDED_COST },
    ]);
    expect(comparison.recommended).toBeNull();
    expect(comparison.headline).toBe("NO RECOMMENDATION — NO FEASIBLE STRUCTURE");
    expect(comparison.reasons.join(" ")).toMatch(/No structure could be built/);
  });

  it("explains the winner without quoting any cost figure", () => {
    const comparison = compareDealStructures([externalInput, bhphInput]);
    const explanation = comparison.reasons.join(" ");
    // The sentences are shown to roles masked out of the cost basis, so they
    // must never carry vehicle gross, margin or ROI.
    expect(explanation).not.toMatch(/gross profit/i);
    expect(explanation).toMatch(/Full vehicle capital is recovered at closing/);
    expect(explanation).toMatch(/Ranked ahead of Buy here, pay here/);
  });

  it("uses scoring weights that sum to 10,000 basis points", () => {
    const total = Object.values(DEFAULT_DEAL_SCORING_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(10_000);
    // Capital velocity and immediate cash recovery dominate finance income.
    expect(DEFAULT_DEAL_SCORING_WEIGHTS.capitalVelocity + DEFAULT_DEAL_SCORING_WEIGHTS.immediateCashRecovery).toBeGreaterThan(
      DEFAULT_DEAL_SCORING_WEIGHTS.riskAdjustedFinanceIncome,
    );
  });

  it("applies the scoring weights the caller passes to every structure it compares", () => {
    // FIXED DURING PHASE 9B: this test originally asserted the opposite — that
    // the ranking ignored the `scoring` argument — because the argument was
    // accepted, typed and then discarded. It now asserts the behaviour the
    // signature promises: the weights reach every structure.
    const weights = {
      capitalVelocity: 10_000,
      immediateCashRecovery: 0,
      margin: 0,
      capitalExposure: 0,
      creditRisk: 0,
      termLength: 0,
      riskAdjustedFinanceIncome: 0,
    };
    const weighted = compareDealStructures([externalInput, bhphInput], weights);
    const external = weighted.structures.find((structure) => structure.mode === "EXTERNAL_FINANCE")!;
    const bhph = weighted.structures.find((structure) => structure.mode === "BUY_HERE_PAY_HERE")!;

    // The override reached every structure, not just the first.
    expect(external.score?.weights.capitalVelocity).toBe(10_000);
    expect(bhph.score?.weights.capitalVelocity).toBe(10_000);

    // With capital velocity as the only weighted dimension, the structure that
    // releases all the capital wins outright.
    expect(weighted.ranked[0]?.mode).toBe("EXTERNAL_FINANCE");
    expect(weighted.ranked[0]?.score?.total).toBe(1_000);

    // Determinism is independent of argument order.
    const reversed = compareDealStructures([bhphInput, externalInput], weights);
    expect(reversed.ranked.map((structure) => structure.mode)).toEqual(
      weighted.ranked.map((structure) => structure.mode),
    );

    // Weighting never touches the contract arithmetic.
    expect(bhph.dealerCashReceivedAtClosingCents).toBe(200_000);
    expect(bhph.financeChargeCents).toBeGreaterThan(external.financeChargeCents);
    expect(bhph.vehicleGrossCents).toBe(external.vehicleGrossCents);
  });

  it("applies an explicit scoring override to every structure it compares", () => {
    // FIXED DURING PHASE 9B. Before the fix, `compareDealStructures` built each
    // structure without threading its `scoring` argument through, so a caller
    // who passed weights silently got the DEFAULT ranking, and
    // `rankDealStructures` never read its own `_scoring` parameter.
    const weighted = compareDealStructures([externalInput, bhphInput], {
      capitalVelocity: 10_000,
      immediateCashRecovery: 0,
      margin: 0,
      capitalExposure: 0,
      creditRisk: 0,
      termLength: 0,
      riskAdjustedFinanceIncome: 0,
    });
    expect(weighted.ranked[0]?.score?.weights.capitalVelocity).toBe(10_000);
    expect(weighted.ranked[0]?.score?.total).toBe(1_000);
  });

  it("does not let a large finance charge outrank a fully recovered position", () => {
    // The rule the DEFAULT weights encode, stated as an upper bound: even with
    // BHPH earning more than four times the finance charge, the default ranking
    // never puts it first. This is the "highest interest is not the best deal"
    // requirement, proved on the default weights rather than asserted in prose.
    const comparison = compareDealStructures([bhphInput, externalInput]);
    const bhph = comparison.structures.find((structure) => structure.mode === "BUY_HERE_PAY_HERE")!;
    const external = comparison.structures.find((structure) => structure.mode === "EXTERNAL_FINANCE")!;
    expect(bhph.score!.riskAdjustedFinanceIncome).toBeGreaterThan(external.score!.riskAdjustedFinanceIncome);
    expect(comparison.recommended?.mode).toBe("EXTERNAL_FINANCE");
  });

  it("applies an explicit scoring override when it is passed to structureDeal", () => {
    // The supported path, and the one a caller should use today: the override is
    // honoured per structure, and the contract arithmetic is untouched by it.
    const external = structureDeal({
      ...externalInput,
      scoring: {
        capitalVelocity: 10_000,
        immediateCashRecovery: 0,
        margin: 0,
        capitalExposure: 0,
        creditRisk: 0,
        termLength: 0,
        riskAdjustedFinanceIncome: 0,
      },
    });
    expect(external.score?.weights.capitalVelocity).toBe(10_000);
    expect(external.score?.total).toBe(1_000);
    expect(external.financeChargeCents).toBe(287_941);
    expect(external.vehicleGrossCents).toBe(500_000);
  });
});
