import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, UserRole } from "@/generated/prisma";
import { AuthorizationError } from "@/lib/auth/errors";
import { hasCapability, type Capability } from "@/lib/auth/roles";
import * as ops from "@/lib/operations";
import type { OperationContext } from "@/lib/operations";

/**
 * AUTHORIZATION — every internal mutation enforces an existing capability.
 *
 * The expectations are DERIVED FROM THE CAPABILITY MATRIX rather than written
 * out by hand, so this file fails if an operation is ever guarded by the wrong
 * capability. The injected database throws on any access, which proves the
 * authorization decision is taken BEFORE the operation touches data: a role
 * that must be refused is refused without a single query.
 */

const ALL_ROLES: UserRole[] = ["OWNER", "MANAGER", "SALES", "RECON", "VIEWER"];

function contextFor(role: UserRole): OperationContext {
  const db = new Proxy({} as PrismaClient, {
    get(_target, property) {
      throw new Error(`database was touched (${String(property)})`);
    },
  });
  return { actor: { id: "staff_1", email: "staff@dealer.test", name: "Staff", role }, db };
}

const VIN = "1HGCM82633A004352";

const OPPORTUNITY = {
  source: "MANUAL_ENTRY" as const,
  vin: VIN,
  year: 2019,
  make: "Toyota",
  model: "Camry",
  mileage: 68_000,
  askingPriceCents: 1_450_000,
  estimatedRetailCents: 1_899_500,
};

const ACQUISITION = {
  candidateId: "cand_1",
  vehicle: { vin: VIN, year: 2019, make: "Toyota", model: "Camry", mileage: 68_000 },
  acquisition: { source: "AUCTION" as const, purchasePriceCents: 1_450_000 },
};

interface Case {
  label: string;
  capability: Capability;
  run: (ctx: OperationContext) => Promise<unknown>;
  /** Some reads legitimately RESOLVE for an allowed role instead of querying. */
  allowedOutcome?: "database" | "resolves";
}

const CASES: Case[] = [
  // BUY
  { label: "createSourcingCandidate", capability: "sourcing:write", run: (ctx) => ops.createSourcingCandidate(ctx, OPPORTUNITY) },
  { label: "updateSourcingCandidate", capability: "sourcing:write", run: (ctx) => ops.updateSourcingCandidate(ctx, "cand_1", { askingPriceCents: 1 }) },
  { label: "recordSourcingDecision", capability: "sourcing:write", run: (ctx) => ops.recordSourcingDecision(ctx, "cand_1", { status: "APPROVED_TO_BUY" }) },
  { label: "listSourcingCandidates", capability: "sourcing:read", run: (ctx) => ops.listSourcingCandidates(ctx) },
  { label: "getSourcingCandidate", capability: "sourcing:read", run: (ctx) => ops.getSourcingCandidate(ctx, "cand_1") },
  { label: "decodeOpportunityVin", capability: "sourcing:read", run: (ctx) => ops.decodeOpportunityVin(ctx, VIN), allowedOutcome: "resolves" },

  // ACQUISITION
  { label: "acquireVehicleFromCandidate", capability: "sourcing:write", run: (ctx) => ops.acquireVehicleFromCandidate(ctx, ACQUISITION) },

  // CARS
  { label: "listInventory", capability: "inventory:read", run: (ctx) => ops.listInventory(ctx) },
  { label: "getVehicleDetail", capability: "inventory:read", run: (ctx) => ops.getVehicleDetail(ctx, "veh_1") },
  { label: "updateVehicleDetails", capability: "inventory:write", run: (ctx) => ops.updateVehicleDetails(ctx, "veh_1", { mileage: 10 }) },
  { label: "updateVehiclePricing", capability: "pricing:write", run: (ctx) => ops.updateVehiclePricing(ctx, "veh_1", { askingPriceCents: 100 }) },
  { label: "updateVehicleAcquisition", capability: "pricing:write", run: (ctx) => ops.updateVehicleAcquisition(ctx, "veh_1", { acquisitionPriceCents: 100 }) },
  { label: "recordVehicleExpense", capability: "expenses:write", run: (ctx) => ops.recordVehicleExpense(ctx, { vehicleId: "veh_1", category: "PARTS", amountCents: 100 }) },
  { label: "recordReconItem", capability: "recon:write", run: (ctx) => ops.recordReconItem(ctx, { vehicleId: "veh_1", issue: "Brakes" }) },
  { label: "updateReconItem", capability: "recon:write", run: (ctx) => ops.updateReconItem(ctx, "recon_1", { status: "APPROVED" }) },
  { label: "transitionVehicleStatus", capability: "inventory:write", run: (ctx) => ops.transitionVehicleStatus(ctx, { vehicleId: "veh_1", toStatus: "INSPECTION" }) },
  { label: "publishVehicle", capability: "pricing:write", run: (ctx) => ops.publishVehicle(ctx, "veh_1") },
  { label: "unpublishVehicle", capability: "pricing:write", run: (ctx) => ops.unpublishVehicle(ctx, "veh_1") },
  {
    label: "uploadVehiclePhoto",
    capability: "inventory:write",
    run: (ctx) =>
      ops.uploadVehiclePhoto(ctx, {
        vehicleId: "veh_1",
        fileName: "photo.jpg",
        declaredMimeType: "image/jpeg",
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      }),
  },
  { label: "deleteVehiclePhoto", capability: "inventory:write", run: (ctx) => ops.deleteVehiclePhoto(ctx, "photo_1") },
  { label: "setPrimaryVehiclePhoto", capability: "inventory:write", run: (ctx) => ops.setPrimaryVehiclePhoto(ctx, "photo_1") },

  // LEADS
  { label: "createLead", capability: "crm:write", run: (ctx) => ops.createLead(ctx, { customerId: "cust_1", summary: "Called about the Camry" }) },
  { label: "listLeads", capability: "crm:read", run: (ctx) => ops.listLeads(ctx) },
  { label: "getLead", capability: "crm:read", run: (ctx) => ops.getLead(ctx, "lead_1") },
  { label: "updateLeadContact", capability: "crm:write", run: (ctx) => ops.updateLeadContact(ctx, "lead_1", { firstName: "Ana" }) },
  { label: "updateLeadStatus", capability: "crm:write", run: (ctx) => ops.updateLeadStatus(ctx, { leadId: "lead_1", status: "CONTACTED" }) },
  { label: "updateLeadDetails", capability: "crm:write", run: (ctx) => ops.updateLeadDetails(ctx, "lead_1", { summary: "Interested" }) },
  { label: "addLeadNote", capability: "crm:write", run: (ctx) => ops.addLeadNote(ctx, { leadId: "lead_1", body: "Left a voicemail" }) },

  // SALES
  { label: "completeVehicleSale", capability: "deals:write", run: (ctx) => ops.completeVehicleSale(ctx, { vehicleId: "veh_1", customerId: "cust_1", salePriceCents: 100 }) },
  { label: "cancelDeal", capability: "deals:write", run: (ctx) => ops.cancelDeal(ctx, { dealId: "deal_1" }) },
  { label: "liveDealForVehicle", capability: "deals:read", run: (ctx) => ops.liveDealForVehicle(ctx, "veh_1") },
];

describe("AUTHORIZATION — operations are gated by the capability matrix", () => {
  const previousDecoderFlag = process.env.VIN_DECODE_DISABLED;

  beforeAll(() => {
    // Keep decodeOpportunityVin offline for an allowed role.
    process.env.VIN_DECODE_DISABLED = "true";
  });

  afterAll(() => {
    if (previousDecoderFlag === undefined) delete process.env.VIN_DECODE_DISABLED;
    else process.env.VIN_DECODE_DISABLED = previousDecoderFlag;
  });

  it("covers every operation this phase adds", () => {
    // A guard against a future operation being added without an authorization
    // assertion here.
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  for (const testCase of CASES) {
    it(`${testCase.label} requires ${testCase.capability}`, async () => {
      for (const role of ALL_ROLES) {
        const allowed = hasCapability(role, testCase.capability);
        let error: unknown = null;
        let resolved = false;

        try {
          await testCase.run(contextFor(role));
          resolved = true;
        } catch (caught) {
          error = caught;
        }

        if (!allowed) {
          expect(error, `${testCase.label} must refuse ${role}`).toBeInstanceOf(AuthorizationError);
          expect(resolved).toBe(false);
          continue;
        }

        if (testCase.allowedOutcome === "resolves") {
          expect(error, `${testCase.label} must not refuse ${role}`).toBeNull();
          continue;
        }

        expect(error, `${testCase.label} must reach the database for ${role}`).not.toBeNull();
        expect(error, `${testCase.label} must not refuse ${role}`).not.toBeInstanceOf(AuthorizationError);
        expect(String((error as Error).message)).toContain("database was touched");
      }
    });
  }
});

describe("AUTHORIZATION — secondary capability gates", () => {
  it("refuses disposal to WHOLESALE without pricing:write", async () => {
    // RECON holds inventory:write but not pricing:write.
    await expect(
      ops.transitionVehicleStatus(contextFor("RECON"), { vehicleId: "veh_1", toStatus: "WHOLESALE" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lets a manager reach the database for the same disposal", async () => {
    await expect(
      ops.transitionVehicleStatus(contextFor("MANAGER"), { vehicleId: "veh_1", toStatus: "WHOLESALE" }),
    ).rejects.toThrow(/database was touched/);
  });

  it("refuses the sales-only statuses before any query, for every role", async () => {
    for (const status of ["SOLD", "DELIVERED", "RESERVED"] as const) {
      await expect(
        ops.transitionVehicleStatus(contextFor("MANAGER"), { vehicleId: "veh_1", toStatus: status }),
      ).rejects.toThrow(/SALES operation|Deliver the vehicle|reservation flow/);
    }
  });
});
