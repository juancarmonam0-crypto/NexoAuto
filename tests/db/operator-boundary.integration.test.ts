import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, UserRole } from "@/generated/prisma";

/**
 * The OPERATOR boundary against real PostgreSQL — the full chain:
 *
 *   browser cookie → real session lookup → capability check → operation → DB
 *
 * Only the request runtime is mocked (`next/headers` supplies a cookie,
 * `next/navigation` records the redirect). The session resolution, the
 * capability matrix, the operations and the database are all REAL, which is why
 * this file can prove things the unit tests cannot:
 *
 *   - a status event written by the boundary carries the SESSION user's id
 *   - an anonymous or forbidden caller changes nothing at all
 *   - masking survives the boundary (a salesperson really does get null costs)
 */

const requestState = vi.hoisted(() => ({ sessionToken: undefined as string | undefined }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "dd_session" && requestState.sessionToken
        ? { name, value: requestState.sessionToken }
        : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Headers({ "user-agent": "vitest" })),
}));
vi.mock("next/navigation", () => navigation);

import OperatorLayout from "@/app/(operator)/layout";
import { publishVehicleAction } from "@/app/actions/cars";
import { createLeadAction, updateLeadStatusAction } from "@/app/actions/leads";
import { completeVehicleSaleAction } from "@/app/actions/sales";
import type { SaleCompletedContract } from "@/lib/boundary/contracts";
import { assertMigrated, cleanupRun, createClient, databaseConfigured, id, vehicleInsert } from "./helpers";

const ROLES: UserRole[] = ["OWNER", "SALES", "VIEWER"];

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe.skipIf(!databaseConfigured)("operator boundary (real PostgreSQL)", () => {
  let prisma: PrismaClient;
  const actorIds = new Map<UserRole, string>();
  const tokens = new Map<UserRole, string>();

  const vehicles: string[] = [];
  const customers: string[] = [];
  const leads: string[] = [];

  function track(vehicleId: string): string {
    vehicles.push(vehicleId);
    return vehicleId;
  }

  async function makeCustomer(suffix: string, phone: string): Promise<string> {
    const created = await prisma.customer.create({
      data: { id: id(`opcust_${suffix}`), firstName: "Boundary", lastName: suffix, phone },
      select: { id: true },
    });
    customers.push(created.id);
    return created.id;
  }

  /** A published vehicle created directly, as a previous run would leave it. */
  async function listedVehicle(suffix: string, askingPriceCents = 1_899_500): Promise<string> {
    const vehicleId = track(id(`op${suffix}`));
    await prisma.$executeRawUnsafe(
      vehicleInsert(`op${suffix}`, {
        status: "'LISTED'",
        listingStatus: "'ACTIVE'",
        askingPriceCents: String(askingPriceCents),
        acquisitionPriceCents: "1440000",
      }),
    );
    return vehicleId;
  }

  function saleForm(vehicleId: string, customerId: string, price: string): FormData {
    const formData = new FormData();
    formData.set("vehicleId", vehicleId);
    formData.set("customerId", customerId);
    formData.set("salePrice", price);
    return formData;
  }

  beforeAll(async () => {
    prisma = createClient();
    await assertMigrated(prisma);

    for (const role of ROLES) {
      const user = await prisma.user.create({
        data: {
          id: id(`opuser_${role}`),
          email: `${role.toLowerCase()}.boundary.${id("x").slice(-6)}@dealer.test`.toLowerCase(),
          name: `${role} Fixture`,
          passwordHash: "not-a-real-hash",
          role,
        },
        select: { id: true },
      });
      actorIds.set(role, user.id);

      const token = randomBytes(32).toString("base64url");
      await prisma.session.create({
        data: {
          tokenHash: hashToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      tokens.set(role, token);
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    const byVehicle = { vehicleId: { in: vehicles } };
    // Operation-created rows carry cuids, so they are removed by the ids this
    // run collected rather than by a run prefix. Order matters: a deal RESTRICTs
    // its vehicle and a lead RESTRICTs its customer.
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: leads } } }).catch(() => 0);
    await prisma.lead.deleteMany({ where: { id: { in: leads } } }).catch(() => 0);
    await prisma.deal.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.reservation.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.vehicleStatusEvent.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.vehicleReconItem.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.expense.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.vehiclePhoto.deleteMany({ where: byVehicle }).catch(() => 0);
    await prisma.vehicle.deleteMany({ where: { id: { in: vehicles } } }).catch(() => 0);
    await prisma.customer.deleteMany({ where: { id: { in: customers } } }).catch(() => 0);
    await cleanupRun(prisma);
    await prisma.dealerSettings.deleteMany({ where: { id: "singleton" } }).catch(() => 0);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requestState.sessionToken = undefined;
  });

  describe("route protection", () => {
    it("sends an anonymous visitor from an operator route to the sign-in page", async () => {
      requestState.sessionToken = undefined;

      await expect(OperatorLayout({ children: null })).rejects.toThrow(/NEXT_REDIRECT:\/admin\/login/);
      expect(navigation.redirect).toHaveBeenCalledWith("/admin/login");
    });

    it("renders for an authenticated operator", async () => {
      requestState.sessionToken = tokens.get("OWNER");

      const rendered = await OperatorLayout({ children: null });
      expect(rendered).toBeTruthy();
      expect(navigation.redirect).not.toHaveBeenCalled();
    });

    it("refuses an expired session", async () => {
      const expired = randomBytes(32).toString("base64url");
      await prisma.session.create({
        data: {
          tokenHash: hashToken(expired),
          userId: actorIds.get("OWNER") as string,
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      requestState.sessionToken = expired;

      await expect(OperatorLayout({ children: null })).rejects.toThrow(/NEXT_REDIRECT:\/admin\/login/);
    });
  });

  describe("an authorized mutation reaches the database", () => {
    it("publishes and records the SESSION user as the actor", async () => {
      const vehicleId = track(id("oppublish"));
      await prisma.$executeRawUnsafe(
        vehicleInsert("oppublish", {
          status: "'READY'",
          listingStatus: "'UNLISTED'",
          askingPriceCents: "1899500",
        }),
      );
      requestState.sessionToken = tokens.get("OWNER");

      const formData = new FormData();
      formData.set("vehicleId", vehicleId);
      const result = await publishVehicleAction(formData);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe("LISTED");
        expect(result.data.listingStatus).toBe("ACTIVE");
      }

      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(vehicle.status).toBe("LISTED");
      expect(vehicle.listingStatus).toBe("ACTIVE");
      expect(vehicle.dateListed).toBeInstanceOf(Date);

      // The audit trail names the session user — the browser supplied nothing.
      const event = await prisma.vehicleStatusEvent.findFirstOrThrow({
        where: { vehicleId, toStatus: "LISTED" },
      });
      expect(event.changedById).toBe(actorIds.get("OWNER"));
    });

    it("creates and advances a lead through the boundary", async () => {
      requestState.sessionToken = tokens.get("SALES");

      const createForm = new FormData();
      createForm.set("firstName", "Boundary");
      createForm.set("phone", "5125550199");
      createForm.set("summary", "Asked about the Camry.");
      const created = await createLeadAction(createForm);

      expect(created.ok).toBe(true);
      if (!created.ok) return;
      leads.push(created.data.leadId);
      customers.push(created.data.customerId);

      const statusForm = new FormData();
      statusForm.set("leadId", created.data.leadId);
      statusForm.set("status", "CONTACTED");
      statusForm.set("note", "Called back.");
      const advanced = await updateLeadStatusAction(statusForm);

      expect(advanced.ok).toBe(true);
      if (advanced.ok) expect(advanced.data.status).toBe("CONTACTED");

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: created.data.leadId } });
      expect(lead.status).toBe("CONTACTED");
      expect(lead.lastContactedAt).toBeInstanceOf(Date);

      const activities = await prisma.leadActivity.findMany({ where: { leadId: lead.id } });
      expect(activities.some((activity) => activity.toStatus === "CONTACTED")).toBe(true);
    });
  });

  describe("an unauthorized caller changes nothing", () => {
    it("refuses an anonymous mutation and leaves the vehicle untouched", async () => {
      const vehicleId = track(id("opanon"));
      await prisma.$executeRawUnsafe(
        vehicleInsert("opanon", {
          status: "'READY'",
          listingStatus: "'UNLISTED'",
          askingPriceCents: "1899500",
        }),
      );
      requestState.sessionToken = undefined;

      const formData = new FormData();
      formData.set("vehicleId", vehicleId);
      const result = await publishVehicleAction(formData);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("UNAUTHORIZED");

      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(vehicle.status).toBe("READY");
      expect(await prisma.vehicleStatusEvent.count({ where: { vehicleId } })).toBe(0);
    });

    it("refuses a viewer mutation and leaves the vehicle untouched", async () => {
      const vehicleId = track(id("opviewer"));
      await prisma.$executeRawUnsafe(
        vehicleInsert("opviewer", {
          status: "'READY'",
          listingStatus: "'UNLISTED'",
          askingPriceCents: "1899500",
        }),
      );
      requestState.sessionToken = tokens.get("VIEWER");

      const formData = new FormData();
      formData.set("vehicleId", vehicleId);
      const publishResult = await publishVehicleAction(formData);

      expect(publishResult.ok).toBe(false);
      if (!publishResult.ok) expect(publishResult.code).toBe("FORBIDDEN");

      const leadForm = new FormData();
      leadForm.set("firstName", "Should");
      leadForm.set("phone", "5125550100");
      const leadResult = await createLeadAction(leadForm);

      expect(leadResult.ok).toBe(false);
      if (!leadResult.ok) expect(leadResult.code).toBe("FORBIDDEN");

      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(vehicle.status).toBe("READY");
      expect(await prisma.lead.count({ where: { customer: { phone: "5125550100" } } })).toBe(0);
    });
  });

  describe("masking survives the boundary", () => {
    async function sellAs(role: UserRole, suffix: string): Promise<SaleCompletedContract> {
      requestState.sessionToken = tokens.get(role);
      const vehicleId = await listedVehicle(suffix);
      const customerId = await makeCustomer(suffix, `512555${suffix.length}${suffix.charCodeAt(0)}`.slice(0, 10));

      const result = await completeVehicleSaleAction(saleForm(vehicleId, customerId, "19500"));
      expect(result.ok, `${role} should be able to complete a sale`).toBe(true);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    }

    it("hands a salesperson the sale price but no cost basis", async () => {
      const sale = await sellAs("SALES", "mask1");

      expect(sale.finalSalePriceCents).toBe(1_950_000);
      expect(sale.vehicleStatus).toBe("SOLD");
      expect(sale.landedCostCents).toBeNull();
      expect(sale.actualGrossProfitCents).toBeNull();
      expect(sale.actualRoiBasisPoints).toBeNull();

      const serialized = JSON.stringify(sale);
      expect(serialized).not.toContain("1440000");
      expect(serialized).not.toMatch(/landedCostCents":\s*\d/);
    });

    it("hands the owner the real economics", async () => {
      const sale = await sellAs("OWNER", "mask2");

      expect(sale.finalSalePriceCents).toBe(1_950_000);
      expect(sale.landedCostCents).toBe(1_440_000);
      expect(sale.actualGrossProfitCents).toBe(510_000);
      expect(sale.actualRoiBasisPoints).toBe(Math.round((510_000 / 1_440_000) * 10_000));
    });

    it("keeps every result serializable", async () => {
      const sale = await sellAs("OWNER", "mask3");
      expect(typeof sale.saleDateIso).toBe("string");
      expect(sale).not.toHaveProperty("saleDate");
      expect(JSON.parse(JSON.stringify(sale))).toEqual(sale);
    });
  });
});
