import { describe, expect, it } from "vitest";
import {
  ABOVE_RATE_POLICY,
  FINANCE_RATE_POLICIES,
  NO_RATE_POLICY_CONFIGURED,
  RATE_POLICY_DISCLAIMER,
  WITHIN_RATE_POLICY,
  evaluateFinanceRate,
  ratePolicyHeadroomBasisPoints,
  selectFinanceRatePolicy,
  type FinanceRatePolicy,
} from "@/lib/rate-policy";

/**
 * Phase 9B — the versioned finance rate-policy boundary.
 *
 * The point of this module is that the software ships NO jurisdiction's number.
 * The engine does the arithmetic; a dealer supplies a sourced ceiling. Every
 * test below therefore checks the boundary, the window and the LANGUAGE, because
 * a passing ceiling is not a legal determination and the product must never say
 * that it is.
 */

const SOURCE = {
  label: "Dealer compliance manual",
  reference: "Section 4.2, used-vehicle rate ceiling",
  retrievedOn: "2025-01-02",
} as const;

function policy(overrides: Partial<FinanceRatePolicy> & { id: string }): FinanceRatePolicy {
  return {
    jurisdiction: "TX",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    maxAprBasisPoints: 1_800,
    source: SOURCE,
    ...overrides,
  };
}

const ACTIVE = policy({ id: "TX-ACTIVE" });
const EXPIRED = policy({ id: "TX-EXPIRED", effectiveFrom: "2023-01-01", effectiveTo: "2024-01-01" });
const FUTURE = policy({ id: "TX-FUTURE", effectiveFrom: "2026-01-01" });

describe("rate-policy — selectFinanceRatePolicy: jurisdiction", () => {
  it("matches the jurisdiction case-insensitively", () => {
    expect(selectFinanceRatePolicy([ACTIVE], { jurisdiction: "TX", asOf: "2025-06-01" })?.id).toBe("TX-ACTIVE");
    expect(selectFinanceRatePolicy([ACTIVE], { jurisdiction: "tx", asOf: "2025-06-01" })?.id).toBe("TX-ACTIVE");
    expect(selectFinanceRatePolicy([ACTIVE], { jurisdiction: " tX ", asOf: "2025-06-01" })?.id).toBe("TX-ACTIVE");
    // The policy's own code is normalised the same way.
    const lowerCasePolicy = policy({ id: "TX-LOWER", jurisdiction: "tx" });
    expect(selectFinanceRatePolicy([lowerCasePolicy], { jurisdiction: "TX", asOf: "2025-06-01" })?.id).toBe("TX-LOWER");
  });

  it("does not match a different jurisdiction", () => {
    expect(selectFinanceRatePolicy([ACTIVE], { jurisdiction: "OK", asOf: "2025-06-01" })).toBeNull();
    expect(selectFinanceRatePolicy([ACTIVE], { jurisdiction: "", asOf: "2025-06-01" })).toBeNull();
  });

  it("returns null rather than a fabricated policy when none is configured", () => {
    expect(selectFinanceRatePolicy([], { jurisdiction: "TX", asOf: "2025-06-01" })).toBeNull();
  });
});

describe("rate-policy — selectFinanceRatePolicy: the effective window", () => {
  it("includes the policy on its effectiveFrom date", () => {
    expect(selectFinanceRatePolicy([ACTIVE], { jurisdiction: "TX", asOf: "2025-01-01" })?.id).toBe("TX-ACTIVE");
    // A Date object is accepted for exactly the same instant.
    expect(
      selectFinanceRatePolicy([ACTIVE], { jurisdiction: "TX", asOf: new Date("2025-01-01T00:00:00Z") })?.id,
    ).toBe("TX-ACTIVE");
  });

  it("excludes the policy on its effectiveTo date", () => {
    // effectiveTo is EXCLUSIVE: the window is [from, to).
    expect(selectFinanceRatePolicy([EXPIRED], { jurisdiction: "TX", asOf: "2023-12-31T23:59:59Z" })?.id).toBe(
      "TX-EXPIRED",
    );
    expect(selectFinanceRatePolicy([EXPIRED], { jurisdiction: "TX", asOf: "2024-01-01" })).toBeNull();
  });

  it("does not select an expired policy", () => {
    expect(selectFinanceRatePolicy([EXPIRED], { jurisdiction: "TX", asOf: "2025-06-01" })).toBeNull();
  });

  it("does not select a policy that has not taken effect yet", () => {
    expect(selectFinanceRatePolicy([FUTURE], { jurisdiction: "TX", asOf: "2025-06-01" })).toBeNull();
    expect(selectFinanceRatePolicy([FUTURE], { jurisdiction: "TX", asOf: "2026-01-01" })?.id).toBe("TX-FUTURE");
  });

  it("selects the policy covering the deal date out of several versions", () => {
    const policies = [EXPIRED, ACTIVE, FUTURE];
    expect(selectFinanceRatePolicy(policies, { jurisdiction: "TX", asOf: "2023-06-01" })?.id).toBe("TX-EXPIRED");
    expect(selectFinanceRatePolicy(policies, { jurisdiction: "TX", asOf: "2025-06-01" })?.id).toBe("TX-ACTIVE");
    expect(selectFinanceRatePolicy(policies, { jurisdiction: "TX", asOf: "2026-06-01" })?.id).toBe("TX-FUTURE");
    // A date before every window selects nothing.
    expect(selectFinanceRatePolicy(policies, { jurisdiction: "TX", asOf: "2020-01-01" })).toBeNull();
  });

  it("throws a RangeError for a date that is not ISO-8601", () => {
    expect(() => selectFinanceRatePolicy([ACTIVE], { jurisdiction: "TX", asOf: "not-a-date" })).toThrow(RangeError);
    expect(() =>
      selectFinanceRatePolicy([policy({ id: "TX-BAD", effectiveFrom: "nonsense" })], {
        jurisdiction: "TX",
        asOf: "2025-06-01",
      }),
    ).toThrow(RangeError);
  });
});

describe("rate-policy — selectFinanceRatePolicy: vehicle scope and specificity", () => {
  it("enforces a bounded-age policy and skips a vehicle outside it", () => {
    const bounded = policy({ id: "TX-AGE-5", vehicleAgeMaxYears: 5 });
    // 2025 - 2020 = 5 years old, still inside the bound.
    expect(selectFinanceRatePolicy([bounded], { jurisdiction: "TX", asOf: "2025-06-01", vehicleModelYear: 2020 })?.id).toBe(
      "TX-AGE-5",
    );
    // 2025 - 2019 = 6 years old, outside it.
    expect(
      selectFinanceRatePolicy([bounded], { jurisdiction: "TX", asOf: "2025-06-01", vehicleModelYear: 2019 }),
    ).toBeNull();
  });

  it("does not match a bounded-age policy when the model year is unknown", () => {
    // A bounded policy cannot be applied to a vehicle it cannot date, so it must
    // not be applied at all — "unknown" is not "young".
    const bounded = policy({ id: "TX-AGE-5", vehicleAgeMaxYears: 5 });
    expect(selectFinanceRatePolicy([bounded], { jurisdiction: "TX", asOf: "2025-06-01" })).toBeNull();
    expect(
      selectFinanceRatePolicy([bounded], { jurisdiction: "TX", asOf: "2025-06-01", vehicleModelYear: null }),
    ).toBeNull();
  });

  it("respects a NEW / USED vehicle class", () => {
    const newOnly = policy({ id: "TX-NEW", vehicleClass: "NEW" });
    const usedOnly = policy({ id: "TX-USED", vehicleClass: "USED" });
    // 2025 model year in 2025 is new.
    expect(selectFinanceRatePolicy([newOnly], { jurisdiction: "TX", asOf: "2025-06-01", vehicleModelYear: 2025 })?.id).toBe(
      "TX-NEW",
    );
    expect(
      selectFinanceRatePolicy([usedOnly], { jurisdiction: "TX", asOf: "2025-06-01", vehicleModelYear: 2025 }),
    ).toBeNull();
    // 2021 is used.
    expect(selectFinanceRatePolicy([usedOnly], { jurisdiction: "TX", asOf: "2025-06-01", vehicleModelYear: 2021 })?.id).toBe(
      "TX-USED",
    );
    expect(
      selectFinanceRatePolicy([newOnly], { jurisdiction: "TX", asOf: "2025-06-01", vehicleModelYear: 2021 }),
    ).toBeNull();
    // A class policy needs a model year to decide with.
    expect(selectFinanceRatePolicy([newOnly], { jurisdiction: "TX", asOf: "2025-06-01" })).toBeNull();
    // A future model year counts as new, not as a negative age.
    expect(selectFinanceRatePolicy([newOnly], { jurisdiction: "TX", asOf: "2025-06-01", vehicleModelYear: 2026 })?.id).toBe(
      "TX-NEW",
    );
  });

  it("prefers the most specific policy over an unbounded one", () => {
    // Both are eligible; the one that actually bounds the vehicle's age wins,
    // because the dealer took the trouble to scope it.
    const unbounded = policy({ id: "TX-ANY" });
    const bounded = policy({ id: "TX-AGE-10", vehicleAgeMaxYears: 10 });
    const selected = selectFinanceRatePolicy([unbounded, bounded], {
      jurisdiction: "TX",
      asOf: "2025-06-01",
      vehicleModelYear: 2020,
    });
    expect(selected?.id).toBe("TX-AGE-10");
    // And the narrower bound beats the wider one.
    const narrow = policy({ id: "TX-AGE-3", vehicleAgeMaxYears: 3 });
    const wide = policy({ id: "TX-AGE-10", vehicleAgeMaxYears: 10 });
    expect(
      selectFinanceRatePolicy([wide, narrow], { jurisdiction: "TX", asOf: "2025-06-01", vehicleModelYear: 2023 })?.id,
    ).toBe("TX-AGE-3");
  });

  it("prefers the most recently effective policy between equally specific ones", () => {
    const older = policy({ id: "TX-OLD", effectiveFrom: "2024-01-01" });
    const newer = policy({ id: "TX-NEW", effectiveFrom: "2025-01-01" });
    expect(selectFinanceRatePolicy([older, newer], { jurisdiction: "TX", asOf: "2025-06-01" })?.id).toBe("TX-NEW");
    expect(selectFinanceRatePolicy([newer, older], { jurisdiction: "TX", asOf: "2025-06-01" })?.id).toBe("TX-NEW");
  });

  it("breaks a complete tie on the lowest id, so array order cannot matter", () => {
    const a = policy({ id: "TX-A", effectiveFrom: "2025-01-01" });
    const b = policy({ id: "TX-B", effectiveFrom: "2025-01-01" });
    expect(selectFinanceRatePolicy([a, b], { jurisdiction: "TX", asOf: "2025-06-01" })?.id).toBe("TX-A");
    expect(selectFinanceRatePolicy([b, a], { jurisdiction: "TX", asOf: "2025-06-01" })?.id).toBe("TX-A");
  });

  it("never depends on the order the policies are passed in", () => {
    const policies = [
      policy({ id: "TX-ANY", effectiveFrom: "2025-01-01" }),
      policy({ id: "TX-AGE-10", vehicleAgeMaxYears: 10, effectiveFrom: "2024-01-01" }),
      policy({ id: "TX-AGE-10-NEWER", vehicleAgeMaxYears: 10, effectiveFrom: "2025-03-01" }),
      EXPIRED,
      FUTURE,
    ];
    const query = { jurisdiction: "TX", asOf: "2025-06-01", vehicleModelYear: 2020 };
    const forward = selectFinanceRatePolicy(policies, query);
    const reversed = selectFinanceRatePolicy([...policies].reverse(), query);
    expect(forward?.id).toBe("TX-AGE-10-NEWER");
    expect(reversed?.id).toBe(forward?.id);
  });
});

describe("rate-policy — evaluateFinanceRate", () => {
  it("reports NO_CONFIGURED_RATE_POLICY with null — not false, not true", () => {
    const evaluation = evaluateFinanceRate({
      aprBasisPoints: 1_800,
      policies: [],
      jurisdiction: "TX",
      asOf: "2025-06-01",
    });
    expect(evaluation.status).toBe(NO_RATE_POLICY_CONFIGURED);
    // THE CRITICAL DISTINCTION: "no ceiling is configured" is not "passes the
    // ceiling". Null means the question was never answered.
    expect(evaluation.withinConfiguredRatePolicy).toBeNull();
    expect(evaluation.withinConfiguredRatePolicy).not.toBe(false);
    expect(evaluation.withinConfiguredRatePolicy).not.toBe(true);
    expect(evaluation.policyId).toBeNull();
    expect(evaluation.policyJurisdiction).toBeNull();
    expect(evaluation.policyCeilingBasisPoints).toBeNull();
    expect(evaluation.policySourceReference).toBeNull();
    expect(evaluation.statement).toMatch(/No rate policy is configured/);
    expect(evaluation.disclaimer).toBe(RATE_POLICY_DISCLAIMER);
  });

  it("defaults to the shipped registry, which is empty", () => {
    const evaluation = evaluateFinanceRate({ aprBasisPoints: 1_800, jurisdiction: "TX", asOf: "2025-06-01" });
    expect(FINANCE_RATE_POLICIES).toHaveLength(0);
    expect(evaluation.status).toBe(NO_RATE_POLICY_CONFIGURED);
    expect(evaluation.withinConfiguredRatePolicy).toBeNull();
  });

  it("is within policy one basis point below the ceiling", () => {
    const evaluation = evaluateFinanceRate({
      aprBasisPoints: 1_799,
      policies: [ACTIVE],
      jurisdiction: "TX",
      asOf: "2025-06-01",
    });
    expect(evaluation.status).toBe(WITHIN_RATE_POLICY);
    expect(evaluation.withinConfiguredRatePolicy).toBe(true);
    expect(evaluation.policyId).toBe("TX-ACTIVE");
    expect(evaluation.policyJurisdiction).toBe("TX");
    expect(evaluation.policyCeilingBasisPoints).toBe(1_800);
    expect(evaluation.policySourceReference).toBe(SOURCE.reference);
    expect(ratePolicyHeadroomBasisPoints(evaluation)).toBe(1);
  });

  it("is within policy exactly at the ceiling", () => {
    const evaluation = evaluateFinanceRate({
      aprBasisPoints: 1_800,
      policies: [ACTIVE],
      jurisdiction: "TX",
      asOf: "2025-06-01",
    });
    expect(evaluation.status).toBe(WITHIN_RATE_POLICY);
    expect(evaluation.withinConfiguredRatePolicy).toBe(true);
    expect(ratePolicyHeadroomBasisPoints(evaluation)).toBe(0);
  });

  it("is above policy one basis point over the ceiling", () => {
    const evaluation = evaluateFinanceRate({
      aprBasisPoints: 1_801,
      policies: [ACTIVE],
      jurisdiction: "TX",
      asOf: "2025-06-01",
    });
    expect(evaluation.status).toBe(ABOVE_RATE_POLICY);
    expect(evaluation.withinConfiguredRatePolicy).toBe(false);
    expect(ratePolicyHeadroomBasisPoints(evaluation)).toBe(-1);
    expect(evaluation.statement).toMatch(/above the configured rate policy/);
  });

  it("reports no policy when the jurisdiction or the date does not match", () => {
    const wrongJurisdiction = evaluateFinanceRate({
      aprBasisPoints: 1_000,
      policies: [ACTIVE],
      jurisdiction: "OK",
      asOf: "2025-06-01",
    });
    expect(wrongJurisdiction.status).toBe(NO_RATE_POLICY_CONFIGURED);
    expect(wrongJurisdiction.withinConfiguredRatePolicy).toBeNull();

    const expired = evaluateFinanceRate({
      aprBasisPoints: 1_000,
      policies: [EXPIRED],
      jurisdiction: "TX",
      asOf: "2025-06-01",
    });
    expect(expired.status).toBe(NO_RATE_POLICY_CONFIGURED);
    expect(expired.withinConfiguredRatePolicy).toBeNull();
  });

  it("normalises the rate it is asked about without clamping to the ceiling", () => {
    // A negative rate is meaningless and is reported as 0.00%; it is never
    // silently turned into a pass or a fail of a ceiling.
    const evaluation = evaluateFinanceRate({
      aprBasisPoints: -250,
      policies: [ACTIVE],
      jurisdiction: "TX",
      asOf: "2025-06-01",
    });
    expect(evaluation.aprBasisPoints).toBe(0);
    expect(evaluation.withinConfiguredRatePolicy).toBe(true);
    expect(ratePolicyHeadroomBasisPoints(evaluation)).toBe(1_800);
  });

  it("computes headroom as ceiling minus rate, and null when nothing is configured", () => {
    expect(
      ratePolicyHeadroomBasisPoints(
        evaluateFinanceRate({ aprBasisPoints: 1_500, policies: [ACTIVE], jurisdiction: "TX", asOf: "2025-06-01" }),
      ),
    ).toBe(300);
    expect(
      ratePolicyHeadroomBasisPoints(
        evaluateFinanceRate({ aprBasisPoints: 2_400, policies: [ACTIVE], jurisdiction: "TX", asOf: "2025-06-01" }),
      ),
    ).toBe(-600);
    expect(
      ratePolicyHeadroomBasisPoints(
        evaluateFinanceRate({ aprBasisPoints: 1_500, policies: [], jurisdiction: "TX", asOf: "2025-06-01" }),
      ),
    ).toBeNull();
  });

  it("is pure and repeatable for the same inputs", () => {
    const params = { aprBasisPoints: 1_801, policies: [ACTIVE], jurisdiction: "TX", asOf: "2025-06-01" } as const;
    expect(evaluateFinanceRate(params)).toEqual(evaluateFinanceRate(params));
  });
});

describe("rate-policy — the language guarantees", () => {
  const evaluations = [
    evaluateFinanceRate({ aprBasisPoints: 1_799, policies: [ACTIVE], jurisdiction: "TX", asOf: "2025-06-01" }),
    evaluateFinanceRate({ aprBasisPoints: 1_801, policies: [ACTIVE], jurisdiction: "TX", asOf: "2025-06-01" }),
    evaluateFinanceRate({ aprBasisPoints: 2_400, policies: [], jurisdiction: "TX", asOf: "2025-06-01" }),
  ];

  it("never claims legal compliance in any statement it returns", () => {
    for (const evaluation of evaluations) {
      // A single regex over both statement and disclaimer: no assertion of
      // legality, lawfulness, compliance, being compliant, or being permitted.
      const text = `${evaluation.statement} ${evaluation.disclaimer}`;
      expect(text, evaluation.status).not.toMatch(/legal(ly)?\s+(complian|permitted|allowed|valid|enforceable)/i);
      expect(text, evaluation.status).not.toMatch(/\b(lawful|unlawful)\b/i);
      expect(text, evaluation.status).not.toMatch(/\bcompliant\b/i);
      expect(text, evaluation.status).not.toMatch(/compliance\s+(is|has been|was)\s+(established|confirmed|achieved)/i);
      expect(text, evaluation.status).not.toMatch(/permitted by law/i);
      // And it never asserts approval, which is a lending decision, not a rate
      // ceiling.
      expect(text, evaluation.status).not.toMatch(/approved|guaranteed/i);
    }
  });

  it("states plainly that this is a configured-policy check, not a legal one", () => {
    for (const evaluation of evaluations) {
      expect(evaluation.disclaimer, evaluation.status).toBe(RATE_POLICY_DISCLAIMER);
      // It must SAY what it is: a check against the dealership's configured policy.
      expect(evaluation.disclaimer).toMatch(/Checked against the rate policy configured for this dealership/);
      expect(evaluation.disclaimer).toMatch(/not a legal determination/);
      expect(evaluation.disclaimer).toMatch(/does not establish compliance with any law or regulation/);
      // And it must put the responsibility where it belongs.
      expect(evaluation.disclaimer).toMatch(/remain the dealer's responsibility/);
      // The word "configured" is the load-bearing one in every statement.
      expect(evaluation.statement).toMatch(/configured rate policy|No rate policy is configured/);
    }
  });

  it("names the policy and quotes its ceiling, so the number is traceable", () => {
    const within = evaluations[0]!;
    expect(within.statement).toContain("TX-ACTIVE");
    expect(within.statement).toContain("17.99%");
    expect(within.statement).toContain("18.00%");
    const above = evaluations[1]!;
    expect(above.statement).toContain("TX-ACTIVE");
    expect(above.statement).toContain("18.01%");
    expect(above.policySourceReference).toBe(SOURCE.reference);
    // The no-policy case states the rate it could not check.
    expect(evaluations[2]!.statement).toContain("24.00%");
  });

  it("keeps the disclaimer itself free of any compliance assertion", () => {
    // The disclaimer mentions "compliance" only to disclaim it, so the
    // assertion is on the CLAIM, not the word.
    expect(RATE_POLICY_DISCLAIMER).not.toMatch(/this (is|constitutes) (legal|lawful|compliant)/i);
    expect(RATE_POLICY_DISCLAIMER).not.toMatch(/we (are|remain) compliant/i);
    expect(RATE_POLICY_DISCLAIMER).not.toMatch(/complies with/i);
    expect(RATE_POLICY_DISCLAIMER).toMatch(/not a legal determination/);
  });
});

describe("rate-policy — the shipped registry is empty on purpose", () => {
  it("ships no jurisdiction's ceiling", () => {
    // THIS IS THE POINT OF THE MODULE. A maximum finance rate is a legal fact
    // about a jurisdiction and a date, not a constant of arithmetic. If this
    // array ever ships with entries, the software has started asserting what a
    // jurisdiction permits — a claim it cannot verify and that goes stale
    // silently when the rule, the vehicle class or the effective date changes.
    // Populate it per dealership, with the `source` metadata filled in.
    expect(FINANCE_RATE_POLICIES).toHaveLength(0);
    expect(FINANCE_RATE_POLICIES).toEqual([]);
  });
});
