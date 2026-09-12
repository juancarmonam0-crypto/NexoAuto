import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import {
  acquireVehicleAction,
  createSourcingCandidateAction,
  recordSourcingDecisionAction,
} from "@/app/actions/buy";
import { hasCapability } from "@/lib/auth/roles";
import { DECIDABLE_CANDIDATE_STATUSES, listSourcingCandidates, SOURCING_SOURCES } from "@/lib/operations/sourcing";
import { pageOperationContext } from "@/lib/operations/runtime";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { MoneyMetric } from "@/app/_components/MoneyMetric";
import { ShoppingBag, Plus, Car, ArrowRight, ShieldCheck, HelpCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BuyPage() {
  const ctx = await pageOperationContext("sourcing:read");

  const { items, total } = await listSourcingCandidates(ctx, { limit: 50 });
  const canWrite = hasCapability(ctx.actor.role, "sourcing:write");

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-orange-700 uppercase tracking-widest">
            <ShoppingBag className="w-4 h-4 text-orange-600" />
            <span>Sourcing Decision Engine</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-0.5">
            BUY — Sourcing Inbox
          </h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Evaluate prospective vehicle purchases with deterministic economic calculations.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 shadow-xs">
          <span className="text-slate-400">Total in Inbox:</span>
          <span className="font-bold text-slate-900">{total} opportunities</span>
        </div>
      </div>

      {/* Sourcing Intake Form */}
      {canWrite ? (
        <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Plus className="w-4 h-4 text-orange-600" />
              <span>Evaluate Prospective Vehicle</span>
            </h2>
            <span className="text-[11px] font-mono text-slate-500">Auto-calculated economics</span>
          </div>

          <ActionForm
            action={createSourcingCandidateAction}
            submitLabel="Evaluate & Run Decision Engine"
            successMessage="Opportunity evaluated and added to inbox!"
            buttonVariant="primary"
            buttonSize="md"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  VIN
                </label>
                <input
                  name="vin"
                  placeholder="17-character VIN"
                  maxLength={17}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 uppercase focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Year
                </label>
                <input
                  name="year"
                  type="number"
                  defaultValue={new Date().getFullYear()}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Make
                </label>
                <input
                  name="make"
                  placeholder="e.g. Honda, Toyota"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Model
                </label>
                <input
                  name="model"
                  placeholder="e.g. Civic, RAV4"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">Trim</label>
                <input
                  name="trim"
                  placeholder="EX, Sport, etc."
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Mileage
                </label>
                <input
                  name="mileage"
                  inputMode="numeric"
                  placeholder="45000"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Asking Price ($) <span className="text-orange-600">*</span>
                </label>
                <input
                  name="askingPrice"
                  inputMode="decimal"
                  required
                  placeholder="12500.00"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Estimated Retail ($) <span className="text-orange-600">*</span>
                </label>
                <input
                  name="estimatedRetail"
                  inputMode="decimal"
                  required
                  placeholder="16500.00"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Est. Recon Cost ($)
                </label>
                <input
                  name="estimatedRecon"
                  inputMode="decimal"
                  placeholder="800.00"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Est. Transport ($)
                </label>
                <input
                  name="transport"
                  inputMode="decimal"
                  placeholder="300.00"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Sourcing Channel
                </label>
                <select
                  name="source"
                  defaultValue="MANUAL_ENTRY"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                >
                  {SOURCING_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Notes
                </label>
                <input
                  name="notes"
                  placeholder="Clean title, auction lot #42..."
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>
            </div>
          </ActionForm>
        </section>
      ) : (
        <div className="p-4 rounded-xl bg-white border border-slate-200 text-slate-500 text-xs text-center shadow-xs">
          Read-only access for current role.
        </div>
      )}

      {/* Sourcing Inbox Opportunities Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          Sourced Opportunities ({items.length})
        </h2>

        {items.length === 0 ? (
          <div className="p-8 sm:p-12 text-center rounded-xl bg-white border border-slate-200 space-y-3 shadow-xs">
            <Car className="w-10 h-10 text-slate-400 mx-auto" />
            <h3 className="text-base font-bold text-slate-900">Sourcing inbox is empty</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Evaluate prospective vehicles using the form above to run the economic decision engine.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {items.map((opp) => {
              const title = `${opp.year ?? "Year TBD"} ${opp.make ?? ""} ${opp.model ?? ""}${opp.trim ? ` ${opp.trim}` : ""}`.trim() || "Unspecified Candidate";
              const decision = opp.recommendation ?? "WATCH";
              const isPurchased = opp.status === "PURCHASED";

              return (
                <div
                  key={opp.id}
                  className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between space-y-5"
                >
                  <div className="space-y-4">
                    {/* Header with Title & Verdict */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">{title}</h3>
                        <div className="flex items-center gap-2 text-xs font-mono text-slate-500 mt-0.5">
                          {opp.mileage && <span>{opp.mileage.toLocaleString("en-US")} mi</span>}
                          {opp.vin && (
                            <>
                              <span>•</span>
                              <span>VIN: {opp.vin}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge
                          status={decision}
                          variant={decision === "BUY" ? "success" : decision === "WATCH" ? "warning" : "neutral"}
                          size="md"
                        />
                        <span className="text-[10px] font-mono text-slate-400">
                          {opp.status}
                        </span>
                      </div>
                    </div>

                    {/* Financial Matrix (Calculated on Server) */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-100">
                      <MoneyMetric label="Asking Price" valueCents={opp.askingPriceCents} size="sm" />
                      <MoneyMetric label="Landed Cost" valueCents={opp.landedCostCents} size="sm" />
                      <MoneyMetric
                        label="Est. Gross"
                        valueCents={opp.expectedProfitCents}
                        accent="green"
                        size="sm"
                      />
                      <MoneyMetric
                        label="Est. ROI"
                        valueCents={null}
                        roiBasisPoints={opp.expectedRoiBasisPoints}
                        accent="orange"
                        size="sm"
                      />
                    </div>

                    {/* Sourcing Verdict Explanation */}
                    {opp.recommendationReasons && opp.recommendationReasons.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-mono uppercase text-slate-500 block">
                          Engine Verdict Rules:
                        </span>
                        <ul className="text-xs text-slate-600 space-y-0.5 list-disc list-inside">
                          {opp.recommendationReasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Operator Decision Controls */}
                  {canWrite && !isPurchased && (
                    <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                      <ActionForm
                        action={recordSourcingDecisionAction}
                        submitLabel="Record Decision"
                        successMessage="Decision updated."
                        buttonVariant="outline"
                        buttonSize="sm"
                      >
                        <input type="hidden" name="candidateId" value={opp.id} />
                        <div className="flex items-center gap-2">
                          <select
                            name="status"
                            defaultValue={opp.status}
                            className="px-2 py-1 rounded bg-white border border-slate-300 text-xs text-slate-900"
                          >
                            {DECIDABLE_CANDIDATE_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        </div>
                      </ActionForm>

                      {opp.status === "APPROVED_TO_BUY" && (
                        <ActionForm
                          action={acquireVehicleAction}
                          submitLabel="Acquire to Fleet"
                          successMessage="Vehicle converted to inventory!"
                          buttonVariant="primary"
                          buttonSize="sm"
                        >
                          <input type="hidden" name="candidateId" value={opp.id} />
                          <input type="hidden" name="vin" value={opp.vin ?? "1HGCR2F8XNA000000"} />
                          <input type="hidden" name="year" value={opp.year ?? new Date().getFullYear()} />
                          <input type="hidden" name="make" value={opp.make ?? "Unknown"} />
                          <input type="hidden" name="model" value={opp.model ?? "Unknown"} />
                          <input type="hidden" name="mileage" value={opp.mileage ?? 0} />
                          <input
                            name="purchasePrice"
                            inputMode="decimal"
                            required
                            placeholder="Final Price ($)"
                            className="px-2 py-1 rounded bg-white border border-slate-300 text-xs font-mono text-slate-900 w-28"
                          />
                        </ActionForm>
                      )}
                    </div>
                  )}

                  {isPurchased && (
                    <div className="pt-3 border-t border-slate-100 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                      <ShieldCheck className="w-4 h-4" />
                      <span>Purchased & Converted to Fleet</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
