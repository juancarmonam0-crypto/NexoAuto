import Link from "next/link";
import {
  Car,
  ExternalLink,
  Gavel,
  ListFilter,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
} from "lucide-react";

import { ActionForm } from "@/app/_components/ActionForm";
import { BuyAnalyzer } from "@/app/_components/BuyAnalyzer";
import { MoneyMetric } from "@/app/_components/MoneyMetric";
import { StatusBadge } from "@/app/_components/StatusBadge";
import {
  acquireVehicleAction,
  recordSourcingDecisionAction,
  updateSourcingCandidateAction,
} from "@/app/actions/buy";
import { hasCapability } from "@/lib/auth/roles";
import {
  ACQUISITION_SOURCES,
  DECIDABLE_CANDIDATE_STATUSES,
  SOURCING_CANDIDATE_STATUSES,
  SOURCING_SOURCES,
  TITLE_STATUSES,
  listSourcingCandidates,
} from "@/lib/operations";
import { pageOperationContext } from "@/lib/operations/runtime";
import { centsToDecimalString } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * BUY — the sourcing boundary, surfaced.
 *
 * This page READS the authoritative sourcing operations and RENDERS their
 * output. It computes nothing: the verdict, the ceiling, the landed cost, the
 * profit and the ROI written onto a candidate were all produced by
 * `evaluateOpportunity()` on the server and are stored on the row.
 *
 * What an operator can do here, and which existing action does it:
 *
 *   capture + score an opportunity   evaluateOpportunityAction / createSourcingCandidateAction
 *   decode a VIN                     decodeVinAction          (BuyAnalyzer)
 *   re-score a saved opportunity     updateSourcingCandidateAction
 *   record the human BUY/PASS call   recordSourcingDecisionAction
 *   convert APPROVED_TO_BUY to stock acquireVehicleAction
 *
 * NOTE ON MASKING: the sourcing inbox is gated by `sourcing:read` on the
 * server — not by `finance:read` — so these figures are not withheld at render
 * time and `masked={false}` is passed explicitly: an empty figure must read
 * "—" (never evaluated yet), not "Hidden".
 */

const RECOMMENDATIONS = ["BUY", "WATCH", "PASS"] as const;

type CandidateRow = Awaited<ReturnType<typeof listSourcingCandidates>>["items"][number];

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500";
const labelClass = "block font-mono text-[11px] font-medium uppercase tracking-wider text-slate-600";
const cardClass = "rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6";

function filterHref(params: { status?: string; recommendation?: string }): string {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.recommendation) search.set("recommendation", params.recommendation);
  const query = search.toString();
  return query ? `/buy?${query}` : "/buy";
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function BuyPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; recommendation?: string }>;
}) {
  const ctx = await pageOperationContext("sourcing:read");
  const params = await searchParams;

  // Filters come from the operation's own validated filter schema; an unknown
  // value in the URL simply means "no filter" instead of an error page.
  const status = SOURCING_CANDIDATE_STATUSES.find((value) => value === params.status);
  const recommendation = RECOMMENDATIONS.find((value) => value === params.recommendation);

  const { items, total } = await listSourcingCandidates(ctx, { limit: 50, status, recommendation });
  const canWrite = hasCapability(ctx.actor.role, "sourcing:write");
  const filtered = Boolean(status || recommendation);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-orange-700">
            <ShoppingBag className="h-4 w-4 text-orange-600" />
            <span>Sourcing Decision Engine</span>
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            BUY — Sourcing Inbox
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Score a prospective purchase before you commit capital. The engine returns the verdict, the
            ceiling and the reasons.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-700 shadow-xs">
          <span className="text-slate-400">Opportunities:</span>
          <span className="font-bold text-slate-900">
            {total}
            {filtered ? " matching filter" : ""}
          </span>
        </div>
      </div>

      {/* Workbench — analyze, decode, save. Read-only roles can still score. */}
      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-900">
            <Sparkles className="h-4 w-4 text-orange-600" />
            <span>Evaluate a prospective vehicle</span>
          </h2>
          <span className="font-mono text-[11px] text-slate-500">
            {canWrite ? "Analyze first — nothing is stored until you save" : "Read-only role: analysis only"}
          </span>
        </div>
        <div className="mt-4">
          <BuyAnalyzer canWrite={canWrite} sources={SOURCING_SOURCES} />
        </div>
      </section>

      {/* Inbox */}
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            Sourced opportunities ({items.length}
            {filtered ? ` of ${total}` : ""})
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-slate-500">
              <ListFilter className="h-3.5 w-3.5" />
              Status
            </span>
            <FilterChip href={filterHref({ recommendation })} label="All" active={!status} />
            {SOURCING_CANDIDATE_STATUSES.map((value) => (
              <FilterChip
                key={value}
                href={filterHref({ status: value, recommendation })}
                label={value.replace(/_/g, " ")}
                active={status === value}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">Verdict</span>
          <FilterChip href={filterHref({ status })} label="Any" active={!recommendation} />
          {RECOMMENDATIONS.map((value) => (
            <FilterChip
              key={value}
              href={filterHref({ status, recommendation: value })}
              label={value}
              active={recommendation === value}
            />
          ))}
        </div>

        {items.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs sm:p-12">
            <Car className="mx-auto h-10 w-10 text-slate-400" />
            <h3 className="text-base font-bold text-slate-900">
              {filtered ? "No opportunities match this filter" : "Sourcing inbox is empty"}
            </h3>
            <p className="mx-auto max-w-sm text-xs text-slate-500">
              {filtered
                ? "Clear the filter to see the whole inbox."
                : "Score a prospective vehicle above and save it to start a decision record."}
            </p>
            {filtered ? (
              <Link
                href="/buy"
                className="inline-block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear filters
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {items.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} canWrite={canWrite} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** One opportunity: what it is, what the engine said, and what you can do next. */
function CandidateCard({ candidate, canWrite }: { candidate: CandidateRow; canWrite: boolean }) {
  const isPurchased = candidate.status === "PURCHASED";
  const isDecided = candidate.decidedAt !== null;
  const title =
    [candidate.year, candidate.make, candidate.model, candidate.trim]
      .filter((part) => part !== null && part !== undefined && part !== "")
      .join(" ") || "Unidentified vehicle";

  const identity = [
    candidate.vin ? { label: "VIN", value: candidate.vin, mono: true } : null,
    candidate.mileage !== null ? { label: "Mileage", value: `${candidate.mileage.toLocaleString("en-US")} mi`, mono: true } : null,
    candidate.sellerName ? { label: "Seller", value: candidate.sellerName, mono: false } : null,
    candidate.location ? { label: "Location", value: candidate.location, mono: false } : null,
  ].filter((row): row is { label: string; value: string; mono: boolean } => row !== null);

  return (
    <article className={`${cardClass} flex flex-col gap-4`}>
      {/* Identity + verdict */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-slate-900">{title}</h3>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">
            {candidate.source.replace(/_/g, " ")}
            {" · added "}
            {candidate.createdAt.toISOString().slice(0, 10)}
            {isDecided && candidate.decidedAt
              ? ` · decided ${candidate.decidedAt.toISOString().slice(0, 10)}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {candidate.recommendation ? (
            <StatusBadge
              status={candidate.recommendation}
              variant={
                candidate.recommendation === "BUY"
                  ? "success"
                  : candidate.recommendation === "WATCH"
                    ? "warning"
                    : "neutral"
              }
              size="md"
            />
          ) : (
            <StatusBadge status="NOT SCORED" variant="neutral" size="md" />
          )}
          <StatusBadge status={candidate.status.replace(/_/g, " ")} size="sm" />
        </div>
      </header>

      {identity.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
          {identity.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className={labelClass}>{row.label}</dt>
              <dd className={`truncate text-xs text-slate-800 ${row.mono ? "font-mono" : ""}`}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* Engine output. All values are the stored snapshot — nothing is recomputed here. */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3.5 sm:grid-cols-4">
        <MoneyMetric label="Asking" valueCents={candidate.askingPriceCents} size="sm" masked={false} />
        <MoneyMetric label="Landed cost" valueCents={candidate.landedCostCents} size="sm" masked={false} />
        <MoneyMetric
          label="Expected gross"
          valueCents={candidate.expectedProfitCents}
          accent="green"
          size="sm"
          masked={false}
        />
        <MoneyMetric
          label="Expected ROI"
          valueCents={null}
          roiBasisPoints={candidate.expectedRoiBasisPoints}
          accent="orange"
          size="sm"
          masked={false}
        />
        <MoneyMetric label="Max purchase" valueCents={candidate.maxPurchasePriceCents} size="sm" masked={false} />
        <MoneyMetric label="Max bid" valueCents={candidate.maxBidCents} accent="orange" size="sm" masked={false} />
        <MoneyMetric label="Expected retail" valueCents={candidate.estimatedRetailCents} size="sm" masked={false} />
        <MoneyMetric
          label="Recon estimate"
          valueCents={candidate.estimatedReconCents}
          accent="muted"
          size="sm"
          masked={false}
        />
      </div>

      <details className="rounded-lg border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
          Cost structure &amp; seller details
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MoneyMetric label="Auction fees" valueCents={candidate.expectedAuctionFeesCents} size="sm" masked={false} />
          <MoneyMetric label="Transport" valueCents={candidate.transportEstimateCents} size="sm" masked={false} />
          <MoneyMetric label="Other costs" valueCents={candidate.otherCostsCents} size="sm" masked={false} />
          <MoneyMetric
            label="Min gross floor"
            valueCents={candidate.minGrossProfitCents}
            size="sm"
            masked={false}
          />
          <MoneyMetric
            label="Min ROI floor"
            valueCents={null}
            roiBasisPoints={candidate.minRoiBasisPoints}
            size="sm"
            masked={false}
          />
          <div className="min-w-0">
            <p className={labelClass}>Listing</p>
            {candidate.listingUrl ? (
              <a
                href={candidate.listingUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 truncate text-xs font-semibold text-orange-700 hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">Open listing</span>
              </a>
            ) : (
              <p className="text-xs text-slate-500">Not recorded</p>
            )}
          </div>
        </div>
        {candidate.notes ? (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600">
            {candidate.notes}
          </p>
        ) : null}
      </details>

      {/* Why the engine said what it said */}
      {candidate.recommendationReasons.length > 0 ? (
        <div className="space-y-1">
          <p className={labelClass}>Engine verdict rules</p>
          <ul className="space-y-0.5">
            {candidate.recommendationReasons.map((reason, index) => (
              <li key={`${candidate.id}-reason-${index}`} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                <span aria-hidden="true" className="text-orange-500">
                  •
                </span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-slate-500">This opportunity has not been scored yet.</p>
      )}

      {/* Human decision record */}
      {isDecided ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">Decision note: </span>
          {candidate.decisionNotes ?? "No note was recorded with the decision."}
        </p>
      ) : null}

      {isPurchased ? (
        <p className="flex items-center gap-1.5 border-t border-slate-100 pt-3 text-xs font-semibold text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          <span>
            Purchased and converted to inventory
            {candidate.purchasedVehicleId ? " — edit its costs on the vehicle record." : "."}
          </span>
        </p>
      ) : null}

      {canWrite && !isPurchased ? (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <ActionForm
            action={recordSourcingDecisionAction}
            submitLabel="Record decision"
            successMessage="Decision recorded."
            buttonVariant="outline"
            buttonSize="sm"
          >
            <input type="hidden" name="candidateId" value={candidate.id} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`decision-status-${candidate.id}`} className={labelClass}>
                  Your call
                </label>
                <select
                  id={`decision-status-${candidate.id}`}
                  name="status"
                  defaultValue={candidate.status}
                  className={inputClass}
                >
                  {DECIDABLE_CANDIDATE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor={`decision-notes-${candidate.id}`} className={labelClass}>
                  Decision note
                </label>
                <input
                  id={`decision-notes-${candidate.id}`}
                  name="notes"
                  defaultValue={candidate.decisionNotes ?? ""}
                  placeholder="Why you called it this way"
                  className={inputClass}
                />
              </div>
            </div>
          </ActionForm>

          <details className="rounded-lg border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">
              Revise inputs &amp; re-score
            </summary>
            <p className="mt-1 text-[11px] text-slate-500">
              Changing a price re-runs the engine and overwrites the stored verdict with the new one.
            </p>
            <div className="mt-3">
              <ActionForm
                action={updateSourcingCandidateAction}
                submitLabel="Re-score"
                successMessage="Opportunity re-scored."
                buttonVariant="neutral"
                buttonSize="sm"
              >
                <input type="hidden" name="candidateId" value={candidate.id} />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <label htmlFor={`revise-asking-${candidate.id}`} className={labelClass}>
                      Asking / bid ($)
                    </label>
                    <input
                      id={`revise-asking-${candidate.id}`}
                      name="askingPrice"
                      inputMode="decimal"
                      defaultValue={centsToDecimalString(candidate.askingPriceCents)}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`revise-retail-${candidate.id}`} className={labelClass}>
                      Expected retail ($)
                    </label>
                    <input
                      id={`revise-retail-${candidate.id}`}
                      name="estimatedRetail"
                      inputMode="decimal"
                      defaultValue={centsToDecimalString(candidate.estimatedRetailCents)}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`revise-recon-${candidate.id}`} className={labelClass}>
                      Recon estimate ($)
                    </label>
                    <input
                      id={`revise-recon-${candidate.id}`}
                      name="estimatedRecon"
                      inputMode="decimal"
                      defaultValue={centsToDecimalString(candidate.estimatedReconCents)}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`revise-notes-${candidate.id}`} className={labelClass}>
                    Notes
                  </label>
                  <input
                    id={`revise-notes-${candidate.id}`}
                    name="notes"
                    defaultValue={candidate.notes ?? ""}
                    className={inputClass}
                  />
                </div>
              </ActionForm>
            </div>
          </details>

          {candidate.status === "APPROVED_TO_BUY" ? (
            <details className="rounded-lg border border-orange-200 bg-orange-50/40 p-3">
              <summary className="flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-800">
                <Gavel className="h-3.5 w-3.5" />
                <span>Acquire to fleet</span>
              </summary>
              <p className="mt-1 text-[11px] text-slate-600">
                These become the vehicle&apos;s permanent record, so confirm every value. Nothing is
                invented for you: a blank required field is rejected by the server.
              </p>
              <div className="mt-3">
                <ActionForm
                  action={acquireVehicleAction}
                  submitLabel="Acquire vehicle"
                  successMessage="Vehicle added to inventory."
                  buttonVariant="primary"
                  buttonSize="sm"
                >
                  <input type="hidden" name="candidateId" value={candidate.id} />
                  <fieldset className="space-y-2">
                    <legend className={labelClass}>Vehicle</legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <label htmlFor={`acq-vin-${candidate.id}`} className={labelClass}>
                          VIN <span className="text-orange-600">*</span>
                        </label>
                        <input
                          id={`acq-vin-${candidate.id}`}
                          name="vin"
                          required
                          maxLength={17}
                          defaultValue={candidate.vin ?? ""}
                          className={`${inputClass} font-mono uppercase`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-year-${candidate.id}`} className={labelClass}>
                          Year <span className="text-orange-600">*</span>
                        </label>
                        <input
                          id={`acq-year-${candidate.id}`}
                          name="year"
                          required
                          inputMode="numeric"
                          defaultValue={candidate.year ?? ""}
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-make-${candidate.id}`} className={labelClass}>
                          Make <span className="text-orange-600">*</span>
                        </label>
                        <input
                          id={`acq-make-${candidate.id}`}
                          name="make"
                          required
                          defaultValue={candidate.make ?? ""}
                          className={inputClass}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-model-${candidate.id}`} className={labelClass}>
                          Model <span className="text-orange-600">*</span>
                        </label>
                        <input
                          id={`acq-model-${candidate.id}`}
                          name="model"
                          required
                          defaultValue={candidate.model ?? ""}
                          className={inputClass}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-mileage-${candidate.id}`} className={labelClass}>
                          Mileage <span className="text-orange-600">*</span>
                        </label>
                        <input
                          id={`acq-mileage-${candidate.id}`}
                          name="mileage"
                          required
                          inputMode="numeric"
                          defaultValue={candidate.mileage ?? ""}
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-stock-${candidate.id}`} className={labelClass}>
                          Stock number
                        </label>
                        <input
                          id={`acq-stock-${candidate.id}`}
                          name="stockNumber"
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-color-${candidate.id}`} className={labelClass}>
                          Exterior colour
                        </label>
                        <input id={`acq-color-${candidate.id}`} name="exteriorColor" className={inputClass} />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-title-${candidate.id}`} className={labelClass}>
                          Title status
                        </label>
                        <select
                          id={`acq-title-${candidate.id}`}
                          name="titleStatus"
                          defaultValue="UNKNOWN"
                          className={inputClass}
                        >
                          {TITLE_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {value.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </fieldset>

                  <fieldset className="space-y-2">
                    <legend className={labelClass}>Purchase</legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <label htmlFor={`acq-source-${candidate.id}`} className={labelClass}>
                          Acquisition source
                        </label>
                        <select
                          id={`acq-source-${candidate.id}`}
                          name="acquisitionSource"
                          defaultValue="AUCTION"
                          className={inputClass}
                        >
                          {ACQUISITION_SOURCES.map((value) => (
                            <option key={value} value={value}>
                              {value.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-date-${candidate.id}`} className={labelClass}>
                          Acquisition date
                        </label>
                        <input
                          id={`acq-date-${candidate.id}`}
                          name="acquisitionDate"
                          type="date"
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-price-${candidate.id}`} className={labelClass}>
                          Purchase price ($) <span className="text-orange-600">*</span>
                        </label>
                        <input
                          id={`acq-price-${candidate.id}`}
                          name="purchasePrice"
                          required
                          inputMode="decimal"
                          defaultValue={centsToDecimalString(candidate.askingPriceCents)}
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-fees-${candidate.id}`} className={labelClass}>
                          Auction fees ($)
                        </label>
                        <input
                          id={`acq-fees-${candidate.id}`}
                          name="auctionFees"
                          inputMode="decimal"
                          defaultValue={centsToDecimalString(candidate.expectedAuctionFeesCents)}
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-transport-${candidate.id}`} className={labelClass}>
                          Transport ($)
                        </label>
                        <input
                          id={`acq-transport-${candidate.id}`}
                          name="transport"
                          inputMode="decimal"
                          defaultValue={centsToDecimalString(candidate.transportEstimateCents)}
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-inspection-${candidate.id}`} className={labelClass}>
                          Inspection ($)
                        </label>
                        <input
                          id={`acq-inspection-${candidate.id}`}
                          name="inspection"
                          inputMode="decimal"
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-other-${candidate.id}`} className={labelClass}>
                          Other costs ($)
                        </label>
                        <input
                          id={`acq-other-${candidate.id}`}
                          name="otherCosts"
                          inputMode="decimal"
                          defaultValue={centsToDecimalString(candidate.otherCostsCents)}
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                    </div>
                  </fieldset>

                  <fieldset className="space-y-2">
                    <legend className={labelClass}>Opening price targets</legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <label htmlFor={`acq-retail-${candidate.id}`} className={labelClass}>
                          Target retail ($)
                        </label>
                        <input
                          id={`acq-retail-${candidate.id}`}
                          name="targetRetail"
                          inputMode="decimal"
                          defaultValue={centsToDecimalString(candidate.estimatedRetailCents)}
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-asking-${candidate.id}`} className={labelClass}>
                          Asking price ($)
                        </label>
                        <input
                          id={`acq-asking-${candidate.id}`}
                          name="askingPrice"
                          inputMode="decimal"
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`acq-min-${candidate.id}`} className={labelClass}>
                          Minimum approved ($)
                        </label>
                        <input
                          id={`acq-min-${candidate.id}`}
                          name="minimumApproved"
                          inputMode="decimal"
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                    </div>
                  </fieldset>
                </ActionForm>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
