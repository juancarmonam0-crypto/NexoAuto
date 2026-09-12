import { describe, expect, it } from "vitest";
import {
  computeActualGrossProfit,
  computeDaysInInventory,
  computeEstimatedGrossProfit,
  computeLandedCost,
  computeRoiBasisPoints,
  computeVehicleEconomics,
  resolveReconCost,
  rollUpInventory,
} from "@/lib/economics";

/** Acquisition cost block: $15,000 + $500 fees + $300 transport + $100 inspection + $50 other */
const ACQUISITION = {
  acquisitionPriceCents: 1_500_000,
  auctionFeesCents: 50_000,
  transportationCents: 30_000,
  inspectionCents: 10_000,
  otherAcquisitionCents: 5_000,
};
const ACQUISITION_BLOCK_CENTS = 1_595_000;

/** Item 1 completed over estimate ($250 actual vs $200), item 2 still an estimate ($100). */
const RECON_ITEMS = [
  { estimateCents: 20_000, actualCostCents: 25_000 },
  { estimateCents: 10_000 },
];
const ITEMIZED_RECON_CENTS = 35_000;
const OUTSTANDING_RECON_CENTS = 10_000;

const ADDITIONAL_EXPENSES_CENTS = 7_500;

describe("economics — landed cost", () => {
  it("sums every acquisition component plus recon and additional expenses", () => {
    const result = computeLandedCost({
      acquisition: ACQUISITION,
      reconItems: RECON_ITEMS,
      additionalExpenseCents: ADDITIONAL_EXPENSES_CENTS,
    });

    expect(result.acquisitionPriceCents).toBe(1_500_000);
    expect(result.auctionFeesCents).toBe(50_000);
    expect(result.transportationCents).toBe(30_000);
    expect(result.inspectionCents).toBe(10_000);
    expect(result.otherAcquisitionCents).toBe(5_000);
    expect(result.reconCents).toBe(ITEMIZED_RECON_CENTS);
    expect(result.additionalExpenseCents).toBe(ADDITIONAL_EXPENSES_CENTS);
    expect(result.landedCostCents).toBe(1_637_500);
    expect(result.landedCostCents).toBe(
      ACQUISITION_BLOCK_CENTS + ITEMIZED_RECON_CENTS + ADDITIONAL_EXPENSES_CENTS,
    );
  });

  it("exposes the breakdown components so the UI can explain the number", () => {
    const result = computeLandedCost({
      acquisition: ACQUISITION,
      reconItems: RECON_ITEMS,
      additionalExpenseCents: ADDITIONAL_EXPENSES_CENTS,
    });
    expect(result.reconSource).toBe("recon-items");
    expect(result.itemizedReconCents).toBe(ITEMIZED_RECON_CENTS);
    expect(result.outstandingReconEstimateCents).toBe(OUTSTANDING_RECON_CENTS);
  });

  it("defaults every optional cost to zero", () => {
    const result = computeLandedCost({ acquisition: { acquisitionPriceCents: 1_000_000 } });
    expect(result.auctionFeesCents).toBe(0);
    expect(result.transportationCents).toBe(0);
    expect(result.inspectionCents).toBe(0);
    expect(result.otherAcquisitionCents).toBe(0);
    expect(result.reconCents).toBe(0);
    expect(result.additionalExpenseCents).toBe(0);
    expect(result.reconSource).toBe("none");
    expect(result.landedCostCents).toBe(1_000_000);
  });

  it("clamps negative optional costs to zero instead of crediting them", () => {
    const result = computeLandedCost({
      acquisition: {
        acquisitionPriceCents: 1_000_000,
        auctionFeesCents: -50_000,
        transportationCents: -1,
        inspectionCents: -10_000,
        otherAcquisitionCents: -1,
      },
      additionalExpenseCents: -1_000,
    });
    expect(result.auctionFeesCents).toBe(0);
    expect(result.transportationCents).toBe(0);
    expect(result.inspectionCents).toBe(0);
    expect(result.otherAcquisitionCents).toBe(0);
    expect(result.additionalExpenseCents).toBe(0);
    expect(result.landedCostCents).toBe(1_000_000);
  });

  it("rejects a negative or fractional acquisition price rather than coercing it", () => {
    expect(() => computeLandedCost({ acquisition: { acquisitionPriceCents: -1 } })).toThrow(RangeError);
    expect(() => computeLandedCost({ acquisition: { acquisitionPriceCents: 1.5 } })).toThrow(RangeError);
  });
});

describe("economics — recon items versus recon override", () => {
  it("uses the actual cost when recorded and the estimate when it is not", () => {
    const result = resolveReconCost(RECON_ITEMS);
    expect(result.reconCents).toBe(35_000);
    expect(result.source).toBe("recon-items");
    expect(result.itemizedCents).toBe(35_000);
    expect(result.outstandingEstimateCents).toBe(10_000);
  });

  it("prefers a staff override over the itemised total", () => {
    const result = computeLandedCost({
      acquisition: ACQUISITION,
      reconItems: RECON_ITEMS,
      reconOverrideCents: 40_000,
      additionalExpenseCents: ADDITIONAL_EXPENSES_CENTS,
    });
    expect(result.reconCents).toBe(40_000);
    expect(result.reconSource).toBe("override");
    // The itemised figure is still reported so the override can be justified.
    expect(result.itemizedReconCents).toBe(ITEMIZED_RECON_CENTS);
    expect(result.landedCostCents).toBe(1_642_500);
  });

  it("treats an override of exactly zero as a real override, not as absent", () => {
    const result = computeLandedCost({
      acquisition: ACQUISITION,
      reconItems: RECON_ITEMS,
      reconOverrideCents: 0,
    });
    expect(result.reconSource).toBe("override");
    expect(result.reconCents).toBe(0);
    expect(result.landedCostCents).toBe(ACQUISITION_BLOCK_CENTS);
  });

  it("falls back to items when the override is null or undefined", () => {
    expect(resolveReconCost(RECON_ITEMS, null).source).toBe("recon-items");
    expect(resolveReconCost(RECON_ITEMS, undefined).source).toBe("recon-items");
  });

  it("reports no recon source when there are no items and no override", () => {
    const result = resolveReconCost([]);
    expect(result).toEqual({
      reconCents: 0,
      source: "none",
      itemizedCents: 0,
      outstandingEstimateCents: 0,
    });
  });

  it("treats a zero-cost completed item as a real zero rather than falling through", () => {
    const result = resolveReconCost([{ estimateCents: 15_000, actualCostCents: 0 }]);
    expect(result.reconCents).toBe(0);
    expect(result.outstandingEstimateCents).toBe(0);
  });
});

describe("economics — gross profit", () => {
  it("computes estimated gross profit as expected sale price minus landed cost", () => {
    expect(computeEstimatedGrossProfit(2_000_000, 1_637_500)).toBe(362_500);
  });

  it("computes actual gross profit as final sale price minus landed cost", () => {
    expect(computeActualGrossProfit(1_950_000, 1_637_500)).toBe(312_500);
  });

  it("reports a loss as a negative figure rather than clamping to zero", () => {
    expect(computeEstimatedGrossProfit(1_000_000, 1_637_500)).toBe(-637_500);
    expect(computeActualGrossProfit(0, 1_637_500)).toBe(-1_637_500);
  });
});

describe("economics — ROI in basis points", () => {
  it("expresses gross profit over landed cost in basis points", () => {
    expect(computeRoiBasisPoints(362_500, 1_637_500)).toBe(2214); // 22.1374% -> 2214 bp
    expect(computeRoiBasisPoints(312_500, 1_637_500)).toBe(1908); // 19.0839% -> 1908 bp
    expect(computeRoiBasisPoints(1_000_000, 1_000_000)).toBe(10_000); // exactly 100%
    expect(computeRoiBasisPoints(250_000, 1_000_000)).toBe(2_500); // exactly 25%
  });

  it("returns null when landed cost is zero, because the ratio is undefined", () => {
    expect(computeRoiBasisPoints(100, 0)).toBeNull();
    expect(computeRoiBasisPoints(0, 0)).toBeNull();
    expect(computeRoiBasisPoints(-100, 0)).toBeNull();
  });

  it("allows a negative ROI for a loss-making unit", () => {
    expect(computeRoiBasisPoints(-100_000, 1_000_000)).toBe(-1_000);
    expect(computeRoiBasisPoints(-1_000_000, 1_000_000)).toBe(-10_000);
  });
});

describe("economics — days in inventory", () => {
  it("counts whole days from acquisition to the end date", () => {
    expect(computeDaysInInventory(new Date("2024-01-01"), new Date("2024-01-31"))).toBe(30);
    expect(computeDaysInInventory(new Date("2024-01-01"), new Date("2024-01-01"))).toBe(0);
    expect(computeDaysInInventory(new Date("2024-01-01"), new Date("2024-06-01"))).toBe(152);
  });

  it("handles a leap year correctly", () => {
    expect(computeDaysInInventory(new Date("2024-02-28"), new Date("2024-03-01"))).toBe(2);
  });

  it("returns null when there is no acquisition date", () => {
    expect(computeDaysInInventory(null, new Date("2024-01-31"))).toBeNull();
    expect(computeDaysInInventory(undefined, new Date("2024-01-31"))).toBeNull();
  });

  it("never reports a negative age for a future acquisition date", () => {
    expect(computeDaysInInventory(new Date("2024-02-01"), new Date("2024-01-01"))).toBe(0);
  });
});

describe("economics — computeVehicleEconomics", () => {
  const AS_OF = new Date("2024-01-31");

  it("combines cost, pricing, margin and ageing for a listed vehicle", () => {
    const result = computeVehicleEconomics(
      {
        acquisition: ACQUISITION,
        reconItems: RECON_ITEMS,
        additionalExpenseCents: ADDITIONAL_EXPENSES_CENTS,
        targetRetailPriceCents: 2_000_000,
        askingPriceCents: 2_050_000,
        minimumApprovedCents: 1_900_000,
        acquisitionDate: new Date("2024-01-01"),
      },
      AS_OF,
    );

    expect(result.landedCost.landedCostCents).toBe(1_637_500);
    expect(result.expectedSalePriceCents).toBe(2_000_000);
    expect(result.expectedSalePriceSource).toBe("target");
    expect(result.estimatedGrossProfitCents).toBe(362_500);
    expect(result.estimatedRoiBasisPoints).toBe(2214);
    expect(result.actualGrossProfitCents).toBeNull();
    expect(result.actualRoiBasisPoints).toBeNull();
    expect(result.negotiatingRoomCents).toBe(150_000); // asking - minimum approved
    expect(result.frontEndMarginCents).toBe(412_500); // asking - landed
    expect(result.daysInInventory).toBe(30);
    expect(result.isSold).toBe(false);
  });

  it("prefers the target retail price, then the asking price, then nothing", () => {
    const withTarget = computeVehicleEconomics(
      { acquisition: { acquisitionPriceCents: 1_000_000 }, targetRetailPriceCents: 1_600_000, askingPriceCents: 1_500_000 },
      AS_OF,
    );
    expect(withTarget.expectedSalePriceSource).toBe("target");
    expect(withTarget.expectedSalePriceCents).toBe(1_600_000);

    const askingOnly = computeVehicleEconomics(
      { acquisition: { acquisitionPriceCents: 1_000_000 }, askingPriceCents: 1_500_000 },
      AS_OF,
    );
    expect(askingOnly.expectedSalePriceSource).toBe("asking");
    expect(askingOnly.expectedSalePriceCents).toBe(1_500_000);

    const neither = computeVehicleEconomics({ acquisition: { acquisitionPriceCents: 1_000_000 } }, AS_OF);
    expect(neither.expectedSalePriceSource).toBe("none");
    expect(neither.expectedSalePriceCents).toBeNull();
    expect(neither.estimatedGrossProfitCents).toBeNull();
    expect(neither.estimatedRoiBasisPoints).toBeNull();
  });

  it("returns a null estimated ROI when landed cost is zero", () => {
    const free = computeVehicleEconomics(
      { acquisition: { acquisitionPriceCents: 0 }, askingPriceCents: 2_000_000 },
      AS_OF,
    );
    expect(free.landedCost.landedCostCents).toBe(0);
    expect(free.estimatedGrossProfitCents).toBe(2_000_000);
    expect(free.estimatedRoiBasisPoints).toBeNull();
  });

  it("computes a sold vehicle's age up to the sale date, not today", () => {
    const sold = computeVehicleEconomics(
      {
        acquisition: ACQUISITION,
        reconItems: RECON_ITEMS,
        additionalExpenseCents: ADDITIONAL_EXPENSES_CENTS,
        finalSalePriceCents: 1_950_000,
        dateSold: new Date("2024-02-15"),
        acquisitionDate: new Date("2024-01-01"),
      },
      new Date("2024-06-01"),
    );
    expect(sold.isSold).toBe(true);
    expect(sold.actualGrossProfitCents).toBe(312_500);
    expect(sold.actualRoiBasisPoints).toBe(1908);
    expect(sold.daysInInventory).toBe(45); // Jan 1 -> Feb 15
  });

  it("treats a final sale price of exactly zero as not sold", () => {
    const notSold = computeVehicleEconomics(
      {
        acquisition: { acquisitionPriceCents: 1_000_000 },
        finalSalePriceCents: 0,
        dateSold: new Date("2024-02-15"),
        acquisitionDate: new Date("2024-01-01"),
      },
      AS_OF,
    );
    expect(notSold.isSold).toBe(false);
    expect(notSold.actualGrossProfitCents).toBeNull();
    expect(notSold.daysInInventory).toBe(30); // ages against asOf instead
  });

  it("still reports an actual loss on a sold unit", () => {
    const loss = computeVehicleEconomics(
      {
        acquisition: { acquisitionPriceCents: 2_000_000 },
        finalSalePriceCents: 1_500_000,
        dateSold: new Date("2024-02-15"),
        acquisitionDate: new Date("2024-01-01"),
      },
      AS_OF,
    );
    expect(loss.isSold).toBe(true);
    expect(loss.actualGrossProfitCents).toBe(-500_000);
    expect(loss.actualRoiBasisPoints).toBe(-2_500);
  });

  it("leaves negotiating room null when no minimum approved price is set", () => {
    const result = computeVehicleEconomics(
      { acquisition: { acquisitionPriceCents: 1_000_000 }, askingPriceCents: 1_400_000 },
      AS_OF,
    );
    expect(result.negotiatingRoomCents).toBeNull();
    expect(result.frontEndMarginCents).toBe(400_000);
  });

  it("is deterministic: identical input gives identical output", () => {
    const input = {
      acquisition: ACQUISITION,
      reconItems: RECON_ITEMS,
      additionalExpenseCents: ADDITIONAL_EXPENSES_CENTS,
      targetRetailPriceCents: 2_000_000,
      askingPriceCents: 2_050_000,
      acquisitionDate: new Date("2024-01-01"),
    };
    expect(computeVehicleEconomics(input, AS_OF)).toEqual(computeVehicleEconomics(input, AS_OF));
  });
});

describe("economics — rollUpInventory", () => {
  const V1 = computeVehicleEconomics(
    {
      acquisition: { acquisitionPriceCents: 1_000_000 },
      askingPriceCents: 1_400_000,
      acquisitionDate: new Date("2024-01-01"),
    },
    new Date("2024-01-11"), // 10 days
  );

  const V2 = computeVehicleEconomics(
    {
      acquisition: { acquisitionPriceCents: 2_000_000, transportationCents: 100_000 },
      targetRetailPriceCents: 2_800_000,
      askingPriceCents: 2_700_000,
      acquisitionDate: new Date("2024-01-01"),
    },
    new Date("2024-01-21"), // 20 days
  );

  const V3_SOLD = computeVehicleEconomics(
    {
      acquisition: { acquisitionPriceCents: 1_000_000 },
      askingPriceCents: 1_600_000,
      finalSalePriceCents: 1_500_000,
      dateSold: new Date("2024-02-01"),
      acquisitionDate: new Date("2024-01-01"),
    },
    new Date("2024-06-01"), // 31 days, sold
  );

  const V4_UNPRICED = computeVehicleEconomics(
    { acquisition: { acquisitionPriceCents: 500_000 }, acquisitionDate: new Date("2024-01-01") },
    new Date("2024-01-06"), // 5 days, no asking price and no target
  );

  it("aggregates capital, value, projected profit and average ageing", () => {
    const rollup = rollUpInventory([V1, V2]);
    expect(rollup.vehicleCount).toBe(2);
    expect(rollup.totalLandedCostCents).toBe(3_100_000);
    expect(rollup.inventoryCapitalCents).toBe(3_100_000);
    expect(rollup.totalAskingPriceCents).toBe(4_100_000); // 1,400,000 + 2,700,000
    expect(rollup.estimatedInventoryValueCents).toBe(4_200_000); // 1,400,000 + 2,800,000 target
    expect(rollup.projectedGrossProfitCents).toBe(1_100_000); // 400,000 + 700,000
    expect(rollup.averageDaysInInventory).toBe(15);
  });

  it("excludes sold vehicles by default", () => {
    const rollup = rollUpInventory([V1, V2, V3_SOLD]);
    expect(rollup.vehicleCount).toBe(2);
    expect(rollup.totalLandedCostCents).toBe(3_100_000);
    expect(rollup.averageDaysInInventory).toBe(15);
  });

  it("includes sold vehicles when asked, with capital and average ageing updated", () => {
    const rollup = rollUpInventory([V1, V2, V3_SOLD], { excludeSold: false });
    expect(rollup.vehicleCount).toBe(3);
    expect(rollup.totalLandedCostCents).toBe(4_100_000);
    expect(rollup.totalAskingPriceCents).toBe(5_700_000);
    expect(rollup.estimatedInventoryValueCents).toBe(5_800_000);
    expect(rollup.averageDaysInInventory).toBe(20); // (10 + 20 + 31) / 3 = 20.33 -> 20
  });

  it("uses the estimated margin, not the realised one, for a sold vehicle", () => {
    // V3 estimated 600,000 (against asking 1,600,000) but actually made 500,000.
    const rollup = rollUpInventory([V3_SOLD], { excludeSold: false });
    expect(V3_SOLD.actualGrossProfitCents).toBe(500_000);
    expect(rollup.projectedGrossProfitCents).toBe(600_000);
  });

  it("counts the capital of an unpriced vehicle but no value or projected profit", () => {
    const rollup = rollUpInventory([V4_UNPRICED]);
    expect(rollup.vehicleCount).toBe(1);
    expect(rollup.totalLandedCostCents).toBe(500_000);
    expect(rollup.inventoryCapitalCents).toBe(500_000);
    expect(rollup.totalAskingPriceCents).toBe(0);
    expect(rollup.estimatedInventoryValueCents).toBe(0);
    expect(rollup.projectedGrossProfitCents).toBe(0);
    expect(rollup.averageDaysInInventory).toBe(5);
  });

  it("returns a zeroed roll-up with null average ageing for empty inventory", () => {
    const rollup = rollUpInventory([]);
    expect(rollup).toEqual({
      vehicleCount: 0,
      totalLandedCostCents: 0,
      totalAskingPriceCents: 0,
      estimatedInventoryValueCents: 0,
      inventoryCapitalCents: 0,
      projectedGrossProfitCents: 0,
      averageDaysInInventory: null,
    });
  });
});
