import { describe, expect, it } from "vitest";
import type { PrismaClient, UserRole, Vehicle } from "@/generated/prisma";
import { maskVehicleFinancials } from "@/lib/auth/masking";
import { computeVehicleEconomics } from "@/lib/economics";
import { buildVehicleView, type OperationContext } from "@/lib/operations";

/**
 * CARS — the vehicle payload.
 *
 * `buildVehicleView()` is pure, so these tests run with a database that throws
 * on any access: if the view ever started querying, they would fail. What they
 * pin down is the security property that matters most in this phase — a role
 * without `finance:read` receives no cost, no floor, no margin and no ratio
 * derived from them, even though the server computed all of it.
 */

const ACQUISITION_DATE = new Date(Date.UTC(2026, 0, 1));
const AS_OF = new Date(Date.UTC(2026, 2, 2));

function vehicleFixture(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "veh_1",
    vin: "1HGCM82633A004352",
    stockNumber: "SN-TEST0001",
    year: 2019,
    make: "Toyota",
    model: "Camry",
    trim: "SE",
    mileage: 68_000,
    exteriorColor: "Silver",
    interiorColor: "Black",
    transmission: "Automatic",
    drivetrain: "FWD",
    engine: "2.5L I4",
    fuelType: "Gasoline",
    bodyType: "Sedan",
    doors: 4,
    seats: 5,
    titleStatus: "CLEAN",
    status: "READY",
    listingStatus: "UNLISTED",
    dataOrigin: "REAL",
    location: "Lot A",
    notes: "Internal note",
    description: "Public description",
    features: ["Backup camera"],
    acquisitionSource: "AUCTION",
    acquisitionDate: ACQUISITION_DATE,
    acquisitionPriceCents: 1_450_000,
    auctionFeesCents: 45_000,
    transportationCents: 32_000,
    inspectionCents: 9_500,
    otherAcquisitionCents: 5_000,
    reconOverrideCents: null,
    targetRetailPriceCents: 1_999_500,
    askingPriceCents: 1_899_500,
    minimumApprovedCents: 1_750_000,
    dateListed: null,
    dateSold: null,
    finalSalePriceCents: null,
    trackerDeviceId: "TRK-9001",
    trackerStatus: "ONLINE",
    trackerLastLatitude: 29.7604,
    trackerLastLongitude: -95.3698,
    trackerLastSeenAt: new Date(Date.UTC(2026, 2, 1)),
    trackerGeofenceState: "ON_LOT",
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    updatedAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

const RECON_ITEMS = [{ estimateCents: 120_000, actualCostCents: null }];
const EXPENSES = [{ amountCents: 20_000 }, { amountCents: 5_000 }];

function explodingDb(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, property) {
      throw new Error(`database was touched (${String(property)})`);
    },
  });
}

function contextFor(role: UserRole): OperationContext {
  return { actor: { id: "staff_1", email: "staff@dealer.test", name: "Staff", role }, db: explodingDb() };
}

function loadedVehicle(overrides: Partial<Vehicle> = {}) {
  return { ...vehicleFixture(overrides), reconItems: RECON_ITEMS, expenses: EXPENSES };
}

/** The derived money fields the masker is responsible for. */
const COST_FIELDS = [
  "acquisitionPriceCents",
  "auctionFeesCents",
  "transportationCents",
  "inspectionCents",
  "otherAcquisitionCents",
  "reconOverrideCents",
  "minimumApprovedCents",
  "landedCostCents",
  "estimatedGrossProfitCents",
  "actualGrossProfitCents",
  "expectedProfitCents",
  "estimatedRoiBasisPoints",
  "actualRoiBasisPoints",
  "frontEndMarginCents",
  "negotiatingRoomCents",
  "landedCost",
] as const;

const RESTRICTED: UserRole[] = ["SALES", "RECON", "VIEWER"];

/**
 * GPS fields gated by `tracker:read` (OWNER, MANAGER). A role that can read
 * inventory is not automatically allowed to know which device is fitted or
 * where the car was last seen.
 */
const TRACKER_FIELDS = [
  "trackerDeviceId",
  "trackerStatus",
  "trackerLastLatitude",
  "trackerLastLongitude",
  "trackerLastSeenAt",
  "trackerGeofenceState",
] as const;

describe("CARS — buildVehicleView is pure", () => {
  it("computes the view without touching the database", () => {
    const view = buildVehicleView(contextFor("OWNER"), loadedVehicle(), AS_OF);
    expect(view.id).toBe("veh_1");
  });
});

describe("CARS — economics wiring", () => {
  it("matches the canonical engine exactly", () => {
    const view = buildVehicleView(contextFor("OWNER"), loadedVehicle(), AS_OF);
    const economics = computeVehicleEconomics(
      {
        acquisition: {
          acquisitionPriceCents: 1_450_000,
          auctionFeesCents: 45_000,
          transportationCents: 32_000,
          inspectionCents: 9_500,
          otherAcquisitionCents: 5_000,
        },
        reconItems: RECON_ITEMS,
        reconOverrideCents: null,
        additionalExpenseCents: 25_000,
        targetRetailPriceCents: 1_999_500,
        askingPriceCents: 1_899_500,
        minimumApprovedCents: 1_750_000,
        acquisitionDate: ACQUISITION_DATE,
        dateSold: null,
        finalSalePriceCents: null,
      },
      AS_OF,
    );

    expect(view.landedCostCents).toBe(economics.landedCost.landedCostCents);
    expect(view.estimatedGrossProfitCents).toBe(economics.estimatedGrossProfitCents);
    expect(view.expectedProfitCents).toBe(economics.estimatedGrossProfitCents);
    expect(view.estimatedRoiBasisPoints).toBe(economics.estimatedRoiBasisPoints);
    expect(view.frontEndMarginCents).toBe(economics.frontEndMarginCents);
    expect(view.negotiatingRoomCents).toBe(economics.negotiatingRoomCents);
    expect(view.landedCost).toEqual(economics.landedCost);
  });

  it("adds acquisition cost, recon and vehicle expenses into one landed cost", () => {
    const view = buildVehicleView(contextFor("OWNER"), loadedVehicle(), AS_OF);
    expect(view.landedCostCents).toBe(1_686_500);
    expect(view.estimatedGrossProfitCents).toBe(313_000);
    expect(view.expectedProfitCents).toBe(313_000);
    expect(view.estimatedRoiBasisPoints).toBe(1_856);
    expect(view.frontEndMarginCents).toBe(213_000);
    expect(view.negotiatingRoomCents).toBe(149_500);
    expect(view.landedCost?.reconSource).toBe("recon-items");
  });

  it("lets an explicit recon override win over the itemised estimate", () => {
    const view = buildVehicleView(contextFor("OWNER"), loadedVehicle({ reconOverrideCents: 200_000 }), AS_OF);
    expect(view.landedCostCents).toBe(1_766_500);
    expect(view.landedCost?.reconSource).toBe("override");
  });

  it("reports days in inventory and the sold flag", () => {
    const inStock = buildVehicleView(contextFor("OWNER"), loadedVehicle(), AS_OF);
    expect(inStock.daysInInventory).toBe(60);
    expect(inStock.isSold).toBe(false);

    const sold = buildVehicleView(
      contextFor("OWNER"),
      loadedVehicle({ finalSalePriceCents: 1_950_000, dateSold: AS_OF }),
      AS_OF,
    );
    expect(sold.isSold).toBe(true);
    expect(sold.actualGrossProfitCents).toBe(1_950_000 - 1_686_500);
    // ROI is null when landed cost is 0 — never a fabricated 0%.
    expect(sold.actualRoiBasisPoints).toBe(Math.round(((1_950_000 - 1_686_500) / 1_686_500) * 10_000));
  });

  it("never reports a fake ROI on a zero-cost vehicle", () => {
    const view = buildVehicleView(
      contextFor("OWNER"),
      {
        ...vehicleFixture({
          acquisitionPriceCents: 0,
          auctionFeesCents: 0,
          transportationCents: 0,
          inspectionCents: 0,
          otherAcquisitionCents: 0,
          reconOverrideCents: null,
        }),
        reconItems: [],
        expenses: [],
      },
      AS_OF,
    );
    expect(view.landedCostCents).toBe(0);
    // computeRoiBasisPoints() returns null when the ratio is undefined; a fake
    // 0% would read as "break-even" instead of "unknown".
    expect(view.estimatedRoiBasisPoints).toBeNull();
    expect(view.landedCost?.reconSource).toBe("none");
  });
});

describe("CARS — financial masking by role", () => {
  it("keeps every cost field for OWNER and MANAGER", () => {
    for (const role of ["OWNER", "MANAGER"] as UserRole[]) {
      const view = buildVehicleView(contextFor(role), loadedVehicle(), AS_OF);
      expect(view.acquisitionPriceCents, `${role} keeps acquisition price`).toBe(1_450_000);
      expect(view.landedCostCents, `${role} keeps landed cost`).toBe(1_686_500);
      expect(view.estimatedGrossProfitCents, `${role} keeps estimated profit`).toBe(313_000);
      expect(view.minimumApprovedCents, `${role} keeps the floor`).toBe(1_750_000);
      expect(view.frontEndMarginCents, `${role} keeps the front-end margin`).toBe(213_000);
      expect(view.landedCost, `${role} keeps the breakdown`).not.toBeNull();
      expect(view.trackerDeviceId, `${role} keeps the tracker device`).toBe("TRK-9001");
      expect(view.trackerLastLatitude, `${role} keeps the last position`).toBe(29.7604);
    }
  });

  it("nulls every cost, floor and cost-derived ratio for restricted roles", () => {
    for (const role of RESTRICTED) {
      const view = buildVehicleView(contextFor(role), loadedVehicle(), AS_OF);
      for (const field of COST_FIELDS) {
        expect(view[field], `${role} must not receive ${field}`).toBeNull();
      }
    }
  });

  it("never leaks a cost figure into the serialized payload", () => {
    for (const role of RESTRICTED) {
      const serialized = JSON.stringify(buildVehicleView(contextFor(role), loadedVehicle(), AS_OF));
      expect(serialized, `${role} leaked acquisition price`).not.toContain("1450000");
      expect(serialized, `${role} leaked landed cost`).not.toContain("1686500");
      expect(serialized, `${role} leaked the recon estimate`).not.toContain("120000");
      expect(serialized, `${role} leaked the price floor`).not.toContain("1750000");
      expect(serialized, `${role} leaked the front-end margin`).not.toContain("213000");
      expect(serialized, `${role} leaked the negotiating room`).not.toContain("149500");
      expect(serialized, `${role} leaked the ROI`).not.toContain("1856");
    }
  });

  it("keeps what a salesperson needs to quote the car", () => {
    for (const role of RESTRICTED) {
      const view = buildVehicleView(contextFor(role), loadedVehicle(), AS_OF);
      expect(view.id).toBe("veh_1");
      expect(view.vin).toBe("1HGCM82633A004352");
      expect(view.year).toBe(2019);
      expect(view.make).toBe("Toyota");
      expect(view.model).toBe("Camry");
      expect(view.mileage).toBe(68_000);
      expect(view.askingPriceCents, `${role} must still see the asking price`).toBe(1_899_500);
      expect(view.targetRetailPriceCents, `${role} must still see the target retail`).toBe(1_999_500);
      expect(view.expectedSalePriceCents, `${role} must still see the expected sale price`).toBe(1_999_500);
      expect(view.daysInInventory, `${role} must still see days in inventory`).toBe(60);
      expect(view.isSold).toBe(false);
    }
  });

  it("drops the recon, expense and override rows from the payload entirely", () => {
    for (const role of [...RESTRICTED, "OWNER", "MANAGER"] as UserRole[]) {
      const view = buildVehicleView(contextFor(role), loadedVehicle(), AS_OF) as Record<string, unknown>;
      expect("reconItems" in view, `${role} must not receive recon rows`).toBe(false);
      expect("expenses" in view, `${role} must not receive expense rows`).toBe(false);
    }
  });

  it("only ever narrows the payload, never widens it", () => {
    const unrestricted = buildVehicleView(contextFor("OWNER"), loadedVehicle(), AS_OF) as Record<string, unknown>;
    const withheld = [...COST_FIELDS, ...TRACKER_FIELDS] as readonly string[];
    for (const role of RESTRICTED) {
      const masked = buildVehicleView(contextFor(role), loadedVehicle(), AS_OF) as Record<string, unknown>;
      expect(Object.keys(masked).sort()).toEqual(Object.keys(unrestricted).sort());
      for (const key of Object.keys(masked)) {
        if (withheld.includes(key)) {
          expect(masked[key], `${role} must not receive ${key}`).toBeNull();
        } else {
          expect(masked[key], `${role} must keep ${key}`).toEqual(unrestricted[key]);
        }
      }
    }
  });

  it("does not invent keys that were not on the record", () => {
    const masked = maskVehicleFinancials({ id: "veh_2", askingPriceCents: 500_000 }, { role: "SALES" });
    expect(Object.keys(masked)).toEqual(["id", "askingPriceCents"]);
  });
});

describe("CARS — tracker data obeys tracker:read", () => {
  it("withholds the device and its position from roles without tracker:read", () => {
    for (const role of RESTRICTED) {
      const view = buildVehicleView(contextFor(role), loadedVehicle(), AS_OF);
      for (const field of TRACKER_FIELDS) {
        expect(view[field], `${role} must not receive ${field}`).toBeNull();
      }
    }
  });

  it("never leaks a device identifier or a coordinate into the serialized payload", () => {
    for (const role of RESTRICTED) {
      const serialized = JSON.stringify(buildVehicleView(contextFor(role), loadedVehicle(), AS_OF));
      expect(serialized, `${role} leaked the tracker device`).not.toContain("TRK-9001");
      expect(serialized, `${role} leaked a latitude`).not.toContain("29.7604");
      expect(serialized, `${role} leaked a longitude`).not.toContain("95.3698");
      expect(serialized, `${role} leaked the geofence state`).not.toContain("ON_LOT");
    }
  });

  it("still lets every role see the vehicle itself", () => {
    for (const role of RESTRICTED) {
      const view = buildVehicleView(contextFor(role), loadedVehicle(), AS_OF);
      expect(view.vin).toBe("1HGCM82633A004352");
      expect(view.location).toBe("Lot A");
    }
  });
});
