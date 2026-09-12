import { z } from "zod";
import type {
  SourcingCandidate,
  SourcingCandidateStatus,
  SourcingRecommendation,
  SourcingSource,
} from "@/generated/prisma";
import { ConflictError, NotFoundError } from "@/lib/domain-errors";
import type { BasisPoints, Cents } from "@/lib/money";
import { toCents } from "@/lib/money";
import type { ProviderResult, VinDecodeResult } from "@/lib/providers/types";
import { vinDecodeProvider } from "@/lib/providers/vin-decode";
import { getDealerSettings } from "@/lib/settings";
import type { SourcingEvaluation, SourcingEvaluationInput } from "@/lib/sourcing";
import { evaluateSourcingCandidate } from "@/lib/sourcing";
import { assertCapability, type OperationContext } from "./context";
import { centsSchema, recordIdSchema, requiredText, vinSchema } from "./schemas";

/**
 * BUY — sourcing operations.
 *
 * This module adds the APPLICATION layer on top of the existing, canonical
 * sourcing engine. It does not contain a single formula: every profit, ROI,
 * ceiling and BUY/WATCH/PASS verdict comes from `evaluateSourcingCandidate()`.
 * What this layer adds is persistence, the dealer's configured thresholds,
 * authorization and validation — nothing else.
 *
 * A candidate carries a *snapshot* of its evaluation (landed cost, expected
 * profit, ROI, max purchase price, max bid, recommendation and the written
 * reasons). The snapshot is recomputed whenever an input changes, so a saved
 * candidate always explains the number that was shown when the decision was
 * taken, even after the dealer changes their thresholds.
 */

export const SOURCING_SOURCES = [
  "MANUAL_ENTRY",
  "PASTED_URL",
  "AUCTION_FEED",
  "MARKETPLACE_API",
  "TRADE_IN_SUBMISSION",
  "AUCTION_PURCHASE",
  "OTHER",
] as const satisfies readonly SourcingSource[];

export const SOURCING_CANDIDATE_STATUSES = [
  "INBOX",
  "EVALUATING",
  "APPROVED_TO_BUY",
  "PASSED",
  "PURCHASED",
  "ARCHIVED",
] as const satisfies readonly SourcingCandidateStatus[];

/** Statuses an operator may set directly. `PURCHASED` belongs to acquisition. */
export const DECIDABLE_CANDIDATE_STATUSES = [
  "INBOX",
  "EVALUATING",
  "APPROVED_TO_BUY",
  "PASSED",
  "ARCHIVED",
] as const satisfies readonly SourcingCandidateStatus[];

/**
 * The opportunity fields, declared once.
 *
 * They are deliberately declared WITHOUT defaults and then re-used for both
 * schemas, because `.partial()` on a field carrying `.default()` still applies
 * that default: a patch that omitted `source` would silently rewrite it to
 * MANUAL_ENTRY on every edit.
 */
const opportunityFields = {
  source: z.enum(SOURCING_SOURCES),

  // Identity, when known. Every one of these is optional: an auction listing
  // often arrives as little more than a URL and a price.
  vin: vinSchema,
  year: z.number().int().min(1900).max(2100),
  make: requiredText(80),
  model: requiredText(80),
  trim: requiredText(80),
  mileage: z.number().int().min(0).max(2_000_000),

  // Where it came from
  listingUrl: requiredText(2_000),
  listingTitle: requiredText(300),
  sellerName: requiredText(120),
  sellerPhone: requiredText(40),
  sellerEmail: z.email().max(200),
  sellerType: requiredText(60),
  location: requiredText(200),
  notes: z.string().trim().max(5_000),

  /** Links a trade-in candidate to the customer who submitted it. */
  customerId: recordIdSchema,

  // Evaluation inputs — the exact set the engine consumes.
  askingPriceCents: centsSchema,
  expectedAuctionFeesCents: centsSchema,
  transportEstimateCents: centsSchema,
  estimatedReconCents: centsSchema,
  otherCostsCents: centsSchema,
  /** Expected retail. 0 means "not estimated yet" and yields WATCH, never a fake BUY. */
  estimatedRetailCents: centsSchema,

  // Thresholds. Omitted means "use the dealership configuration".
  minGrossProfitCents: centsSchema,
  minRoiBasisPoints: centsSchema,
};

export const opportunitySchema = z.object({
  ...opportunityFields,
  source: opportunityFields.source.default("MANUAL_ENTRY"),
  // Anything not listed above is optional by nature: a candidate is captured
  // long before the car is known.
  vin: opportunityFields.vin.optional(),
  year: opportunityFields.year.optional(),
  make: opportunityFields.make.optional(),
  model: opportunityFields.model.optional(),
  trim: opportunityFields.trim.optional(),
  mileage: opportunityFields.mileage.optional(),
  listingUrl: opportunityFields.listingUrl.optional(),
  listingTitle: opportunityFields.listingTitle.optional(),
  sellerName: opportunityFields.sellerName.optional(),
  sellerPhone: opportunityFields.sellerPhone.optional(),
  sellerEmail: opportunityFields.sellerEmail.optional(),
  sellerType: opportunityFields.sellerType.optional(),
  location: opportunityFields.location.optional(),
  notes: opportunityFields.notes.optional(),
  customerId: opportunityFields.customerId.optional(),
  expectedAuctionFeesCents: opportunityFields.expectedAuctionFeesCents.optional(),
  transportEstimateCents: opportunityFields.transportEstimateCents.optional(),
  estimatedReconCents: opportunityFields.estimatedReconCents.optional(),
  otherCostsCents: opportunityFields.otherCostsCents.optional(),
  minGrossProfitCents: opportunityFields.minGrossProfitCents.optional(),
  minRoiBasisPoints: opportunityFields.minRoiBasisPoints.optional(),
});

export type OpportunityInput = z.input<typeof opportunitySchema>;
export type ParsedOpportunity = z.output<typeof opportunitySchema>;

/** Every field optional, and no defaults — see the note on `opportunityFields`. */
export const opportunityPatchSchema = z.object(opportunityFields).partial();
export type OpportunityPatch = z.input<typeof opportunityPatchSchema>;

export interface SourcingThresholds {
  minGrossProfitCents: Cents;
  minRoiBasisPoints: BasisPoints;
}

/** The dealership's configured floors, used when an opportunity omits them. */
export function resolveSourcingThresholds(settings: {
  minGrossProfitCents: number;
  minRoiBasisPoints: number;
}): SourcingThresholds {
  return {
    minGrossProfitCents: toCents(settings.minGrossProfitCents),
    minRoiBasisPoints: Math.max(0, Math.round(settings.minRoiBasisPoints)),
  };
}

/**
 * The one entry point to sourcing arithmetic. Delegates to the canonical engine.
 */
export function evaluateOpportunity(
  input: SourcingEvaluationInput,
  thresholds: SourcingThresholds,
): SourcingEvaluation {
  return evaluateSourcingCandidate({
    askingPriceCents: input.askingPriceCents,
    expectedAuctionFeesCents: input.expectedAuctionFeesCents,
    transportEstimateCents: input.transportEstimateCents,
    estimatedReconCents: input.estimatedReconCents,
    otherCostsCents: input.otherCostsCents,
    estimatedRetailCents: input.estimatedRetailCents,
    minGrossProfitCents: input.minGrossProfitCents ?? thresholds.minGrossProfitCents,
    minRoiBasisPoints: input.minRoiBasisPoints ?? thresholds.minRoiBasisPoints,
  });
}

export interface SourcingEvaluationSnapshot {
  evaluatedAt: Date;
  landedCostCents: Cents;
  expectedProfitCents: Cents;
  expectedRoiBasisPoints: BasisPoints | null;
  maxPurchasePriceCents: Cents;
  maxBidCents: Cents;
  recommendation: SourcingRecommendation;
  recommendationReasons: string[];
}

function snapshotOf(evaluation: SourcingEvaluation): SourcingEvaluationSnapshot {
  return {
    evaluatedAt: new Date(),
    landedCostCents: evaluation.landedCostCents,
    expectedProfitCents: evaluation.expectedProfitCents,
    expectedRoiBasisPoints: evaluation.expectedRoiBasisPoints,
    maxPurchasePriceCents: evaluation.maxPurchasePriceCents,
    maxBidCents: evaluation.maxBidCents,
    recommendation: evaluation.recommendation,
    recommendationReasons: evaluation.reasons,
  };
}

/** Drops keys the caller did not supply, so a patch never blanks a column. */
function supplied<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * The stored threshold columns hold the EFFECTIVE thresholds, not the raw ones.
 *
 * If an opportunity omitted them, the dealership's configured floor is written
 * down. Storing 0 instead would silently turn every later re-evaluation into a
 * "no minimum" evaluation, which is how a saved candidate starts disagreeing
 * with the number the operator approved.
 */
function candidateColumns(input: ParsedOpportunity, thresholds: SourcingThresholds) {
  return {
    source: input.source,
    vin: input.vin ?? null,
    year: input.year ?? null,
    make: input.make ?? null,
    model: input.model ?? null,
    trim: input.trim ?? null,
    mileage: input.mileage ?? null,
    listingUrl: input.listingUrl ?? null,
    listingTitle: input.listingTitle ?? null,
    sellerName: input.sellerName ?? null,
    sellerPhone: input.sellerPhone ?? null,
    sellerEmail: input.sellerEmail ?? null,
    sellerType: input.sellerType ?? null,
    location: input.location ?? null,
    notes: input.notes ?? null,
    customerId: input.customerId ?? null,
    askingPriceCents: input.askingPriceCents,
    expectedAuctionFeesCents: input.expectedAuctionFeesCents ?? 0,
    transportEstimateCents: input.transportEstimateCents ?? 0,
    estimatedReconCents: input.estimatedReconCents ?? 0,
    otherCostsCents: input.otherCostsCents ?? 0,
    estimatedRetailCents: input.estimatedRetailCents,
    minGrossProfitCents: input.minGrossProfitCents ?? thresholds.minGrossProfitCents,
    minRoiBasisPoints: input.minRoiBasisPoints ?? thresholds.minRoiBasisPoints,
  };
}

/** Rebuilds the parsed-input shape from a stored row, for re-evaluation. */
function inputFromRow(row: SourcingCandidate): ParsedOpportunity {
  return {
    source: row.source,
    vin: row.vin ?? undefined,
    year: row.year ?? undefined,
    make: row.make ?? undefined,
    model: row.model ?? undefined,
    trim: row.trim ?? undefined,
    mileage: row.mileage ?? undefined,
    listingUrl: row.listingUrl ?? undefined,
    listingTitle: row.listingTitle ?? undefined,
    sellerName: row.sellerName ?? undefined,
    sellerPhone: row.sellerPhone ?? undefined,
    sellerEmail: row.sellerEmail ?? undefined,
    sellerType: row.sellerType ?? undefined,
    location: row.location ?? undefined,
    notes: row.notes ?? undefined,
    customerId: row.customerId ?? undefined,
    askingPriceCents: row.askingPriceCents,
    expectedAuctionFeesCents: row.expectedAuctionFeesCents,
    transportEstimateCents: row.transportEstimateCents,
    estimatedReconCents: row.estimatedReconCents,
    otherCostsCents: row.otherCostsCents,
    estimatedRetailCents: row.estimatedRetailCents,
    minGrossProfitCents: row.minGrossProfitCents,
    minRoiBasisPoints: row.minRoiBasisPoints,
  };
}

export interface CreateSourcingCandidateResult {
  candidateId: string;
  candidate: SourcingCandidate;
  evaluation: SourcingEvaluation;
}

/**
 * Persists an opportunity and its evaluation snapshot.
 *
 * Capability: `sourcing:write` (OWNER, MANAGER).
 */
export async function createSourcingCandidate(
  ctx: OperationContext,
  rawInput: OpportunityInput,
): Promise<CreateSourcingCandidateResult> {
  assertCapability(ctx, "sourcing:write");

  const parsed = opportunitySchema.parse(rawInput);
  const thresholds = resolveSourcingThresholds(await getDealerSettings(ctx.db));
  const evaluation = evaluateOpportunity(parsed, thresholds);

  const candidate = await ctx.db.sourcingCandidate.create({
    data: {
      ...candidateColumns(parsed, thresholds),
      ...snapshotOf(evaluation),
      createdById: ctx.actor.id,
    },
  });

  return { candidateId: candidate.id, candidate, evaluation };
}

export interface UpdateSourcingCandidateResult {
  candidate: SourcingCandidate;
  evaluation: SourcingEvaluation;
}

/**
 * Applies a partial change to an opportunity and recomputes the snapshot.
 *
 * The stored thresholds are the *effective* ones used for the last evaluation,
 * so an omitted threshold keeps the number the dealer actually configured.
 *
 * Capability: `sourcing:write`.
 */
export async function updateSourcingCandidate(
  ctx: OperationContext,
  candidateId: string,
  patch: OpportunityPatch,
): Promise<UpdateSourcingCandidateResult> {
  assertCapability(ctx, "sourcing:write");

  const id = recordIdSchema.parse(candidateId);
  const existing = await ctx.db.sourcingCandidate.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("That sourcing candidate no longer exists.");
  if (existing.status === "PURCHASED") {
    throw new ConflictError("This candidate was already purchased. Edit the vehicle's costs instead.");
  }

  const parsedPatch = opportunityPatchSchema.parse(patch);
  const merged: ParsedOpportunity = {
    ...inputFromRow(existing),
    ...supplied(parsedPatch),
  } as ParsedOpportunity;

  const thresholds = resolveSourcingThresholds(await getDealerSettings(ctx.db));
  const evaluation = evaluateOpportunity(merged, thresholds);

  const candidate = await ctx.db.sourcingCandidate.update({
    where: { id },
    data: {
      ...candidateColumns(merged, thresholds),
      ...snapshotOf(evaluation),
    },
  });

  return { candidate, evaluation };
}

export const decisionSchema = z.object({
  status: z.enum(DECIDABLE_CANDIDATE_STATUSES),
  notes: z.string().trim().max(5_000).optional(),
});

export type SourcingDecisionInput = z.input<typeof decisionSchema>;

/**
 * Records the operator's decision on a candidate.
 *
 * The BUY/WATCH/PASS *recommendation* is always the engine's; this records the
 * human's call (`APPROVED_TO_BUY`, `PASSED`, `ARCHIVED`), which is what
 * acquisition later reads.
 *
 * Capability: `sourcing:write`.
 */
export async function recordSourcingDecision(
  ctx: OperationContext,
  candidateId: string,
  rawDecision: SourcingDecisionInput,
): Promise<SourcingCandidate> {
  assertCapability(ctx, "sourcing:write");

  const id = recordIdSchema.parse(candidateId);
  const decision = decisionSchema.parse(rawDecision);

  const existing = await ctx.db.sourcingCandidate.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("That sourcing candidate no longer exists.");
  if (existing.status === "PURCHASED") {
    throw new ConflictError("This candidate was already purchased; its decision is history.");
  }

  return ctx.db.sourcingCandidate.update({
    where: { id },
    data: {
      status: decision.status,
      decisionNotes: decision.notes ?? null,
      decidedById: ctx.actor.id,
      decidedAt: new Date(),
    },
  });
}

export const sourcingListFilterSchema = z.object({
  status: z.enum(SOURCING_CANDIDATE_STATUSES).optional(),
  recommendation: z.enum(["BUY", "WATCH", "PASS"]).optional(),
  source: z.enum(SOURCING_SOURCES).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type SourcingListFilter = z.input<typeof sourcingListFilterSchema>;

export interface SourcingListResult {
  items: SourcingCandidate[];
  total: number;
}

/** Capability: `sourcing:read`. */
export async function listSourcingCandidates(
  ctx: OperationContext,
  rawFilter: SourcingListFilter = {},
): Promise<SourcingListResult> {
  assertCapability(ctx, "sourcing:read");

  const filter = sourcingListFilterSchema.parse(rawFilter);
  const where = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.recommendation ? { recommendation: filter.recommendation } : {}),
    ...(filter.source ? { source: filter.source } : {}),
  };

  const [items, total] = await Promise.all([
    ctx.db.sourcingCandidate.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.limit,
      skip: filter.offset,
    }),
    ctx.db.sourcingCandidate.count({ where }),
  ]);

  return { items, total };
}

/** Capability: `sourcing:read`. */
export async function getSourcingCandidate(
  ctx: OperationContext,
  candidateId: string,
): Promise<SourcingCandidate> {
  assertCapability(ctx, "sourcing:read");

  const id = recordIdSchema.parse(candidateId);
  const candidate = await ctx.db.sourcingCandidate.findUnique({ where: { id } });
  if (!candidate) throw new NotFoundError("That sourcing candidate no longer exists.");
  return candidate;
}

/**
 * Decodes a VIN through the existing provider boundary (NHTSA vPIC).
 *
 * The provider is the only thing that talks to the network, and it reports
 * `unavailable`/`error` rather than inventing specification data. Nothing here
 * writes to the database: the operator decides what to accept.
 *
 * Capability: `sourcing:read`.
 */
export async function decodeOpportunityVin(
  ctx: OperationContext,
  rawVin: string,
): Promise<ProviderResult<VinDecodeResult>> {
  assertCapability(ctx, "sourcing:read");
  const vin = vinSchema.parse(rawVin);
  return vinDecodeProvider.decode(vin);
}

/**
 * Guards the acquisition path: only an explicitly approved candidate may be
 * turned into owned inventory. Exported so acquisition and its tests share one
 * definition of "approved".
 */
export function assertCandidateApprovable(candidate: Pick<SourcingCandidate, "id" | "status">): void {
  if (candidate.status === "PURCHASED") {
    throw new ConflictError("That candidate was already converted into inventory.");
  }
  if (candidate.status !== "APPROVED_TO_BUY") {
    throw new ConflictError(
      "Only an opportunity approved to buy can become inventory. Record the BUY decision first.",
    );
  }
}

export const SOURCING_RECOMMENDATION_LABELS: Record<SourcingRecommendation, string> = {
  BUY: "Buy",
  WATCH: "Watch",
  PASS: "Pass",
};

export type { SourcingCandidate };
