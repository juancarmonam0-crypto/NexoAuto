"use server";

import { type ActionResult, runOperation } from "@/lib/action-result";
import type {
  MarketAnalysisContract,
  MarketComparableContract,
  MarketValuationContract,
  OpportunityEvaluationContract,
  SourcingCandidateContract,
  SourcingDecisionContract,
  VehicleAcquiredContract,
  VinDecodeContract,
} from "@/lib/boundary/contracts";
import {
  enumField,
  formBoolean,
  optionalFormCents,
  optionalFormDate,
  optionalFormInt,
  optionalFormString,
  requireFormCents,
  requireFormInt,
  requireFormString,
} from "@/lib/forms";
import { centsToDecimalString } from "@/lib/money";
import { deriveConservativeRetail } from "@/lib/market-valuation";
import {
  ACQUISITION_SOURCES,
  DECIDABLE_CANDIDATE_STATUSES,
  SOURCING_SOURCES,
  TITLE_STATUSES,
  acquireVehicleFromCandidate,
  createSourcingCandidate,
  decodeOpportunityVin,
  evaluateOpportunity,
  recordSourcingDecision,
  resolveSourcingThresholds,
  updateSourcingCandidate,
} from "@/lib/operations";
import { operationContext } from "@/lib/operations/runtime";
import { marketCacheTtlMinutes, marketValuationProvider } from "@/lib/providers/registry";
import type { MarketComparable, MarketValuationSnapshot } from "@/lib/providers/types";
import { normalizeVin } from "@/lib/providers/vin-decode";
import { getDealerSettings } from "@/lib/settings";
import type { SourcingEvaluation } from "@/lib/sourcing";

/**
 * BUY — the sourcing boundary.
 *
 * Every function here resolves the ACTOR FROM THE SESSION, never from the form,
 * and then delegates to the validated operation. There is no arithmetic in this
 * file: the verdict, the ceiling and the recommendation come from
 * `evaluateOpportunity()` / the operation's own snapshot.
 */

/** Form → the input shape the canonical sourcing engine consumes. */
function opportunityFromForm(formData: FormData) {
  return {
    source: enumField(formData, "source", SOURCING_SOURCES, "MANUAL_ENTRY", "Source"),
    vin: optionalFormString(formData, "vin"),
    year: optionalFormInt(formData, "year", "Year"),
    make: optionalFormString(formData, "make"),
    model: optionalFormString(formData, "model"),
    trim: optionalFormString(formData, "trim"),
    mileage: optionalFormInt(formData, "mileage", "Mileage"),
    listingUrl: optionalFormString(formData, "listingUrl"),
    sellerName: optionalFormString(formData, "sellerName"),
    location: optionalFormString(formData, "location"),
    notes: optionalFormString(formData, "notes"),
    askingPriceCents: requireFormCents(formData, "askingPrice", "Asking price"),
    expectedAuctionFeesCents: optionalFormCents(formData, "auctionFees", "Auction fees"),
    transportEstimateCents: optionalFormCents(formData, "transport", "Transport"),
    estimatedReconCents: optionalFormCents(formData, "estimatedRecon", "Estimated recon"),
    otherCostsCents: optionalFormCents(formData, "otherCosts", "Other costs"),
    estimatedRetailCents: requireFormCents(formData, "estimatedRetail", "Estimated retail"),
  };
}

function evaluationContract(evaluation: SourcingEvaluation): OpportunityEvaluationContract {
  return {
    landedCostCents: evaluation.landedCostCents,
    expectedProfitCents: evaluation.expectedProfitCents,
    expectedRoiBasisPoints: evaluation.expectedRoiBasisPoints,
    maxPurchasePriceCents: evaluation.maxPurchasePriceCents,
    maxBidCents: evaluation.maxBidCents,
    bindingConstraint: evaluation.bindingConstraint,
    recommendation: evaluation.recommendation,
    reasons: [...evaluation.reasons],
  };
}

/** Scores an opportunity WITHOUT saving it. Capability: `sourcing:read`. */
export async function evaluateOpportunityAction(
  formData: FormData,
): Promise<ActionResult<OpportunityEvaluationContract>> {
  return runOperation("buy.evaluateOpportunity", async () => {
    const ctx = await operationContext("sourcing:read");
    const thresholds = resolveSourcingThresholds(await getDealerSettings(ctx.db));
    return evaluationContract(
      evaluateOpportunity(
        {
          ...opportunityFromForm(formData),
          minGrossProfitCents: optionalFormCents(formData, "minGrossProfit", "Minimum gross profit"),
          minRoiBasisPoints: optionalFormInt(formData, "minRoi", "Minimum ROI (basis points)"),
        },
        thresholds,
      ),
    );
  });
}

/** Saves an opportunity with its evaluation snapshot. Capability: `sourcing:write`. */
export async function createSourcingCandidateAction(
  formData: FormData,
): Promise<ActionResult<SourcingCandidateContract>> {
  return runOperation("buy.createSourcingCandidate", async () => {
    const ctx = await operationContext("sourcing:write");
    const created = await createSourcingCandidate(ctx, opportunityFromForm(formData));
    return {
      candidateId: created.candidateId,
      status: created.candidate.status,
      evaluatedAtIso: created.candidate.evaluatedAt?.toISOString() ?? null,
      ...evaluationContract(created.evaluation),
    };
  });
}

/** Re-evaluates a saved opportunity after an input changed. Capability: `sourcing:write`. */
export async function updateSourcingCandidateAction(
  formData: FormData,
): Promise<ActionResult<SourcingCandidateContract>> {
  return runOperation("buy.updateSourcingCandidate", async () => {
    const ctx = await operationContext("sourcing:write");
    const updated = await updateSourcingCandidate(ctx, requireFormString(formData, "candidateId", "Candidate"), {
      askingPriceCents: optionalFormCents(formData, "askingPrice", "Asking price"),
      estimatedRetailCents: optionalFormCents(formData, "estimatedRetail", "Estimated retail"),
      estimatedReconCents: optionalFormCents(formData, "estimatedRecon", "Estimated recon"),
      notes: optionalFormString(formData, "notes"),
    });
    return {
      candidateId: updated.candidate.id,
      status: updated.candidate.status,
      evaluatedAtIso: updated.candidate.evaluatedAt?.toISOString() ?? null,
      ...evaluationContract(updated.evaluation),
    };
  });
}

/** Records the operator's BUY/WATCH/PASS decision. Capability: `sourcing:write`. */
export async function recordSourcingDecisionAction(
  formData: FormData,
): Promise<ActionResult<SourcingDecisionContract>> {
  return runOperation("buy.recordSourcingDecision", async () => {
    const ctx = await operationContext("sourcing:write");
    const updated = await recordSourcingDecision(
      ctx,
      requireFormString(formData, "candidateId", "Candidate"),
      {
        status: enumField(formData, "status", DECIDABLE_CANDIDATE_STATUSES, undefined, "Decision"),
        notes: optionalFormString(formData, "notes"),
      },
    );
    return { candidateId: updated.id, status: updated.status };
  });
}

/** Converts an APPROVED opportunity into owned inventory. Capability: `sourcing:write`. */
export async function acquireVehicleAction(
  formData: FormData,
): Promise<ActionResult<VehicleAcquiredContract>> {
  return runOperation("buy.acquireVehicle", async () => {
    const ctx = await operationContext("sourcing:write");
    const result = await acquireVehicleFromCandidate(ctx, {
      candidateId: requireFormString(formData, "candidateId", "Candidate"),
      vehicle: {
        vin: requireFormString(formData, "vin", "VIN"),
        year: requireFormInt(formData, "year", "Year"),
        make: requireFormString(formData, "make", "Make"),
        model: requireFormString(formData, "model", "Model"),
        trim: optionalFormString(formData, "trim"),
        mileage: requireFormInt(formData, "mileage", "Mileage"),
        stockNumber: optionalFormString(formData, "stockNumber"),
        exteriorColor: optionalFormString(formData, "exteriorColor"),
        titleStatus: enumField(formData, "titleStatus", TITLE_STATUSES, "UNKNOWN", "Title status"),
      },
      acquisition: {
        source: enumField(formData, "acquisitionSource", ACQUISITION_SOURCES, "AUCTION", "Acquisition source"),
        date: optionalFormDate(formData, "acquisitionDate", "Acquisition date"),
        purchasePriceCents: requireFormCents(formData, "purchasePrice", "Purchase price"),
        auctionFeesCents: optionalFormCents(formData, "auctionFees", "Auction fees"),
        transportationCents: optionalFormCents(formData, "transport", "Transport"),
        inspectionCents: optionalFormCents(formData, "inspection", "Inspection"),
        otherCents: optionalFormCents(formData, "otherCosts", "Other costs"),
      },
      pricing: {
        targetRetailPriceCents: optionalFormCents(formData, "targetRetail", "Target retail"),
        askingPriceCents: optionalFormCents(formData, "askingPrice", "Asking price"),
        minimumApprovedCents: optionalFormCents(formData, "minimumApproved", "Minimum approved"),
      },
    });

    return {
      vehicleId: result.vehicle.id,
      candidateId: result.candidateId,
      stockNumber: result.vehicle.stockNumber,
      status: result.vehicle.status,
      landedCostCents: result.landedCost.landedCostCents,
    };
  });
}

/**
 * VIN decode through the existing provider boundary (NHTSA vPIC).
 * Capability: `sourcing:read`. Returns `unavailable`/`error`; never fabricates.
 */
export async function decodeVinAction(formData: FormData): Promise<ActionResult<VinDecodeContract>> {
  return runOperation("buy.decodeVin", async () => {
    const ctx = await operationContext("sourcing:read");
    const result = await decodeOpportunityVin(ctx, requireFormString(formData, "vin", "VIN"));
    return {
      status: result.status,
      vin: result.data?.vin ?? requireFormString(formData, "vin", "VIN"),
      year: result.data?.year,
      make: result.data?.make,
      model: result.data?.model,
      trim: result.data?.trim,
      engine: result.data?.engine,
      bodyType: result.data?.bodyType,
      message: result.message,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* MARKET INTELLIGENCE — market evidence feeding the SAME economics engine     */
/* -------------------------------------------------------------------------- */

/** A copy of the form with the expected retail replaced by the derived figure. */
function withExpectedRetail(formData: FormData, retailCents: number): FormData {
  const copy = new FormData();
  for (const [key, value] of formData.entries()) copy.append(key, value);
  copy.set("estimatedRetail", centsToDecimalString(retailCents));
  return copy;
}

function marketComparableContract(comparable: MarketComparable): MarketComparableContract {
  return {
    source: comparable.source,
    vin: comparable.vin ?? null,
    year: comparable.year ?? null,
    make: comparable.make ?? null,
    model: comparable.model ?? null,
    trim: comparable.trim ?? null,
    mileage: comparable.mileage ?? null,
    askingPriceCents: comparable.askingPriceCents ?? null,
    distanceMiles: comparable.distanceMiles ?? null,
    dealerName: comparable.dealerName ?? null,
    dealerType: comparable.dealerType ?? null,
    listingUrl: comparable.listingUrl ?? null,
    listedDaysAgo: comparable.listedDaysAgo ?? null,
  };
}

/**
 * VIN + mileage + asking price -> market evidence -> conservative expected retail
 * -> the canonical acquisition verdict. ONE round trip, so Analyze cannot be
 * chained into an inconsistent state client-side.
 *
 * WHAT THIS DOES NOT DO
 * It does not value the car itself and it does not price the deal. The provider
 * estimates what the vehicle is WORTH; `deriveConservativeRetail` decides how
 * much of that estimate we are willing to assume; and `evaluateOpportunity` —
 * the very same pure engine the manual Analyze path calls, with the same
 * dealership thresholds — decides what we can AFFORD TO PAY. No formula from
 * that engine is re-implemented here.
 *
 * WHEN THE MARKET CANNOT ANSWER
 * The result carries `market: null` and a reason, and the evaluation still runs
 * from the operator's manual expected retail. Market failure never blocks the
 * workflow and never turns into a BUY.
 *
 * Capability: `sourcing:read`.
 */
export async function analyzeMarketAction(
  formData: FormData,
): Promise<ActionResult<MarketAnalysisContract>> {
  return runOperation("buy.analyzeMarket", async () => {
    const ctx = await operationContext("sourcing:read");

    const vinInput = optionalFormString(formData, "vin");
    const vin = vinInput === undefined ? undefined : normalizeVin(vinInput);
    const mileage = optionalFormInt(formData, "mileage", "Mileage") ?? 0;
    const year = optionalFormInt(formData, "year", "Year");
    const make = optionalFormString(formData, "make");
    const model = optionalFormString(formData, "model");
    const trim = optionalFormString(formData, "trim");
    const manualRetailCents = optionalFormCents(formData, "manualRetail", "Manual expected retail") ?? null;
    const refresh = formBoolean(formData, "refreshMarket");

    const settings = await getDealerSettings(ctx.db);
    const zip = optionalFormString(formData, "marketZip") ?? settings.postalCode ?? undefined;

    // ---- 1. market evidence (never a guess, never a fabricated snapshot)
    let snapshot: MarketValuationSnapshot | null = null;
    let marketUnavailableReason: string | null = null;

    const availability = marketValuationProvider.availability();
    if (availability.status === "unavailable") {
      marketUnavailableReason = availability.reason;
    } else if (vin === undefined && (year === undefined || make === undefined || model === undefined)) {
      marketUnavailableReason =
        "Enter a VIN — or the year, make and model — so the market can be searched for this vehicle.";
    } else {
      const result = await marketValuationProvider.valuate({
        vin: vin ?? "",
        mileage,
        zip: zip ?? undefined,
        year,
        make,
        model,
        trim,
        // The operator's deliberate "Refresh market data" must actually reach the
        // provider, otherwise the button would be a lie.
        forceRefresh: refresh,
      });
      if (result.status === "ok" && result.data !== undefined) {
        snapshot = result.data;
      } else {
        marketUnavailableReason = result.message ?? "Market data is unavailable right now.";
      }
    }

    // ---- 2. the conservative retail policy (pure, deterministic, no LLM)
    const retail = deriveConservativeRetail({ snapshot, mileage, manualRetailCents });

    // ---- 3. the EXISTING engine, unchanged, with the derived retail injected
    const thresholds = resolveSourcingThresholds(settings);
    const evaluation =
      retail.retailCents === null
        ? null
        : evaluationContract(
            evaluateOpportunity(
              {
                ...opportunityFromForm(withExpectedRetail(formData, retail.retailCents)),
                minGrossProfitCents: optionalFormCents(formData, "minGrossProfit", "Minimum gross profit"),
                minRoiBasisPoints: optionalFormInt(formData, "minRoi", "Minimum ROI (basis points)"),
              },
              thresholds,
            ),
          );

    const evidence = retail.evidence.comparableSummary;
    const market: MarketValuationContract | null =
      snapshot === null
        ? null
        : {
            provider: snapshot.provider,
            generatedAtIso: snapshot.generatedAt.toISOString(),
            retrievedLive: snapshot.retrievedLive,
            cacheTtlMinutes: marketCacheTtlMinutes(),
            predictedPriceCents: snapshot.predictedPriceCents,
            predictedLowCents: snapshot.predictedLowCents,
            predictedHighCents: snapshot.predictedHighCents,
            comparableCountReported: snapshot.comparableCountReported,
            comparables: snapshot.comparables.map(marketComparableContract),
            notes: snapshot.notes,
          };

    return {
      market,
      marketUnavailableReason,
      retail: {
        retailCents: retail.retailCents,
        source: retail.source,
        confidence: retail.confidence,
        marketEstimateCents: retail.marketEstimateCents,
        overridden: retail.overridden,
        policyVersion: retail.policyVersion,
        reasons: retail.reasons,
        warnings: retail.warnings,
        evidence: {
          predictedPriceCents: retail.evidence.predictedPriceCents,
          comparableMedianAskingCents: evidence?.medianAskingCents ?? null,
          comparableLowAskingCents: evidence?.lowAskingCents ?? null,
          comparableHighAskingCents: evidence?.highAskingCents ?? null,
          comparablesUsed: evidence?.used ?? 0,
          comparablesFilteredByMileage: evidence?.filteredByMileage ?? 0,
          comparablesTotal: evidence?.total ?? 0,
          mileageBand: evidence?.mileageBand ?? 0,
        },
      },
      evaluation,
      echo: {
        vin: vin ?? null,
        mileage: mileage > 0 ? mileage : null,
        askingPriceCents: optionalFormCents(formData, "askingPrice", "Asking price") ?? 0,
        expectedRetailCents: retail.retailCents,
        retailSource: retail.source,
        asOfIso: new Date().toISOString(),
        jurisdiction: null,
      },
    };
  });
}
