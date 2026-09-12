"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Search, Save, Sparkles } from "lucide-react";
import {
  createSourcingCandidateAction,
  decodeVinAction,
  evaluateOpportunityAction,
} from "@/app/actions/buy";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { formatBasisPoints, formatCents } from "@/lib/money";
import type { OpportunityEvaluationContract, VinDecodeContract } from "@/lib/boundary/contracts";

/**
 * The BUY workbench: capture an opportunity, score it, save it.
 *
 * THREE BUTTONS, ONE FORM
 *   Decode VIN    → existing `decodeVinAction` (NHTSA vPIC) fills the identity fields
 *   Analyze       → existing `evaluateOpportunityAction`, nothing is saved
 *   Save          → existing `createSourcingCandidateAction`
 *
 * NO ARITHMETIC LIVES HERE. Every figure in the result panel — the verdict, the
 * ceiling, the profit, the ROI, the landed cost and the written reasons — is the
 * canonical engine's output returned by the server. This component only lays it
 * out so the decision is the loudest thing on the screen.
 */

interface BuyAnalyzerProps {
  canWrite: boolean;
  /**
   * The sourcing channels, passed IN from the server page.
   *
   * This component is a client component, so it must not import from
   * `@/lib/operations`: that barrel reaches `@/lib/storage` and
   * `node:fs/promises`, which cannot be bundled for the browser (Turbopack
   * fails the production build outright). The server owns the vocabulary; the
   * client only renders what it is handed.
   */
  sources: readonly string[];
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500";
const labelClass = "block font-mono text-[11px] font-medium uppercase tracking-wider text-slate-600";

export function BuyAnalyzer({ canWrite, sources }: BuyAnalyzerProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [evaluation, setEvaluation] = useState<OpportunityEvaluationContract | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  // Identity fields are controlled because the VIN decoder writes into them.
  const [identity, setIdentity] = useState({ vin: "", year: "", make: "", model: "", trim: "", mileage: "" });

  function readForm(): FormData | null {
    const form = formRef.current;
    return form ? new FormData(form) : null;
  }

  function handleAnalyze() {
    const formData = readForm();
    if (!formData) return;
    setOutcome(null);
    startTransition(async () => {
      const result = await evaluateOpportunityAction(formData);
      if (result.ok) {
        setEvaluation(result.data);
        setOutcome(null);
      } else {
        setEvaluation(null);
        setOutcome({ ok: false, message: result.error });
      }
    });
  }

  function handleSave() {
    const formData = readForm();
    if (!formData) return;
    startTransition(async () => {
      const result = await createSourcingCandidateAction(formData);
      if (result.ok) {
        setOutcome({ ok: true, message: "Opportunity saved to the inbox." });
        setEvaluation(result.data);
        router.refresh();
      } else {
        setOutcome({ ok: false, message: result.error });
      }
    });
  }

  function handleDecode() {
    const formData = readForm();
    if (!formData) return;
    startTransition(async () => {
      const result = await decodeVinAction(formData);
      if (!result.ok) {
        setOutcome({ ok: false, message: result.error });
        return;
      }
      applyDecode(result.data);
    });
  }

  function applyDecode(decoded: VinDecodeContract) {
    if (decoded.status !== "ok") {
      // The provider refuses to invent specification data; say so plainly.
      setOutcome({ ok: false, message: decoded.message ?? "That VIN could not be decoded. Enter the details manually." });
      return;
    }
    setIdentity({
      vin: decoded.vin ?? "",
      year: decoded.year !== undefined ? String(decoded.year) : "",
      make: decoded.make ?? "",
      model: decoded.model ?? "",
      trim: decoded.trim ?? "",
      mileage: "",
    });
    setOutcome({ ok: true, message: "VIN decoded — confirm the details before saving." });
  }

  return (
    <div className="space-y-5">
      <form ref={formRef} className="space-y-5" onSubmit={(event) => event.preventDefault()}>
        {/* VEHICLE */}
        <fieldset className="space-y-3">
          <legend className="font-mono text-[11px] font-bold uppercase tracking-widest text-orange-700">
            1 · Vehicle
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <div className="col-span-2 space-y-1">
              <label htmlFor="buy-vin" className={labelClass}>
                VIN
              </label>
              <div className="flex gap-1.5">
                <input
                  id="buy-vin"
                  name="vin"
                  value={identity.vin}
                  onChange={(event) => setIdentity({ ...identity, vin: event.target.value.toUpperCase() })}
                  placeholder="17 characters"
                  className={`${inputClass} font-mono`}
                />
                <button
                  type="button"
                  onClick={handleDecode}
                  disabled={pending || identity.vin.trim() === ""}
                  title="Decode this VIN (NHTSA vPIC)"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Decode</span>
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="buy-year" className={labelClass}>
                Year
              </label>
              <input
                id="buy-year"
                name="year"
                inputMode="numeric"
                value={identity.year}
                onChange={(event) => setIdentity({ ...identity, year: event.target.value })}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="buy-make" className={labelClass}>
                Make
              </label>
              <input
                id="buy-make"
                name="make"
                value={identity.make}
                onChange={(event) => setIdentity({ ...identity, make: event.target.value })}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="buy-model" className={labelClass}>
                Model
              </label>
              <input
                id="buy-model"
                name="model"
                value={identity.model}
                onChange={(event) => setIdentity({ ...identity, model: event.target.value })}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="buy-mileage" className={labelClass}>
                Mileage
              </label>
              <input
                id="buy-mileage"
                name="mileage"
                inputMode="numeric"
                value={identity.mileage}
                onChange={(event) => setIdentity({ ...identity, mileage: event.target.value })}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="buy-trim" className={labelClass}>
                Trim
              </label>
              <input
                id="buy-trim"
                name="trim"
                value={identity.trim}
                onChange={(event) => setIdentity({ ...identity, trim: event.target.value })}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="buy-source" className={labelClass}>
                Source
              </label>
              <select id="buy-source" name="source" defaultValue="MANUAL_ENTRY" className={inputClass}>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {source.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        {/* COSTS */}
        <fieldset className="space-y-3">
          <legend className="font-mono text-[11px] font-bold uppercase tracking-widest text-orange-700">
            2 · Costs &amp; expected retail
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { name: "askingPrice", label: "Asking / bid ($)", required: true },
              { name: "auctionFees", label: "Auction / buyer fees ($)" },
              { name: "transport", label: "Transport ($)" },
              { name: "inspection", label: "Inspection ($)" },
              { name: "estimatedRecon", label: "Recon estimate ($)" },
              { name: "otherCosts", label: "Other costs ($)" },
              { name: "estimatedRetail", label: "Expected retail ($)", required: true },
            ].map((field) => (
              <div key={field.name} className="space-y-1">
                <label htmlFor={`buy-${field.name}`} className={labelClass}>
                  {field.label}
                  {field.required ? <span className="text-orange-600"> *</span> : null}
                </label>
                <input
                  id={`buy-${field.name}`}
                  name={field.name}
                  inputMode="decimal"
                  required={field.required}
                  placeholder="0.00"
                  className={`${inputClass} font-mono`}
                />
              </div>
            ))}
            <div className="space-y-1">
              <label htmlFor="buy-sellerName" className={labelClass}>
                Seller
              </label>
              <input id="buy-sellerName" name="sellerName" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label htmlFor="buy-location" className={labelClass}>
                Location
              </label>
              <input id="buy-location" name="location" className={inputClass} />
            </div>
            <div className="col-span-2 space-y-1">
              <label htmlFor="buy-listingUrl" className={labelClass}>
                Listing URL
              </label>
              <input id="buy-listingUrl" name="listingUrl" className={inputClass} />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-4">
              <label htmlFor="buy-notes" className={labelClass}>
                Notes
              </label>
              <input id="buy-notes" name="notes" className={inputClass} />
            </div>
          </div>
          <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">
              Override the dealership floors for this analysis
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="buy-minGrossProfit" className={labelClass}>
                  Minimum gross profit ($)
                </label>
                <input id="buy-minGrossProfit" name="minGrossProfit" inputMode="decimal" className={`${inputClass} font-mono`} />
              </div>
              <div className="space-y-1">
                <label htmlFor="buy-minRoi" className={labelClass}>
                  Minimum ROI (basis points)
                </label>
                <input id="buy-minRoi" name="minRoi" inputMode="numeric" className={`${inputClass} font-mono`} />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Leave blank to use the dealership configuration. 1000 bps = 10%.
            </p>
          </details>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-orange-400" />}
            <span>Analyze</span>
          </button>
          {canWrite ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              <span>Save opportunity</span>
            </button>
          ) : null}
          <span className="text-[11px] text-slate-500">
            Analyze calls the canonical sourcing engine; nothing is stored until you save.
          </span>
        </div>
      </form>

      {outcome ? (
        <p
          role={outcome.ok ? "status" : "alert"}
          className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
            outcome.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {outcome.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          )}
          <span>{outcome.message}</span>
        </p>
      ) : null}

      {evaluation ? <EvaluationPanel evaluation={evaluation} /> : null}
    </div>
  );
}

/** The verdict panel — the loudest thing on the BUY screen. */
function EvaluationPanel({ evaluation }: { evaluation: OpportunityEvaluationContract }) {
  const tone =
    evaluation.recommendation === "BUY"
      ? "border-emerald-300 bg-emerald-50"
      : evaluation.recommendation === "WATCH"
        ? "border-amber-300 bg-amber-50"
        : "border-slate-300 bg-slate-50";

  return (
    <section aria-live="polite" className={`rounded-xl border-2 p-4 sm:p-5 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={evaluation.recommendation} size="md" />
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-slate-600">Verdict</p>
            <p className="text-sm font-semibold text-slate-900">
              {evaluation.recommendation === "BUY"
                ? "Strong opportunity at this price"
                : evaluation.recommendation === "WATCH"
                  ? "Worth watching, not at this price"
                  : "Loses money as priced"}
            </p>
          </div>
        </div>
        <p className="font-mono text-[11px] text-slate-600">
          binding constraint: {evaluation.bindingConstraint.replace(/-/g, " ")}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">Max buy / bid</p>
          <p className="font-mono text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
            {formatCents(evaluation.maxBidCents)}
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">Expected profit</p>
          <p className="font-mono text-xl font-extrabold tracking-tight text-emerald-700 sm:text-2xl">
            {formatCents(evaluation.expectedProfitCents)}
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">ROI</p>
          <p className="font-mono text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
            {formatBasisPoints(evaluation.expectedRoiBasisPoints, 1)}
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">Landed cost</p>
          <p className="font-mono text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
            {formatCents(evaluation.landedCostCents)}
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-1">
        {evaluation.reasons.map((reason) => (
          <li key={reason} className="flex gap-2 text-xs leading-relaxed text-slate-700">
            <span aria-hidden="true" className="text-orange-500">
              •
            </span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
