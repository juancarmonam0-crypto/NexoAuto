import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { PrismaClient, UserRole } from "@/generated/prisma";
import { AuthorizationError } from "@/lib/auth/errors";
import { evaluateSourcingCandidate } from "@/lib/sourcing";
import {
  createSourcingCandidate,
  decodeOpportunityVin,
  evaluateOpportunity,
  opportunitySchema,
  resolveSourcingThresholds,
  type OpportunityInput,
  type OperationContext,
} from "@/lib/operations";

/**
 * BUY — the sourcing operations must be a thin, authorized shell over the
 * canonical engine. These tests exist to prove there is no second formula:
 * every number is compared against `evaluateSourcingCandidate()` itself.
 */

const THRESHOLDS = { minGrossProfitCents: 150_000, minRoiBasisPoints: 1_000 };

function actorFor(role: UserRole) {
  return { id: "staff_1", email: "staff@dealer.test", name: "Staff", role };
}

/**
 * A Prisma stand-in that EXPLODES if any query is attempted. Using it proves a
 * unit test never silently depends on a database, and that validation and
 * authorization happen before persistence.
 */
function explodingDb(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, property) {
      throw new Error(`database was touched before it should have been (${String(property)})`);
    },
  });
}

function contextFor(role: UserRole): OperationContext {
  return { actor: actorFor(role), db: explodingDb() };
}

const OPPORTUNITY: OpportunityInput = {
  source: "AUCTION_FEED",
  vin: "1HGCM82633A004352",
  year: 2019,
  make: "Toyota",
  model: "Camry",
  mileage: 68_000,
  askingPriceCents: 1_450_000,
  expectedAuctionFeesCents: 45_000,
  transportEstimateCents: 32_000,
  estimatedReconCents: 120_000,
  otherCostsCents: 0,
  estimatedRetailCents: 1_899_500,
};

describe("BUY — evaluateOpportunity delegates to the canonical engine", () => {
  it("returns exactly what evaluateSourcingCandidate returns for the same inputs", () => {
    const viaOperation = evaluateOpportunity(OPPORTUNITY, THRESHOLDS);
    const viaEngine = evaluateSourcingCandidate({
      askingPriceCents: 1_450_000,
      expectedAuctionFeesCents: 45_000,
      transportEstimateCents: 32_000,
      estimatedReconCents: 120_000,
      otherCostsCents: 0,
      estimatedRetailCents: 1_899_500,
      minGrossProfitCents: 150_000,
      minRoiBasisPoints: 1_000,
    });
    expect(viaOperation).toEqual(viaEngine);
  });

  it("computes the documented numbers for a clean auction opportunity", () => {
    const evaluation = evaluateOpportunity(OPPORTUNITY, THRESHOLDS);
    expect(evaluation.addedCostsCents).toBe(197_000);
    expect(evaluation.landedCostCents).toBe(1_647_000);
    expect(evaluation.expectedProfitCents).toBe(252_500);
    expect(evaluation.expectedRoiBasisPoints).toBe(1_533);
    expect(evaluation.maxPurchasePriceCents).toBe(1_529_800);
    expect(evaluation.maxBidCents).toBe(evaluation.maxPurchasePriceCents);
    expect(evaluation.bindingConstraint).toBe("roi-floor");
    expect(evaluation.recommendation).toBe("BUY");
    expect(evaluation.reasons.length).toBeGreaterThan(0);
  });

  it("applies the dealership thresholds when the opportunity omits them", () => {
    const withoutThresholds: OpportunityInput = { ...OPPORTUNITY };
    delete withoutThresholds.minGrossProfitCents;
    delete withoutThresholds.minRoiBasisPoints;

    const evaluation = evaluateOpportunity(withoutThresholds, THRESHOLDS);
    expect(evaluation.maxPurchasePriceCents).toBe(
      evaluateOpportunity(OPPORTUNITY, THRESHOLDS).maxPurchasePriceCents,
    );
  });

  it("lets an explicit opportunity threshold override the dealership configuration", () => {
    const strict = evaluateOpportunity({ ...OPPORTUNITY, minGrossProfitCents: 400_000 }, THRESHOLDS);
    const configured = evaluateOpportunity(OPPORTUNITY, THRESHOLDS);
    expect(strict.maxPurchasePriceCents).toBeLessThan(configured.maxPurchasePriceCents);
    expect(strict.recommendation).not.toBe("BUY");
  });

  it("never recommends BUY without a retail estimate", () => {
    const evaluation = evaluateOpportunity({ ...OPPORTUNITY, estimatedRetailCents: 0 }, THRESHOLDS);
    expect(evaluation.recommendation).toBe("WATCH");
    expect(evaluation.reasons.join(" ")).toContain("cannot be scored");
  });

  it("recommends PASS for a unit that loses money as priced", () => {
    const evaluation = evaluateOpportunity(
      { ...OPPORTUNITY, askingPriceCents: 1_900_000, estimatedRetailCents: 1_899_500 },
      THRESHOLDS,
    );
    expect(evaluation.recommendation).toBe("PASS");
    expect(evaluation.expectedProfitCents).toBeLessThan(0);
  });
});

describe("BUY — dealer threshold resolution", () => {
  it("reads the floors from dealer settings", () => {
    expect(resolveSourcingThresholds({ minGrossProfitCents: 150_000, minRoiBasisPoints: 1_000 })).toEqual({
      minGrossProfitCents: 150_000,
      minRoiBasisPoints: 1_000,
    });
  });

  it("never produces a negative ROI floor", () => {
    expect(resolveSourcingThresholds({ minGrossProfitCents: 0, minRoiBasisPoints: -500 }).minRoiBasisPoints).toBe(0);
  });
});

describe("BUY — input validation happens before any persistence", () => {
  const invalidCases: Array<[string, Record<string, unknown>]> = [
    ["negative asking price", { askingPriceCents: -1 }],
    ["fractional cents", { askingPriceCents: 1_450_000.5 }],
    ["negative fees", { expectedAuctionFeesCents: -100 }],
    ["an impossible year", { year: 1500 }],
    ["negative mileage", { mileage: -5 }],
    ["a malformed VIN", { vin: "NOTAVIN" }],
    ["a missing asking price", { askingPriceCents: undefined }],
    ["a missing retail estimate", { estimatedRetailCents: undefined }],
  ];

  for (const [label, patch] of invalidCases) {
    it(`rejects ${label} without touching the database`, async () => {
      const ctx = contextFor("OWNER");
      const input = { ...OPPORTUNITY, ...patch } as OpportunityInput;
      await expect(createSourcingCandidate(ctx, input)).rejects.toBeInstanceOf(ZodError);
    });
  }

  it("accepts a well-formed input far enough to reach persistence", async () => {
    const ctx = contextFor("OWNER");
    await expect(createSourcingCandidate(ctx, OPPORTUNITY)).rejects.toThrow(/database was touched/);
  });

  it("normalises a VIN written in lower case with separators", () => {
    const parsed = opportunitySchema.parse({ ...OPPORTUNITY, vin: " 1hg-cm82633a004352 " });
    expect(parsed.vin).toBe("1HGCM82633A004352");
  });
});

describe("BUY — VIN decoding uses the provider boundary", () => {
  it("refuses an undecodable VIN without any network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const ctx = contextFor("OWNER");
      await expect(decodeOpportunityVin(ctx, "SHORTVIN")).rejects.toBeInstanceOf(ZodError);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reports the decoder as unavailable when it is disabled by configuration", async () => {
    const previous = process.env.VIN_DECODE_DISABLED;
    process.env.VIN_DECODE_DISABLED = "true";
    try {
      const ctx = contextFor("OWNER");
      const result = await decodeOpportunityVin(ctx, "1HGCM82633A004352");
      expect(result.status).toBe("unavailable");
      expect(result.message).toContain("disabled");
    } finally {
      if (previous === undefined) delete process.env.VIN_DECODE_DISABLED;
      else process.env.VIN_DECODE_DISABLED = previous;
    }
  });

  it("requires sourcing:read, not just a signed-in user", async () => {
    await expect(decodeOpportunityVin(contextFor("RECON"), "1HGCM82633A004352")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
