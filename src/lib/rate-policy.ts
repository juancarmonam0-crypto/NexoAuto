/**
 * Finance rate policy — a CONFIGURABLE, VERSIONED boundary.
 *
 * WHY THIS FILE EXISTS
 * A maximum finance rate is a legal fact about a jurisdiction and a date, not a
 * constant of arithmetic. Hard-coding one number (say "Texas is 18%") into the
 * calculator would make the software assert a legal claim it cannot verify,
 * and would silently become wrong the moment the rule, the vehicle class or
 * the effective date changed. So:
 *
 *   THE ENGINE DOES THE MATH. THE POLICY SUPPLIES THE CEILING.
 *
 * This module ships NO active ceiling. `FINANCE_RATE_POLICIES` is empty on
 * purpose: nothing in this codebase asserts what any jurisdiction permits. A
 * dealer (or a later phase) supplies `FinanceRatePolicy` records; the
 * calculator then reports whether a rate is INSIDE THE CONFIGURED POLICY.
 *
 * WHAT THE SOFTWARE MUST NEVER SAY
 * Passing a configured ceiling is not compliance. These functions return
 * "WITHIN CONFIGURED RATE POLICY" and never "legally compliant", "legal",
 * "permitted by law" or anything a court, regulator or auditor could read as a
 * legal opinion. Contract and disclosure compliance stay external to Nexo Auto.
 */

import { type BasisPoints } from "./money";

export interface FinanceRatePolicySource {
  /** Human label, e.g. "Dealer compliance manual". */
  label: string;
  /** Where the number came from: document, section, URL, filing. */
  reference: string;
  /** ISO date the dealer confirmed the reference. */
  retrievedOn: string;
}

export interface FinanceRatePolicy {
  /** Stable identifier, quoted verbatim on any audit trail. */
  id: string;
  /** Upper-case jurisdiction code this policy belongs to, e.g. "TX". */
  jurisdiction: string;
  /** ISO date the policy takes effect (inclusive). */
  effectiveFrom: string;
  /** ISO date the policy stops applying (exclusive); null = open-ended. */
  effectiveTo: string | null;
  /** Configured ceiling for the annual percentage rate. */
  maxAprBasisPoints: BasisPoints;
  /**
   * Oldest model year the policy covers, expressed as a maximum vehicle age in
   * years at the time of the deal. null/undefined = any age.
   */
  vehicleAgeMaxYears?: number | null;
  /** Coarse vehicle class, when a policy distinguishes new from used. */
  vehicleClass?: "ANY" | "NEW" | "USED";
  /** Where the ceiling came from. Required: an unsourced number is a guess. */
  source: FinanceRatePolicySource;
  notes?: string;
}

/**
 * The active policy registry.
 *
 * DELIBERATELY EMPTY. Populate it with the dealership's own jurisdiction
 * policies (with their source metadata) to switch the guardrail on. An empty
 * registry means "no ceiling is configured", which the calculator reports as
 * exactly that — never as compliance.
 */
export const FINANCE_RATE_POLICIES: readonly FinanceRatePolicy[] = [];

export const NO_RATE_POLICY_CONFIGURED = "NO_CONFIGURED_RATE_POLICY" as const;
export const WITHIN_RATE_POLICY = "WITHIN_CONFIGURED_RATE_POLICY" as const;
export const ABOVE_RATE_POLICY = "ABOVE_CONFIGURED_RATE_POLICY" as const;

export type RatePolicyStatus =
  | typeof NO_RATE_POLICY_CONFIGURED
  | typeof WITHIN_RATE_POLICY
  | typeof ABOVE_RATE_POLICY;

export interface RatePolicyEvaluation {
  aprBasisPoints: BasisPoints;
  status: RatePolicyStatus;
  /** True/false when a policy applied; null when none was configured. */
  withinConfiguredRatePolicy: boolean | null;
  policyId: string | null;
  policyJurisdiction: string | null;
  policyCeilingBasisPoints: BasisPoints | null;
  policySourceReference: string | null;
  /** Plain-language summary that stops short of any legal claim. */
  statement: string;
  disclaimer: string;
}

export const RATE_POLICY_DISCLAIMER =
  "Checked against the rate policy configured for this dealership. This is not a legal " +
  "determination and does not establish compliance with any law or regulation; contract " +
  "and disclosure compliance remain the dealer's responsibility.";

function toTime(value: string, field: string): number {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new RangeError(`${field} must be an ISO-8601 date, received "${value}"`);
  }
  return time;
}

/**
 * Picks the policy that governs a deal.
 *
 * Selection is deterministic and explainable:
 *   1. jurisdiction must match (case-insensitive),
 *   2. the deal date must fall inside [effectiveFrom, effectiveTo),
 *   3. the vehicle must be inside the policy's age/class scope,
 *   4. the MOST SPECIFIC scope wins (a bounded vehicle age beats "any age"),
 *   5. then the most recently effective policy,
 *   6. then the lowest id, so the result never depends on array order.
 */
export function selectFinanceRatePolicy(
  policies: readonly FinanceRatePolicy[],
  query: {
    jurisdiction: string;
    /** ISO date (or Date) of the deal, used for the effective window. */
    asOf: string | Date;
    vehicleModelYear?: number | null;
  },
): FinanceRatePolicy | null {
  const jurisdiction = query.jurisdiction.trim().toUpperCase();
  const asOf = query.asOf instanceof Date ? query.asOf : new Date(toTime(query.asOf, "asOf"));
  const asOfTime = asOf.getTime();
  const asOfYear = asOf.getUTCFullYear();
  const modelYear = query.vehicleModelYear ?? null;

  const eligible = policies.filter((policy) => {
    if (policy.jurisdiction.trim().toUpperCase() !== jurisdiction) return false;

    const from = toTime(policy.effectiveFrom, `${policy.id}.effectiveFrom`);
    if (asOfTime < from) return false;
    if (policy.effectiveTo !== null) {
      const to = toTime(policy.effectiveTo, `${policy.id}.effectiveTo`);
      if (asOfTime >= to) return false;
    }

    const vehicleClass = policy.vehicleClass ?? "ANY";
    if (vehicleClass === "NEW" || vehicleClass === "USED") {
      if (modelYear === null) return false;
      const isNew = asOfYear - modelYear <= 0;
      if (vehicleClass === "NEW" && !isNew) return false;
      if (vehicleClass === "USED" && isNew) return false;
    }

    const maxAge = policy.vehicleAgeMaxYears;
    if (maxAge !== null && maxAge !== undefined) {
      if (modelYear === null) return false;
      if (asOfYear - modelYear > maxAge) return false;
    }

    return true;
  });

  if (eligible.length === 0) return null;

  const sorted = [...eligible].sort((a, b) => {
    const aAge = a.vehicleAgeMaxYears ?? Number.POSITIVE_INFINITY;
    const bAge = b.vehicleAgeMaxYears ?? Number.POSITIVE_INFINITY;
    if (aAge !== bAge) return aAge - bAge;

    const aFrom = toTime(a.effectiveFrom, `${a.id}.effectiveFrom`);
    const bFrom = toTime(b.effectiveFrom, `${b.id}.effectiveFrom`);
    if (aFrom !== bFrom) return bFrom - aFrom;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted[0] ?? null;
}

/**
 * Compares a proposed APR with the configured ceiling.
 *
 * Pure: the caller supplies the policies and the deal date. Returns `null` for
 * `withinConfiguredRatePolicy` when no policy is configured, because "no
 * ceiling configured" is not the same as "passes the ceiling".
 */
export function evaluateFinanceRate(params: {
  aprBasisPoints: BasisPoints;
  policies?: readonly FinanceRatePolicy[];
  jurisdiction: string;
  asOf: string | Date;
  vehicleModelYear?: number | null;
}): RatePolicyEvaluation {
  const aprBasisPoints = Math.max(0, Math.round(params.aprBasisPoints));
  const policies = params.policies ?? FINANCE_RATE_POLICIES;

  const policy = selectFinanceRatePolicy(policies, {
    jurisdiction: params.jurisdiction,
    asOf: params.asOf,
    vehicleModelYear: params.vehicleModelYear,
  });

  if (!policy) {
    return {
      aprBasisPoints,
      status: NO_RATE_POLICY_CONFIGURED,
      withinConfiguredRatePolicy: null,
      policyId: null,
      policyJurisdiction: null,
      policyCeilingBasisPoints: null,
      policySourceReference: null,
      statement: `No rate policy is configured for ${params.jurisdiction.toUpperCase()} on this deal date, so no ceiling was applied to ${(aprBasisPoints / 100).toFixed(2)}%.`,
      disclaimer: RATE_POLICY_DISCLAIMER,
    };
  }

  const ceiling = Math.max(0, Math.round(policy.maxAprBasisPoints));
  const within = aprBasisPoints <= ceiling;

  return {
    aprBasisPoints,
    status: within ? WITHIN_RATE_POLICY : ABOVE_RATE_POLICY,
    withinConfiguredRatePolicy: within,
    policyId: policy.id,
    policyJurisdiction: policy.jurisdiction.toUpperCase(),
    policyCeilingBasisPoints: ceiling,
    policySourceReference: policy.source.reference,
    statement: within
      ? `${(aprBasisPoints / 100).toFixed(2)}% is within the configured rate policy ${policy.id} (ceiling ${(ceiling / 100).toFixed(2)}%).`
      : `${(aprBasisPoints / 100).toFixed(2)}% is above the configured rate policy ${policy.id} (ceiling ${(ceiling / 100).toFixed(2)}%).`,
    disclaimer: RATE_POLICY_DISCLAIMER,
  };
}

/**
 * The gap between a proposed rate and the configured ceiling, in basis points.
 * Negative means the rate is inside the policy; null when nothing is
 * configured. Useful for ranking: the engine prefers a structure with room to
 * spare over one sitting exactly on a configured ceiling.
 */
export function ratePolicyHeadroomBasisPoints(evaluation: RatePolicyEvaluation): BasisPoints | null {
  if (evaluation.policyCeilingBasisPoints === null) return null;
  return evaluation.policyCeilingBasisPoints - evaluation.aprBasisPoints;
}
