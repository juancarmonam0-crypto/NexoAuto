import { describe, expect, it, vi } from "vitest";
import type { UserRole } from "@/generated/prisma";
import { maskVehicleFinancials } from "@/lib/auth/guards";
import {
  canViewFinancials,
  CAPABILITIES,
  capabilitiesFor,
  hasAnyCapability,
  hasCapability,
  ROLE_LABELS,
  roleLabel,
} from "@/lib/auth/roles";

// guards.ts pulls in next/navigation and the session module (next/headers +
// Prisma). Only maskVehicleFinancials is under test here, so both are stubbed
// to keep this a pure unit test with no server runtime or database.
// vi.mock is hoisted above the imports by Vitest's transform.
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));

const ALL_ROLES: UserRole[] = ["OWNER", "MANAGER", "SALES", "RECON", "VIEWER"];

describe("authorization — role capability matrix", () => {
  it("defines 25 distinct capabilities", () => {
    expect(CAPABILITIES).toHaveLength(25);
    expect(new Set(CAPABILITIES).size).toBe(25);
  });

  it("gives OWNER every capability", () => {
    expect(capabilitiesFor("OWNER")).toHaveLength(CAPABILITIES.length);
    for (const capability of CAPABILITIES) {
      expect(hasCapability("OWNER", capability), `OWNER should have ${capability}`).toBe(true);
    }
  });

  it("withholds only user management and settings writes from MANAGER", () => {
    const manager = capabilitiesFor("MANAGER");
    expect(manager).toHaveLength(23);
    const missing = CAPABILITIES.filter((capability) => !manager.includes(capability));
    expect([...missing].sort()).toEqual(["settings:write", "users:manage"]);
  });

  it("keeps SALES, RECON and VIEWER narrow", () => {
    expect(capabilitiesFor("SALES")).toHaveLength(13);
    expect(capabilitiesFor("RECON")).toHaveLength(8);
    expect(capabilitiesFor("VIEWER")).toHaveLength(8);
  });

  it("has a label for every role and falls back to VIEWER for an unknown role", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(roleLabel(role)).toBe(ROLE_LABELS[role]);
    }
    expect(roleLabel("OWNER")).toBe("Owner");
    expect(capabilitiesFor("NOT_A_ROLE" as UserRole)).toEqual(capabilitiesFor("VIEWER"));
    expect(hasCapability("NOT_A_ROLE" as UserRole, "users:manage")).toBe(false);
  });

  it("keeps VIEWER strictly read-only", () => {
    for (const capability of capabilitiesFor("VIEWER")) {
      expect(capability, `${capability} should be a read capability`).toMatch(/:read$/);
    }
  });

  it("answers hasAnyCapability correctly", () => {
    expect(hasAnyCapability("SALES", ["users:manage", "crm:write"])).toBe(true);
    expect(hasAnyCapability("SALES", ["users:manage", "settings:write"])).toBe(false);
    expect(hasAnyCapability("SALES", [])).toBe(false);
  });
});

describe("authorization — finance:read separation", () => {
  it("grants financial visibility only to OWNER and MANAGER", () => {
    expect(canViewFinancials("OWNER")).toBe(true);
    expect(canViewFinancials("MANAGER")).toBe(true);
    expect(canViewFinancials("SALES")).toBe(false);
    expect(canViewFinancials("RECON")).toBe(false);
    expect(canViewFinancials("VIEWER")).toBe(false);
  });

  it("keeps cost/profit visibility narrower than pricing visibility for SALES", () => {
    // A salesperson can quote a price but cannot see the dealership's cost basis.
    expect(hasCapability("SALES", "pricing:read")).toBe(true);
    expect(hasCapability("SALES", "finance:read")).toBe(false);
  });

  it("keeps acquisition cost visibility away from RECON, who still records recon spend", () => {
    expect(hasCapability("RECON", "recon:write")).toBe(true);
    expect(hasCapability("RECON", "expenses:read")).toBe(true);
    expect(hasCapability("RECON", "expenses:write")).toBe(true);
    expect(hasCapability("RECON", "finance:read")).toBe(false);
    expect(hasCapability("RECON", "acquisition:read")).toBe(false);
  });

  it("never grants finance:read without also granting pricing:read", () => {
    for (const role of ALL_ROLES) {
      if (hasCapability(role, "finance:read")) {
        expect(hasCapability(role, "pricing:read"), `${role} needs pricing:read`).toBe(true);
      }
    }
  });
});

describe("authorization — pricing:read separation", () => {
  it("gives every role price visibility so nobody is blind to the sticker", () => {
    for (const role of ALL_ROLES) {
      expect(hasCapability(role, "pricing:read"), `${role} should see prices`).toBe(true);
    }
  });

  it("keeps repricing authority to OWNER and MANAGER", () => {
    expect(hasCapability("OWNER", "pricing:write")).toBe(true);
    expect(hasCapability("MANAGER", "pricing:write")).toBe(true);
    expect(hasCapability("SALES", "pricing:write")).toBe(false);
    expect(hasCapability("RECON", "pricing:write")).toBe(false);
    expect(hasCapability("VIEWER", "pricing:write")).toBe(false);
  });

  it("keeps sourcing write authority away from sales and recon", () => {
    expect(hasCapability("MANAGER", "sourcing:write")).toBe(true);
    expect(hasCapability("SALES", "sourcing:read")).toBe(true);
    expect(hasCapability("SALES", "sourcing:write")).toBe(false);
    expect(hasCapability("RECON", "sourcing:read")).toBe(false);
  });
});

describe("authorization — restricted operational roles", () => {
  it("stops SALES from modifying inventory, recon or expenses", () => {
    expect(hasCapability("SALES", "inventory:write")).toBe(false);
    expect(hasCapability("SALES", "recon:write")).toBe(false);
    expect(hasCapability("SALES", "expenses:read")).toBe(false);
    expect(hasCapability("SALES", "expenses:write")).toBe(false);
    expect(hasCapability("SALES", "audit:read")).toBe(false);
    expect(hasCapability("SALES", "users:manage")).toBe(false);
    expect(hasCapability("SALES", "tracker:read")).toBe(false);
  });

  it("stops RECON from touching deals, CRM or documents", () => {
    expect(hasCapability("RECON", "deals:write")).toBe(false);
    expect(hasCapability("RECON", "deals:read")).toBe(false);
    expect(hasCapability("RECON", "crm:write")).toBe(false);
    expect(hasCapability("RECON", "documents:read")).toBe(false);
    expect(hasCapability("RECON", "users:manage")).toBe(false);
    expect(hasCapability("RECON", "settings:write")).toBe(false);
  });

  it("stops VIEWER from writing anything at all", () => {
    for (const capability of CAPABILITIES) {
      if (capability.endsWith(":write") || capability === "users:manage") {
        expect(hasCapability("VIEWER", capability), `VIEWER must not have ${capability}`).toBe(false);
      }
    }
  });
});

/** A vehicle-shaped record carrying both public and financial fields. */
function vehicleFixture() {
  return {
    id: "veh_1",
    year: 2019,
    make: "Toyota",
    model: "Camry",
    mileage: 68_000,
    askingPriceCents: 1_899_500,
    acquisitionPriceCents: 1_450_000,
    auctionFeesCents: 45_000,
    transportationCents: 32_000,
    inspectionCents: 9_500,
    otherAcquisitionCents: 5_000,
    reconOverrideCents: 120_000,
    minimumApprovedCents: 1_799_000,
    landedCostCents: 1_661_500,
    estimatedGrossProfitCents: 238_000,
    actualGrossProfitCents: 150_000,
    expectedProfitCents: 238_000,
    landedCost: { landedCostCents: 1_661_500, reconCents: 120_000 },
  };
}

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
  "landedCost",
] as const;

const RESTRICTED_ROLES: UserRole[] = ["SALES", "RECON", "VIEWER"];

describe("authorization — maskVehicleFinancials", () => {
  it("leaves the record untouched for OWNER and MANAGER", () => {
    for (const role of ["OWNER", "MANAGER"] as UserRole[]) {
      const masked = maskVehicleFinancials(vehicleFixture(), { role });
      expect(masked.acquisitionPriceCents, `${role} keeps acquisition price`).toBe(1_450_000);
      expect(masked.landedCostCents, `${role} keeps landed cost`).toBe(1_661_500);
      expect(masked.estimatedGrossProfitCents, `${role} keeps estimated profit`).toBe(238_000);
      expect(masked.minimumApprovedCents, `${role} keeps the price floor`).toBe(1_799_000);
      expect(masked.landedCost, `${role} keeps the nested breakdown`).toEqual({
        landedCostCents: 1_661_500,
        reconCents: 120_000,
      });
    }
  });

  it("strips every acquisition cost and margin field for restricted roles", () => {
    for (const role of RESTRICTED_ROLES) {
      const masked = maskVehicleFinancials(vehicleFixture(), { role });
      for (const field of COST_FIELDS) {
        expect(masked[field], `${role} must not receive ${field}`).toBeNull();
      }
    }
  });

  it("never lets a restricted role receive a cost value in the serialized payload", () => {
    for (const role of RESTRICTED_ROLES) {
      const serialized = JSON.stringify(maskVehicleFinancials(vehicleFixture(), { role }));
      expect(serialized, `${role} payload leaked acquisition price`).not.toContain("1450000");
      expect(serialized, `${role} payload leaked landed cost`).not.toContain("1661500");
      expect(serialized, `${role} payload leaked recon cost`).not.toContain("120000");
      expect(serialized, `${role} payload leaked estimated profit`).not.toContain("238000");
      expect(serialized, `${role} payload leaked actual profit`).not.toContain("150000");
      expect(serialized, `${role} payload leaked the price floor`).not.toContain("1799000");
    }
  });

  it("keeps the public fields a salesperson needs to quote the car", () => {
    for (const role of RESTRICTED_ROLES) {
      const masked = maskVehicleFinancials(vehicleFixture(), { role });
      expect(masked.id).toBe("veh_1");
      expect(masked.year).toBe(2019);
      expect(masked.make).toBe("Toyota");
      expect(masked.model).toBe("Camry");
      expect(masked.mileage).toBe(68_000);
      expect(masked.askingPriceCents, `${role} must still see the asking price`).toBe(1_899_500);
    }
  });

  it("returns a copy and never mutates the caller's object", () => {
    const vehicle = vehicleFixture();
    const before = JSON.stringify(vehicle);
    maskVehicleFinancials(vehicle, { role: "SALES" });
    expect(JSON.stringify(vehicle)).toBe(before);
  });

  it("does not invent keys that were not on the record", () => {
    const sparse = { id: "veh_2", askingPriceCents: 500_000 };
    const masked = maskVehicleFinancials(sparse, { role: "SALES" });
    expect(Object.keys(masked)).toEqual(["id", "askingPriceCents"]);
    expect("acquisitionPriceCents" in masked).toBe(false);
  });

  it("is deterministic and safe to apply repeatedly", () => {
    const once = maskVehicleFinancials(vehicleFixture(), { role: "SALES" });
    const twice = maskVehicleFinancials(vehicleFixture(), { role: "SALES" });
    expect(once).toEqual(twice);
    expect(maskVehicleFinancials(once, { role: "SALES" })).toEqual(once);
  });

  it("only ever narrows the payload, never widens it", () => {
    const full = vehicleFixture();
    for (const role of RESTRICTED_ROLES) {
      const masked = maskVehicleFinancials(full, { role }) as Record<string, unknown>;
      for (const key of Object.keys(masked)) {
        if (COST_FIELDS.includes(key as (typeof COST_FIELDS)[number])) {
          expect(masked[key]).toBeNull();
        } else {
          expect(masked[key]).toEqual((full as Record<string, unknown>)[key]);
        }
      }
    }
  });
});
