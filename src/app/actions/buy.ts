"use server";

import { type ActionResult, runOperation } from "@/lib/action-result";
import type {
  OpportunityEvaluationContract,
  SourcingCandidateContract,
  SourcingDecisionContract,
  VehicleAcquiredContract,
  VinDecodeContract,
} from "@/lib/boundary/contracts";
import {
  enumField,
  optionalFormCents,
  optionalFormDate,
  optionalFormInt,
  optionalFormString,
  requireFormCents,
  requireFormInt,
  requireFormString,
} from "@/lib/forms";
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
