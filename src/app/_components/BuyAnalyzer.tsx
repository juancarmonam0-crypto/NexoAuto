"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Search, Save, Sparkles, RefreshCw } from "lucide-react";
import {
  analyzeMarketAction,
  createSourcingCandidateAction,
  decodeVinAction,
  evaluateOpportunityAction,
} from "@/app/actions/buy";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { formatBasisPoints, formatCents, parseMoneyToCents } from "@/lib/money";
import type {
  MarketAnalysisContract,
  MarketComparableContract,
  OpportunityEvaluationContract,
  VinDecodeContract,
} from "@/lib/boundary/contracts";

/**
 * The BUY workbench: capture an opportunity, score it, save it.
 *
 * FOUR BUTTONS, ONE FORM
 *   Decode VIN          → existing `decodeVinAction` (NHTSA vPIC) fills the identity fields
 *   ANALYZE             → `analyzeMarketAction`: market evidence + conservative retail
 *                         policy + the canonical verdict, in ONE round trip
 *   Analyze without
 *   market data         → existing `evaluateOpportunityAction` (the pre-market path)
 *   Save                → existing `createSourcingCandidateAction`
 *
 * NO ARITHMETIC LIVES HERE. Every figure shown — the market estimate, the
 * comparable range, the verdict, the ceiling, the profit, the ROI, the landed
 * cost and the written reasons — is the server's output. This component only
 * lays it out, using `formatCents` / `formatBasisPoints` to render what it was
 * handed. It never derives, discounts, averages or annualises anything.
 *
 * WHAT THE OPERATOR MUST BE ABLE TO TELL APART AT A GLANCE
 *   - a MARKET value from the operator's own MANUAL number, or from no value at all;
 *   - evidence retrieved LIVE from evidence served out of the cache;
 *   - a normal provider failure (a notice, not an error page) from a real fault.
 * The server's own wording is quoted verbatim rather than paraphrased, because
 * the policy that produced the number is the server's, not this component's.
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
const chipClass = "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider";

/**
 * The three state chips, decided ONLY by what the server returned.
 *
 * The chip may never be more optimistic than the data: a missing retail figure
 * is "NO MARKET VALUE" — never a silent blank, and never a zero.
 */
function retailChip(retail: MarketAnalysisContract["retail"]): { label: string; className: string } {
  if (retail.retailCents === null) {
    return { label: "NO MARKET VALUE", className: "border-slate-300 bg-slate-100 text-slate-600" };
  }
  if (retail.source === "market-prediction" || retail.source === "market-comparables") {
    return { label: "MARKET VALUE", className: "border-orange-300 bg-orange-50 text-orange-800" };
  }
  if (retail.source === "manual") {
    return { label: "MANUAL VALUE", className: "border-slate-400 bg-slate-900 text-white" };
  }
  // Any source this component does not know about is printed as-is rather than
  // translated into a claim the server did not make.
  return {
    label: retail.source === "" ? "NO MARKET VALUE" : retail.source.replace(/-/g, " ").toUpperCase(),
    className: "border-slate-300 bg-slate-100 text-slate-600",
  };
}

/** "—" instead of an invented figure, everywhere. */
function text(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  const trimmed = value.trim();
  return trimmed === "" ? "—" : trimmed;
}

/** Mileage for display. Formatting only; no money and no derived figure. */
function formatMiles(miles: string): string {
  const parsed = Number.parseInt(miles, 10);
  return Number.isFinite(parsed) ? `${parsed.toLocaleString("en-US")} mi` : "—";
}

/**
 * A whole-dollar input the operator typed, rendered for display.
 *
 * The dollars→cents conversion goes through the CANONICAL parser
 * (`parseMoneyToCents`) rather than any local multiplication, so this component
 * still contains no money arithmetic of its own. A blank or unparseable field
 * is "—", never $0.
 */
function formatDollarInput(raw: FormDataEntryValue | null): string {
  if (typeof raw !== "string") return "—";
  const cents = parseMoneyToCents(raw);
  return cents === null ? "—" : formatCents(cents);
}

/** A listing link is only rendered when the provider gave us an http(s) URL. */
function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/** Fixed locale + UTC: identical on the server render and after hydration. */
function formatRetrievedAt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(at)} UTC`;
}

export function BuyAnalyzer({ canWrite, sources }: BuyAnalyzerProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [evaluation, setEvaluation] = useState<OpportunityEvaluationContract | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  /**
   * The market analysis result, held EXACTLY as the server returned it. Nothing
   * here is derived, recomputed or reconciled client-side: if the contract does
   * not carry a figure, the screen shows "—".
   */
  const [marketResult, setMarketResult] = useState<MarketAnalysisContract | null>(null);
  /** Echoed from the form so the DEAL block can show what the operator typed. */
  const [reconDisplay, setReconDisplay] = useState<string>("—");
  /** Which action is in flight, so only the button that was pressed spins. */
  const [pendingAction, setPendingAction] = useState<"decode" | "market" | "manual" | "save" | null>(null);
  /**
   * Where the verdict on screen came from. With two Analyze paths on one screen
   * the operator must never have to guess which retail assumption produced it.
   */
  const [evaluationScope, setEvaluationScope] = useState<"manual-retail" | "saved" | null>(null);
  /** The "Refresh market data" chip: appended to the same form as `refreshMarket`. */
  const [refreshMarket, setRefreshMarket] = useState(false);

  // Identity fields are controlled because the VIN decoder writes into them.
  const [identity, setIdentity] = useState({ vin: "", year: "", make: "", model: "", trim: "", mileage: "" });

  function readForm(): FormData | null {
    const form = formRef.current;
    return form ? new FormData(form) : null;
  }

  /**
   * THE PRIMARY ACTION.
   *
   * ONE call returns the market evidence, the conservative retail verdict AND
   * the canonical evaluation, so the browser can never end up showing market
   * data next to an evaluation computed from a different retail assumption.
   */
  function handleAnalyzeMarket() {
    const formData = readForm();
    if (!formData) return;
    if (refreshMarket) formData.set("refreshMarket", "on");
    setOutcome(null);
    setPendingAction("market");
    startTransition(async () => {
      const result = await analyzeMarketAction(formData);
      setPendingAction(null);
      if (result.ok) {
        setMarketResult(result.data);
        setReconDisplay(formatDollarInput(formData.get("estimatedRecon")));
        setOutcome(null);
        // The saved-form evaluation is now a different vintage than the market
        // one on screen, so clear it rather than show two verdicts at once.
        setEvaluation(null);
        setEvaluationScope(null);
      } else {
        setMarketResult(null);
        setOutcome({ ok: false, message: result.error });
      }
    });
  }

  function handleAnalyze() {
    const formData = readForm();
    if (!formData) return;
    setOutcome(null);
    setPendingAction("manual");
    startTransition(async () => {
      const result = await evaluateOpportunityAction(formData);
      setPendingAction(null);
      if (result.ok) {
        setEvaluation(result.data);
        // The market panel is deliberately KEPT: it is still what the operator
        // just paid a provider call for. This verdict is scored from the
        // operator's own expected retail, and the panel below says so.
        setEvaluationScope("manual-retail");
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
    setPendingAction("save");
    startTransition(async () => {
      const result = await createSourcingCandidateAction(formData);
      setPendingAction(null);
      if (result.ok) {
        setOutcome({ ok: true, message: "Opportunity saved to the inbox." });
        setEvaluation(result.data);
        setEvaluationScope("saved");
        router.refresh();
      } else {
        setOutcome({ ok: false, message: result.error });
      }
    });
  }

  function handleDecode() {
    const formData = readForm();
    if (!formData) return;
    setPendingAction("decode");
    startTransition(async () => {
      const result = await decodeVinAction(formData);
      setPendingAction(null);
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
            {/*
              The manual override. It is a SEPARATE field from `estimatedRetail`
              because the server reads it as `manualRetail` and lets it beat the
              market estimate while preserving the market number.
            */}
            <div className="col-span-2 space-y-1">
              <label htmlFor="buy-manualRetail" className={labelClass}>
                Manual retail override ($)
              </label>
              <input
                id="buy-manualRetail"
                name="manualRetail"
                inputMode="decimal"
                placeholder="Blank = use the market value"
                aria-describedby="buy-manualRetail-help"
                className={`${inputClass} font-mono`}
              />
              <p id="buy-manualRetail-help" className="text-[11px] text-slate-500">
                Optional. When set, this is the retail the economics use and the market value is preserved beside it.
                Leave it empty to use the market value — or to use the expected retail above when no market data exists.
              </p>
            </div>
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
            onClick={handleAnalyzeMarket}
            disabled={pending}
            title="Retrieve market evidence and score this deal from it, in one call"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold tracking-wide text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
          >
            {pendingAction === "market" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 text-orange-400" />
            )}
            <span>ANALYZE</span>
          </button>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={pending}
            title="Score this deal from the expected retail you typed, without asking the market"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            {pendingAction === "manual" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4 text-slate-400" />
            )}
            <span>Analyze without market data</span>
          </button>
          {canWrite ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60"
            >
              {pendingAction === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span>Save opportunity</span>
            </button>
          ) : null}
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          <span className="font-semibold text-slate-700">ANALYZE</span> asks the market for evidence and then runs the
          same sourcing engine on the conservative retail it derives.{" "}
          <span className="font-semibold text-slate-700">Analyze without market data</span> skips the market entirely and
          scores your own expected retail. Neither stores anything until you save.
        </p>
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

      {marketResult ? (
        <MarketAnalysisPanel
          result={marketResult}
          identity={identity}
          reconDisplay={reconDisplay}
          pendingAction={pendingAction}
          refreshMarket={refreshMarket}
          onRequestRefresh={() => setRefreshMarket(true)}
        />
      ) : null}

      {evaluation && evaluationScope !== null ? (
        <EvaluationPanel
          evaluation={evaluation}
          scopeNote={
            evaluationScope === "saved"
              ? "Scored and stored from the retail value shown above."
              : "Scored from the expected retail you typed, WITHOUT market data — the market block above was not used for this verdict."
          }
        />
      ) : marketResult ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-xs leading-relaxed text-slate-600 shadow-xs">
          <span className="font-semibold text-slate-800">No acquisition analysis yet.</span> A retail value is needed
          before the economics can run: either market evidence that produced a conservative estimate, or your own
          expected retail entered manually. Nothing is shown rather than a verdict from a missing number.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The market-informed result: the subject vehicle, then MARKET, then DEAL.
 *
 * Every figure is read straight off `MarketAnalysisContract`. When the contract
 * carries no number the row shows "—"; this component never substitutes a zero,
 * never averages the comparables and never re-derives a retail value.
 */
function MarketAnalysisPanel({
  result,
  identity,
  reconDisplay,
  pendingAction,
  refreshMarket,
  onRequestRefresh,
}: {
  result: MarketAnalysisContract;
  identity: { year: string; make: string; model: string; trim: string; mileage: string };
  reconDisplay: string;
  pendingAction: "decode" | "market" | "manual" | "save" | null;
  refreshMarket: boolean;
  onRequestRefresh: () => void;
}) {
  const { market, retail, evaluation } = result;
  const chip = retailChip(retail);
  const identityLine = [identity.year, identity.make, identity.model].map(text).join(" ");
  const comparableCount = market === null ? null : market.comparables.length;

  return (
    <section aria-live="polite" className="space-y-4">
      {/* -------- the subject vehicle -------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-orange-700">2 · Result</span>
        <span className="text-sm font-semibold text-slate-900">{identityLine}</span>
        {identity.trim.trim() !== "" ? (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700">
            {identity.trim}
          </span>
        ) : null}
        <span className="font-mono text-[11px] text-slate-600">{formatMiles(identity.mileage)}</span>
      </div>

      {/* -------- MARKET -------- */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-slate-700">Market</span>
          <span className={`${chipClass} ${chip.className}`}>{chip.label}</span>
          {retail.overridden ? (
            <span className={`${chipClass} border-amber-300 bg-amber-50 text-amber-800`}>OVERRIDDEN</span>
          ) : null}
        </div>

        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <dt className="font-mono uppercase tracking-wider text-slate-500">
              Estimated retail used by the economics
            </dt>
            <dd className="font-mono text-base font-extrabold tracking-tight text-slate-900">
              {retail.retailCents === null ? "not available" : formatCents(retail.retailCents)}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <dt className="font-mono uppercase tracking-wider text-slate-500">Comparable advertised range</dt>
            <dd className="font-mono text-slate-900">
              {retail.evidence.comparableLowAskingCents !== null && retail.evidence.comparableHighAskingCents !== null
                ? `${formatCents(retail.evidence.comparableLowAskingCents)} – ${formatCents(retail.evidence.comparableHighAskingCents)}`
                : "not available"}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <dt className="font-mono uppercase tracking-wider text-slate-500">Comparables used</dt>
            <dd className="font-mono text-slate-900">
              {retail.evidence.comparablesUsed} of {retail.evidence.comparablesTotal}
            </dd>
          </div>
          {market === null ? (
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <dt className="font-mono uppercase tracking-wider text-slate-500">Market evidence</dt>
              <dd className="text-slate-600">not retrieved</dd>
            </div>
          ) : null}
        </dl>

        {retail.overridden && retail.retailCents !== null ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900">
            <span className="font-semibold">Your manual override is what the economics used.</span> The market estimate
            your override replaced is preserved for comparison:{" "}
            <span className="font-mono font-semibold">
              {retail.marketEstimateCents === null ? "no market estimate was available" : formatCents(retail.marketEstimateCents)}
            </span>
            .
          </p>
        ) : null}

        {market === null ? null : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="font-mono uppercase tracking-wider text-slate-500">Provider</dt>
                <dd className="font-mono text-slate-900">{text(market.provider)}</dd>
              </div>
              <div>
                <dt className="font-mono uppercase tracking-wider text-slate-500">Confidence</dt>
                <dd className="font-mono text-slate-900">
                  {retail.confidence === null ? "—" : retail.confidence.toUpperCase()}
                </dd>
              </div>
              <div>
                <dt className="font-mono uppercase tracking-wider text-slate-500">Evidence</dt>
                <dd className="font-mono text-slate-900">
                  {text(comparableCount)} comparable{comparableCount === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt className="font-mono uppercase tracking-wider text-slate-500">Reported found</dt>
                <dd className="font-mono text-slate-900">{text(market.comparableCountReported)}</dd>
              </div>
            </dl>

            {/* freshness — never let cached evidence look freshly fetched */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <span
                className={`${chipClass} ${
                  market.retrievedLive
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-slate-300 bg-slate-100 text-slate-700"
                }`}
              >
                {market.retrievedLive ? "LIVE RETRIEVAL" : "CACHED (retrieved earlier)"}
              </span>
              <span className="font-mono text-[11px] text-slate-600">
                retrieved {formatRetrievedAt(market.generatedAtIso)}
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                cached for up to {text(market.cacheTtlMinutes)} minutes
              </span>
              <button
                type="button"
                onClick={onRequestRefresh}
                disabled={pendingAction !== null || refreshMarket}
                title="Ask the provider for fresh evidence instead of reusing Nexo's cached snapshot"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                {pendingAction === "market" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span>{refreshMarket ? "Refresh queued — press ANALYZE" : "Refresh market data"}</span>
              </button>
            </div>
            <p aria-live="polite" className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {market.retrievedLive
                ? "This snapshot came back from the provider on this request."
                : "This snapshot was retrieved earlier and served from Nexo's cache, so it is not fresh."}
              {refreshMarket
                ? " Refresh is set: the next ANALYZE asks for fresh evidence instead of reusing the cache."
                : ""}
            </p>
          </>
        )}
      </div>

      {/* -------- DEAL -------- */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-slate-700">Deal</span>
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <dt className="font-mono uppercase tracking-wider text-slate-500">Asking price</dt>
            <dd className="font-mono text-slate-900">{formatCents(result.echo.askingPriceCents)}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <dt className="font-mono uppercase tracking-wider text-slate-500">Estimated recon</dt>
            <dd className="font-mono text-slate-900">{reconDisplay}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <dt className="font-mono uppercase tracking-wider text-slate-500">Landed cost</dt>
            <dd className="font-mono text-slate-900">
              {evaluation === null ? "not available" : formatCents(evaluation.landedCostCents)}
            </dd>
          </div>
        </dl>
      </div>

      {/* -------- MARKET DATA UNAVAILABLE — a normal outcome, not an error page -------- */}
      {market === null ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-xs">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-amber-900">
            Market data unavailable
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-900">
            {result.marketUnavailableReason ?? "The market layer returned no reason."}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-900">
            Market failure never blocks the acquisition analysis. The manual expected-retail field above stays usable, and
            the economics still run from your own number — enter or adjust it there and press ANALYZE again. No market
            value is invented here, and no verdict is shown for a retail value that does not exist.
          </p>
        </div>
      ) : null}

      {/* -------- comparables + the policy's own written reasoning -------- */}
      <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
          Market evidence — {text(comparableCount)} comparable{comparableCount === 1 ? "" : "s"} returned
        </summary>
        <div className="mt-3 space-y-3">
          {market !== null && market.comparables.length > 0 ? (
            <ul className="space-y-2">
              {market.comparables.map((comparable, index) => (
                <ComparableRow key={comparableKey(comparable, index)} comparable={comparable} />
              ))}
            </ul>
          ) : (
            <p className="text-xs leading-relaxed text-slate-600">
              {market === null
                ? "No comparable evidence was retrieved, because the market layer could not answer for this vehicle."
                : "The provider returned no comparable listings for this vehicle in the search area, so there is nothing to compare against."}
            </p>
          )}

          <div className="space-y-2 border-t border-slate-200 pt-3">
            <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-slate-600">
              What the valuation policy says
            </p>
            <Bullets items={retail.reasons} tone="slate" />
            {retail.warnings.length > 0 ? <Bullets items={retail.warnings} tone="amber" /> : null}
          </div>

          {market !== null && market.notes.length > 0 ? (
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-slate-600">
                Provider notes
              </p>
              <Bullets items={market.notes} tone="slate" />
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}

/** Stable-enough key: a listing URL or VIN identifies a comparable. */
function comparableKey(comparable: MarketComparableContract, index: number): string {
  return `${comparable.listingUrl ?? comparable.vin ?? comparable.source}-${index}`;
}

function Bullets({ items, tone }: { items: readonly string[]; tone: "slate" | "amber" }) {
  const color = tone === "amber" ? "text-amber-500" : "text-orange-500";
  const body = tone === "amber" ? "text-amber-900" : "text-slate-600";
  return (
    <ul className="space-y-1">
      {items.map((item, index) => (
        <li key={`${index}-${item.slice(0, 24)}`} className={`flex gap-2 text-[11px] leading-relaxed ${body}`}>
          <span aria-hidden="true" className={color}>
            •
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * ONE comparable, stacked: no table, no horizontal scrolling, ≥40px rows.
 * Optional fields are omitted rather than shown as zero — a comparable with no
 * distance simply has no distance row.
 */
function ComparableRow({ comparable }: { comparable: MarketComparableContract }) {
  const title = [comparable.year, comparable.make, comparable.model].map(text).join(" ");
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-xs font-semibold text-slate-900">
          {title}
          {comparable.trim !== null ? <span className="text-slate-500"> · {comparable.trim}</span> : null}
        </p>
        <p className="font-mono text-xs font-bold text-slate-900">
          {comparable.askingPriceCents === null ? "price not available" : formatCents(comparable.askingPriceCents)}
        </p>
      </div>
      <dl className="mt-1.5 space-y-1 text-[11px] text-slate-600">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <dt className="font-mono uppercase tracking-wider text-slate-500">Mileage</dt>
          <dd className="font-mono">{comparable.mileage === null ? "—" : formatMiles(String(comparable.mileage))}</dd>
        </div>
        {comparable.distanceMiles !== null ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <dt className="font-mono uppercase tracking-wider text-slate-500">Distance</dt>
            <dd className="font-mono">{comparable.distanceMiles} mi</dd>
          </div>
        ) : null}
        {comparable.dealerName !== null || comparable.dealerType !== null ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <dt className="font-mono uppercase tracking-wider text-slate-500">Dealer</dt>
            <dd className="text-right">
              {text(comparable.dealerName)}
              {comparable.dealerType !== null ? ` · ${comparable.dealerType}` : ""}
            </dd>
          </div>
        ) : null}
        {comparable.listedDaysAgo !== null ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <dt className="font-mono uppercase tracking-wider text-slate-500">Listed</dt>
            <dd className="font-mono">{comparable.listedDaysAgo} days ago</dd>
          </div>
        ) : null}
      </dl>
      {comparable.listingUrl !== null && isHttpUrl(comparable.listingUrl) ? (
        <a
          href={comparable.listingUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-flex min-h-[40px] items-center text-[11px] font-semibold text-orange-700 underline underline-offset-2 hover:text-orange-800"
        >
          View the listing
        </a>
      ) : null}
    </li>
  );
}

/** The verdict panel — the loudest thing on the BUY screen. */
function EvaluationPanel({
  evaluation,
  scopeNote,
}: {
  evaluation: OpportunityEvaluationContract;
  /** Names the retail assumption behind this verdict. Never a claim, just provenance. */
  scopeNote: string;
}) {
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

      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">{scopeNote}</p>

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
