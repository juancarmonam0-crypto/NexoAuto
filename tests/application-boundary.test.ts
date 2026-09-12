import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { UserRole } from "@/generated/prisma";

/**
 * The APPLICATION BOUNDARY, unit-tested.
 *
 * What is being proved here is the boundary itself, not the dealership logic —
 * the operations already have 368 tests of their own. Specifically:
 *
 *   1. the actor comes from the SESSION and never from the browser
 *   2. a forbidden role is refused BEFORE the operation runs
 *   3. a permitted call reaches the canonical operation, with form values
 *      converted (dollars → integer cents) and nothing invented
 *   4. errors become stable CODES with browser-safe messages
 *   5. results are serializable: no Date, no bigint, no internal object
 *
 * The session, the request runtime and the database are mocked, so no server
 * runtime and no PostgreSQL are involved. `@/lib/operations` is only PARTIALLY
 * mocked: constants, schemas and the sourcing engine stay real.
 */

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
const ops = vi.hoisted(() => ({
  createSourcingCandidate: vi.fn(),
  publishVehicle: vi.fn(),
  completeVehicleSale: vi.fn(),
  createLead: vi.fn(),
  updateLeadStatus: vi.fn(),
}));
const db = vi.hoisted(() => {
  const settings = { minGrossProfitCents: 150_000, minRoiBasisPoints: 1_000 };
  return {
    dealerSettings: {
      findUnique: vi.fn(async () => settings),
      create: vi.fn(async () => settings),
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => navigation);
vi.mock("@/lib/db", () => ({ prisma: db, isDatabaseConfigured: () => false }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: session.getCurrentUser,
  createSession: vi.fn(),
  destroyCurrentSession: vi.fn(),
  SESSION_COOKIE_NAME: "dd_session",
}));
vi.mock("@/lib/operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/operations")>()),
  createSourcingCandidate: ops.createSourcingCandidate,
  publishVehicle: ops.publishVehicle,
  completeVehicleSale: ops.completeVehicleSale,
  createLead: ops.createLead,
  updateLeadStatus: ops.updateLeadStatus,
}));

import { createSourcingCandidateAction, evaluateOpportunityAction } from "@/app/actions/buy";
import { publishVehicleAction } from "@/app/actions/cars";
import { createLeadAction, updateLeadStatusAction } from "@/app/actions/leads";
import { completeVehicleSaleAction } from "@/app/actions/sales";
import { AuthorizationError } from "@/lib/auth/errors";
import { ConflictError } from "@/lib/domain-errors";
import { InvalidLeadTransitionError } from "@/lib/lead-status";
import type { OperationContext } from "@/lib/operations";

const EVALUATION = {
  landedCostCents: 1_647_000,
  expectedProfitCents: 252_500,
  expectedRoiBasisPoints: 1_533,
  maxPurchasePriceCents: 1_529_800,
  maxBidCents: 1_529_800,
  bindingConstraint: "roi-floor" as const,
  recommendation: "BUY" as const,
  reasons: ["Asking is at or below your maximum purchase price."],
};

function signedInAs(role: UserRole, id = "staff_1") {
  session.getCurrentUser.mockResolvedValue({
    id,
    email: `${role.toLowerCase()}@dealer.test`,
    name: `${role} Fixture`,
    role,
  });
}

function opportunityForm(): FormData {
  const formData = new FormData();
  formData.set("askingPrice", "$18,500");
  formData.set("estimatedRetail", "22,000");
  formData.set("auctionFees", "450");
  formData.set("transport", "320");
  formData.set("estimatedRecon", "1,200");
  formData.set("vin", "1HGCM82633A004352");
  formData.set("make", "Toyota");
  return formData;
}

function saleForm(): FormData {
  const formData = new FormData();
  formData.set("vehicleId", "veh_1");
  formData.set("customerId", "cust_1");
  formData.set("salePrice", "19500");
  return formData;
}

/** Every leaf a browser can receive must be a JSON primitive. */
function expectSerializable(value: unknown, path = "result"): void {
  if (value === null) return;
  const type = typeof value;
  if (type === "string" || type === "boolean") return;
  if (type === "number") {
    expect(Number.isFinite(value as number), `${path} must be a finite number`).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectSerializable(item, `${path}[${index}]`));
    return;
  }
  expect(value, `${path} must not be a Date`).not.toBeInstanceOf(Date);
  expect(value, `${path} must not be a bigint`).not.toBeTypeOf("bigint");
  expect(type, `${path} must be a plain object, received ${String(value)}`).toBe("object");
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    expectSerializable(child, `${path}.${key}`);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  session.getCurrentUser.mockResolvedValue(null);
});

describe("AUTH — the browser cannot supply identity", () => {
  it("refuses a protected operator mutation for an anonymous caller", async () => {
    session.getCurrentUser.mockResolvedValue(null);

    const result = await createSourcingCandidateAction(opportunityForm());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNAUTHORIZED");
      expect(result.error).toMatch(/sign in/i);
    }
    expect(ops.createSourcingCandidate).not.toHaveBeenCalled();
  });

  it("refuses a signed-in role that lacks the capability, before the operation runs", async () => {
    signedInAs("VIEWER");

    const result = await createSourcingCandidateAction(opportunityForm());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
    expect(ops.createSourcingCandidate).not.toHaveBeenCalled();
  });

  it("lets a permitted role reach the canonical operation", async () => {
    signedInAs("MANAGER");
    ops.createSourcingCandidate.mockResolvedValue({
      candidateId: "cand_1",
      candidate: { id: "cand_1", status: "INBOX", evaluatedAt: new Date("2026-03-01T00:00:00.000Z") },
      evaluation: EVALUATION,
    });

    const result = await createSourcingCandidateAction(opportunityForm());

    expect(result.ok).toBe(true);
    expect(ops.createSourcingCandidate).toHaveBeenCalledTimes(1);
    const [ctx, input] = ops.createSourcingCandidate.mock.calls[0] as [OperationContext, Record<string, unknown>];
    expect(ctx.actor).toEqual({
      id: "staff_1",
      email: "manager@dealer.test",
      name: "MANAGER Fixture",
      role: "MANAGER",
    });
    expect(result.ok && result.data.candidateId).toBe("cand_1");
    expect(result.ok && result.data.recommendation).toBe("BUY");
    // Form money is converted at the boundary, exactly once, to integer cents.
    expect(input.askingPriceCents).toBe(1_850_000);
    expect(input.estimatedRetailCents).toBe(2_200_000);
    expect(input.expectedAuctionFeesCents).toBe(45_000);
    expect(input.transportEstimateCents).toBe(32_000);
  });

  it("cannot be spoofed with actor, role or capability fields in the form", async () => {
    signedInAs("MANAGER", "staff_real");
    ops.createSourcingCandidate.mockResolvedValue({
      candidateId: "cand_1",
      candidate: { id: "cand_1", status: "INBOX", evaluatedAt: null },
      evaluation: EVALUATION,
    });

    const formData = opportunityForm();
    formData.set("actorId", "attacker");
    formData.set("actor_id", "attacker");
    formData.set("role", "OWNER");
    formData.set("capabilities", "users:manage,settings:write");
    formData.set("userId", "attacker");

    await createSourcingCandidateAction(formData);

    const [ctx, input] = ops.createSourcingCandidate.mock.calls[0] as [OperationContext, Record<string, unknown>];
    expect(ctx.actor.id).toBe("staff_real");
    expect(ctx.actor.role).toBe("MANAGER");
    // The spoofed fields are not part of the operation input either.
    expect(input).not.toHaveProperty("actorId");
    expect(input).not.toHaveProperty("role");
    expect(input).not.toHaveProperty("capabilities");
  });

  it("refuses an anonymous caller on each of the four concepts", async () => {
    session.getCurrentUser.mockResolvedValue(null);

    const results = await Promise.all([
      createSourcingCandidateAction(opportunityForm()),
      publishVehicleAction(new FormData()),
      createLeadAction(new FormData()),
      completeVehicleSaleAction(saleForm()),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("UNAUTHORIZED");
    }
    expect(ops.publishVehicle).not.toHaveBeenCalled();
    expect(ops.createLead).not.toHaveBeenCalled();
    expect(ops.completeVehicleSale).not.toHaveBeenCalled();
  });
});

describe("BUY — the boundary adds no economics of its own", () => {
  it("returns the canonical engine's verdict for an evaluation request", async () => {
    signedInAs("MANAGER");

    const formData = opportunityForm();
    formData.set("askingPrice", "14500");
    formData.set("estimatedRetail", "18995");
    formData.set("auctionFees", "450");
    formData.set("transport", "320");
    formData.set("estimatedRecon", "1200");

    const result = await evaluateOpportunityAction(formData);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Identical to the numbers the Phase 5 vertical slice asserts.
      expect(result.data.landedCostCents).toBe(1_647_000);
      expect(result.data.expectedProfitCents).toBe(252_500);
      expect(result.data.maxPurchasePriceCents).toBe(1_529_800);
      expect(result.data.maxBidCents).toBe(1_529_800);
      expect(result.data.bindingConstraint).toBe("roi-floor");
      expect(result.data.recommendation).toBe("BUY");
      expect(result.data.reasons.length).toBeGreaterThan(0);
    }
    // Evaluation is a read: nothing is persisted.
    expect(ops.createSourcingCandidate).not.toHaveBeenCalled();
  });

  it("reports a missing money field as a validation failure naming the field", async () => {
    signedInAs("MANAGER");
    const formData = opportunityForm();
    formData.delete("askingPrice");

    const result = await createSourcingCandidateAction(formData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(result.fieldErrors?.askingPrice?.[0]).toMatch(/required/i);
    }
  });

  it("rejects a non-numeric amount instead of guessing", async () => {
    signedInAs("MANAGER");
    const formData = opportunityForm();
    formData.set("askingPrice", "about eighteen thousand");

    const result = await createSourcingCandidateAction(formData);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });
});

describe("CARS — mutations delegate and stay masked", () => {
  it("publishes through the canonical operation", async () => {
    signedInAs("MANAGER");
    ops.publishVehicle.mockResolvedValue({
      id: "veh_1",
      status: "LISTED",
      listingStatus: "ACTIVE",
      askingPriceCents: 1_999_500,
      landedCostCents: 1_731_500,
    });

    const formData = new FormData();
    formData.set("vehicleId", "veh_1");
    const result = await publishVehicleAction(formData);

    expect(result.ok).toBe(true);
    const [ctx, vehicleId] = ops.publishVehicle.mock.calls[0] as [OperationContext, string];
    expect(ctx.actor.role).toBe("MANAGER");
    expect(vehicleId).toBe("veh_1");
    expect(result.ok && result.data.status).toBe("LISTED");
    expect(result.ok && result.data.listingStatus).toBe("ACTIVE");
  });

  it("refuses publication to a role without pricing:write", async () => {
    signedInAs("SALES");

    const formData = new FormData();
    formData.set("vehicleId", "veh_1");
    const result = await publishVehicleAction(formData);

    // SALES holds deals:write but not pricing:write, so publication is refused
    // outright rather than reaching the operation with a masked payload.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
    expect(ops.publishVehicle).not.toHaveBeenCalled();
  });
});

describe("LEADS — delegation and state-machine errors", () => {
  it("creates a lead through the canonical operation", async () => {
    signedInAs("SALES");
    ops.createLead.mockResolvedValue({
      id: "lead_1",
      customerId: "cust_1",
      status: "NEW",
      vehicleId: null,
    });

    const formData = new FormData();
    formData.set("firstName", "Marisol");
    formData.set("phone", "5125550143");

    const result = await createLeadAction(formData);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual({
      leadId: "lead_1",
      customerId: "cust_1",
      status: "NEW",
      vehicleId: null,
    });
  });

  it("maps an illegal lead transition to INVALID_STATE", async () => {
    signedInAs("SALES");
    ops.updateLeadStatus.mockRejectedValue(new InvalidLeadTransitionError("NEW", "WON"));

    const formData = new FormData();
    formData.set("leadId", "lead_1");
    formData.set("status", "WON");

    const result = await updateLeadStatusAction(formData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_STATE");
      expect(result.error).toBe("A lead cannot move from New to Won.");
    }
  });

  it("refuses a status value the enum does not contain", async () => {
    signedInAs("SALES");
    const formData = new FormData();
    formData.set("leadId", "lead_1");
    formData.set("status", "SOLD");

    const result = await updateLeadStatusAction(formData);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
    expect(ops.updateLeadStatus).not.toHaveBeenCalled();
  });
});

describe("SALES — completion delegates and dates cross as strings", () => {
  it("returns the operation's economics with an ISO date", async () => {
    signedInAs("MANAGER");
    ops.completeVehicleSale.mockResolvedValue({
      dealId: "deal_1",
      vehicleId: "veh_1",
      customerId: "cust_1",
      dealStatus: "CONTRACTED",
      vehicleStatus: "SOLD",
      finalSalePriceCents: 1_950_000,
      saleDate: new Date("2026-03-06T00:00:00.000Z"),
      daysInInventory: 50,
      landedCostCents: 1_731_500,
      actualGrossProfitCents: 218_500,
      actualRoiBasisPoints: 1_262,
    });

    const result = await completeVehicleSaleAction(saleForm());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.saleDateIso).toBe("2026-03-06T00:00:00.000Z");
      expect(result.data).not.toHaveProperty("saleDate");
      expect(result.data.actualGrossProfitCents).toBe(218_500);
      expectSerializable(result.data);
      expect(JSON.parse(JSON.stringify(result.data))).toEqual(result.data);
    }
  });

  it("returns a stable code when the sale conflicts with the current state", async () => {
    signedInAs("MANAGER");
    ops.completeVehicleSale.mockRejectedValue(new ConflictError("That vehicle is already sold."));

    const result = await completeVehicleSaleAction(saleForm());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFLICT");
      expect(result.error).toBe("That vehicle is already sold.");
    }
  });
});

describe("ERRORS — stable codes, no internals", () => {
  const cases: Array<[string, unknown, string]> = [
    ["an unauthenticated guard", new AuthorizationError("Sign in again.", "unauthenticated"), "UNAUTHORIZED"],
    ["a forbidden guard", new AuthorizationError(), "FORBIDDEN"],
    ["a domain conflict", new ConflictError("Nope."), "CONFLICT"],
    ["a validation error", new ZodError([]), "VALIDATION_ERROR"],
    ["an unexpected failure", new Error("connect ECONNREFUSED 127.0.0.1:5432"), "INTERNAL_ERROR"],
  ];

  for (const [label, error, expectedCode] of cases) {
    it(`classifies ${label} as ${expectedCode}`, async () => {
      signedInAs("MANAGER");
      ops.createSourcingCandidate.mockRejectedValue(error);

      const result = await createSourcingCandidateAction(opportunityForm());

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(expectedCode);
      expectSerializable(result);
    });
  }

  it("never leaks a database or driver message to the browser", async () => {
    signedInAs("MANAGER");
    ops.createSourcingCandidate.mockRejectedValue(
      new Error('relation "public.vehicles" does not exist at db.$queryRawUnsafe'),
    );

    const result = await createSourcingCandidateAction(opportunityForm());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INTERNAL_ERROR");
      expect(result.error).toBe("Something went wrong. The action was not saved.");
      expect(result.error).not.toMatch(/vehicles|relation|queryRaw|ECONNREFUSED/i);
    }
  });
});

describe("SERIALIZATION — a success result is JSON-safe", () => {
  it("contains only primitives, arrays and plain objects", async () => {
    signedInAs("MANAGER");
    ops.createSourcingCandidate.mockResolvedValue({
      candidateId: "cand_1",
      candidate: { id: "cand_1", status: "INBOX", evaluatedAt: new Date("2026-03-01T00:00:00.000Z") },
      evaluation: EVALUATION,
    });

    const result = await createSourcingCandidateAction(opportunityForm());

    expect(result.ok).toBe(true);
    expectSerializable(result);
    if (result.ok) {
      expect(result.data.evaluatedAtIso).toBe("2026-03-01T00:00:00.000Z");
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
  });
});
