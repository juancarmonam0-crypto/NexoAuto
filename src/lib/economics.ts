/**
 * Vehicle economics engine.
 *
 * DETERMINISTIC BY DESIGN. Every number here is exact integer arithmetic over
 * cents. No AI, no heuristics, no randomness, no I/O. This module is the single
 * authority for landed cost, gross profit, ROI and days-in-inventory.
 *
 * Cost ownership invariant (see docs/ARCHITECTURE.md):
 *   purchase price / auction fees / transportation / inspection / other costs
 *     -> live on the Vehicle acquisition fields
 *   recon
 *     -> lives on VehicleReconItem rows (or an explicit staff override)
 *   everything else vehicle-attributable
 *     -> lives on Expense rows (whose category enum excludes the costs above)
 * Because each cost has exactly one home, double counting is impossible.
 */

import {
  type BasisPoints,
  type Cents,
  assertCents,
  sumCents,
  toCents,
} from "./money";

/** The acquisition cost block, as stored on the Vehicle record. */
export interface AcquisitionCosts {
  acquisitionPriceCents: Cents;
  auctionFeesCents?: Cents;
  transportationCents?: Cents;
  inspectionCents?: Cents;
  otherAcquisitionCents?: Cents;
}

/** Recon item shape required by the engine (a subset of VehicleReconItem). */
export interface ReconCostItem {
  estimateCents: Cents;
  actualCostCents?: Cents | null;
}

export interface LandedCostBreakdown {
  acquisitionPriceCents: Cents;
  auctionFeesCents: Cents;
  transportationCents: Cents;
  inspectionCents: Cents;
  otherAcquisitionCents: Cents;
  reconCents: Cents;
  /** Non-acquisition vehicle expenses (Expense rows tied to the vehicle). */
  additionalExpenseCents: Cents;
  /** Sum of every component above. */
  landedCostCents: Cents;
  /** Which recon source was used, so the UI can explain the number. */
  reconSource: "override" | "recon-items" | "none";
  itemizedReconCents: Cents;
  outstandingReconEstimateCents: Cents;
}

/**
 * Resolves recon cost.
 *
 * A staff override (Vehicle.reconOverrideCents) wins when present, because a
 * manager may know recon closed at a flat rate. Otherwise each item
 * contributes its actual cost when recorded, else its estimate.
 */
export function resolveReconCost(
  items: readonly ReconCostItem[],
  overrideCents?: Cents | null,
): {
  reconCents: Cents;
  source: "override" | "recon-items" | "none";
  itemizedCents: Cents;
  outstandingEstimateCents: Cents;
} {
  const itemizedCents = items.reduce<number>(
    (total, item) => total + (item.actualCostCents != null ? toCents(item.actualCostCents) : toCents(item.estimateCents)),
    0,
  );
  const outstandingEstimateCents = items.reduce<number>(
    (total, item) => total + (item.actualCostCents == null ? toCents(item.estimateCents) : 0),
    0,
  );

  if (overrideCents !== null && overrideCents !== undefined) {
    return { reconCents: toCents(overrideCents), source: "override", itemizedCents, outstandingEstimateCents };
  }
  if (items.length === 0) {
    return { reconCents: 0, source: "none", itemizedCents: 0, outstandingEstimateCents: 0 };
  }
  return { reconCents: itemizedCents, source: "recon-items", itemizedCents, outstandingEstimateCents };
}

/**
 * landedCost = purchase price + auction fees + transportation + inspection
 *            + other acquisition costs + recon + additional vehicle expenses
 */
export function computeLandedCost(input: {
  acquisition: AcquisitionCosts;
  reconItems?: readonly ReconCostItem[];
  reconOverrideCents?: Cents | null;
  additionalExpenseCents?: Cents;
}): LandedCostBreakdown {
  const acquisitionPriceCents = assertCents(input.acquisition.acquisitionPriceCents, "acquisitionPriceCents");
  const auctionFeesCents = toCents(input.acquisition.auctionFeesCents ?? 0);
  const transportationCents = toCents(input.acquisition.transportationCents ?? 0);
  const inspectionCents = toCents(input.acquisition.inspectionCents ?? 0);
  const otherAcquisitionCents = toCents(input.acquisition.otherAcquisitionCents ?? 0);

  const recon = resolveReconCost(input.reconItems ?? [], input.reconOverrideCents);
  const additionalExpenseCents = toCents(input.additionalExpenseCents ?? 0);

  return {
    acquisitionPriceCents,
    auctionFeesCents,
    transportationCents,
    inspectionCents,
    otherAcquisitionCents,
    reconCents: recon.reconCents,
    additionalExpenseCents,
    reconSource: recon.source,
    itemizedReconCents: recon.itemizedCents,
    outstandingReconEstimateCents: recon.outstandingEstimateCents,
    landedCostCents: sumCents(
      acquisitionPriceCents,
      auctionFeesCents,
      transportationCents,
      inspectionCents,
      otherAcquisitionCents,
      recon.reconCents,
      additionalExpenseCents,
    ),
  };
}

/** estimatedGrossProfit = expected sale price - landed cost. May be negative. */
export function computeEstimatedGrossProfit(expectedSalePriceCents: Cents, landedCostCents: Cents): Cents {
  return toCents(expectedSalePriceCents) - toCents(landedCostCents);
}

/** actualGrossProfit = final sale price - landed cost. May be negative. */
export function computeActualGrossProfit(finalSalePriceCents: Cents, landedCostCents: Cents): Cents {
  return toCents(finalSalePriceCents) - toCents(landedCostCents);
}

/**
 * ROI = gross profit / landed cost, expressed in basis points (1 bp = 0.01%).
 * Returns null when landed cost is zero because the ratio is undefined —
 * callers must render "—" rather than a fake 0%.
 */
export function computeRoiBasisPoints(grossProfitCents: Cents, landedCostCents: Cents): BasisPoints | null {
  const landed = toCents(landedCostCents);
  if (landed === 0) return null;
  return Math.round((grossProfitCents / landed) * 10_000);
}

/**
 * daysInInventory = (today or sold date) - acquisition date, in whole days.
 * Returns null when there is no acquisition date. Never negative.
 */
export function computeDaysInInventory(
  acquisitionDate: Date | null | undefined,
  endDate: Date | null | undefined = new Date(),
): number | null {
  if (!acquisitionDate) return null;
  const end = endDate ?? new Date();
  const startDay = Date.UTC(acquisitionDate.getUTCFullYear(), acquisitionDate.getUTCMonth(), acquisitionDate.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const days = Math.round((endDay - startDay) / 86_400_000);
  return Math.max(0, days);
}

/** Everything a vehicle needs for the engine to run. */
export interface VehicleEconomicsInput {
  acquisition: AcquisitionCosts;
  reconItems?: readonly ReconCostItem[];
  reconOverrideCents?: Cents | null;
  additionalExpenseCents?: Cents;
  targetRetailPriceCents?: Cents | null;
  askingPriceCents?: Cents | null;
  minimumApprovedCents?: Cents | null;
  acquisitionDate?: Date | null;
  dateSold?: Date | null;
  finalSalePriceCents?: Cents | null;
}

export interface VehicleEconomics {
  landedCost: LandedCostBreakdown;

  /** Price the vehicle is expected to retail for: target, else asking price. */
  expectedSalePriceCents: Cents | null;
  expectedSalePriceSource: "target" | "asking" | "none";

  estimatedGrossProfitCents: Cents | null;
  estimatedRoiBasisPoints: BasisPoints | null;

  actualGrossProfitCents: Cents | null;
  actualRoiBasisPoints: BasisPoints | null;

  /** How far the asking price sits above the minimum approved price, in cents. */
  negotiatingRoomCents: Cents | null;
  /** asking price minus landed cost, the front-end margin at sticker. */
  frontEndMarginCents: Cents | null;

  daysInInventory: number | null;
  isSold: boolean;
}

/**
 * The single function every surface uses. Pure: same input, same output.
 */
export function computeVehicleEconomics(
  input: VehicleEconomicsInput,
  asOf: Date = new Date(),
): VehicleEconomics {
  const landedCost = computeLandedCost({
    acquisition: input.acquisition,
    reconItems: input.reconItems,
    reconOverrideCents: input.reconOverrideCents,
    additionalExpenseCents: input.additionalExpenseCents,
  });

  let expectedSalePriceCents: Cents | null = null;
  let expectedSalePriceSource: "target" | "asking" | "none" = "none";
  if (input.targetRetailPriceCents != null) {
    expectedSalePriceCents = toCents(input.targetRetailPriceCents);
    expectedSalePriceSource = "target";
  } else if (input.askingPriceCents != null) {
    expectedSalePriceCents = toCents(input.askingPriceCents);
    expectedSalePriceSource = "asking";
  }

  const estimatedGrossProfitCents =
    expectedSalePriceCents === null
      ? null
      : computeEstimatedGrossProfit(expectedSalePriceCents, landedCost.landedCostCents);

  const finalSalePriceCents = input.finalSalePriceCents == null ? null : toCents(input.finalSalePriceCents);
  const hasFinalSale = finalSalePriceCents !== null && finalSalePriceCents > 0;
  const actualGrossProfitCents = hasFinalSale
    ? computeActualGrossProfit(finalSalePriceCents, landedCost.landedCostCents)
    : null;

  const askingPriceCents = input.askingPriceCents == null ? null : toCents(input.askingPriceCents);
  const minimumApprovedCents = input.minimumApprovedCents == null ? null : toCents(input.minimumApprovedCents);

  return {
    landedCost,
    expectedSalePriceCents,
    expectedSalePriceSource,
    estimatedGrossProfitCents,
    estimatedRoiBasisPoints:
      estimatedGrossProfitCents === null ? null : computeRoiBasisPoints(estimatedGrossProfitCents, landedCost.landedCostCents),
    actualGrossProfitCents,
    actualRoiBasisPoints:
      actualGrossProfitCents === null ? null : computeRoiBasisPoints(actualGrossProfitCents, landedCost.landedCostCents),
    negotiatingRoomCents:
      askingPriceCents !== null && minimumApprovedCents !== null ? askingPriceCents - minimumApprovedCents : null,
    frontEndMarginCents:
      askingPriceCents !== null ? askingPriceCents - landedCost.landedCostCents : null,
    daysInInventory: computeDaysInInventory(input.acquisitionDate, hasFinalSale ? (input.dateSold ?? asOf) : asOf),
    isSold: hasFinalSale,
  };
}

/** Roll-up across an inventory set, used by the dealer dashboard. */
export interface InventoryRollup {
  vehicleCount: number;
  totalLandedCostCents: Cents;
  totalAskingPriceCents: Cents;
  /** Estimated retail value of unsold inventory (target price when set). */
  estimatedInventoryValueCents: Cents;
  /** Landed cost tied up in vehicles that have not sold. */
  inventoryCapitalCents: Cents;
  projectedGrossProfitCents: Cents;
  averageDaysInInventory: number | null;
}

export function rollUpInventory(
  economics: readonly VehicleEconomics[],
  options: { excludeSold?: boolean } = {},
): InventoryRollup {
  const rows = options.excludeSold === false ? economics : economics.filter((row) => !row.isSold);

  let totalLandedCostCents = 0;
  let totalAskingPriceCents = 0;
  let estimatedInventoryValueCents = 0;
  let projectedGrossProfitCents = 0;
  let daysTotal = 0;
  let daysCount = 0;

  for (const row of rows) {
    totalLandedCostCents += row.landedCost.landedCostCents;
    totalAskingPriceCents += row.frontEndMarginCents === null ? 0 : row.landedCost.landedCostCents + row.frontEndMarginCents;
    estimatedInventoryValueCents += row.expectedSalePriceCents ?? 0;
    projectedGrossProfitCents += row.estimatedGrossProfitCents ?? 0;
    if (row.daysInInventory !== null) {
      daysTotal += row.daysInInventory;
      daysCount += 1;
    }
  }

  return {
    vehicleCount: rows.length,
    totalLandedCostCents,
    totalAskingPriceCents,
    estimatedInventoryValueCents,
    inventoryCapitalCents: totalLandedCostCents,
    projectedGrossProfitCents,
    averageDaysInInventory: daysCount === 0 ? null : Math.round(daysTotal / daysCount),
  };
}
