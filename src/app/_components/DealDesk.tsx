"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Handshake,
  Key,
  Loader2,
  Lock,
  Repeat,
  Scale,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";

import { ActionForm } from "@/app/_components/ActionForm";
import { StatusBadge } from "@/app/_components/StatusBadge";
import {
  completeVehicleSaleAction,
  evaluateDealStructuresAction,
  fitPaymentBudgetAction,
  recommendCustomerOfferAction,
  solveTargetPaymentAction,
} from "@/app/actions/sales";
import type {
  CustomerOfferContract,
  CustomerOfferOptionContract,
  DealComparisonContract,
  DealPricingContract,
  DealStructureContract,
  PaymentBudgetOptionContract,
  PaymentBudgetResultContract,
  TargetPaymentOptionContract,
  TargetPaymentResultContract,
} from "@/lib/boundary/contracts";
import { type DealPaymentMode } from "@/lib/deal-structuring";
import { centsToDecimalString, formatBasisPoints, formatCents } from "@/lib/money";

/**
 * THE DEAL DESK — four ways in, one engine underneath.
 *
 * THE PRODUCT PRINCIPLE: BACKEND SOPHISTICATED, CALCULATOR SIMPLE.
 * A normal operator needs four things — the vehicle, how it is paid, the down
 * payment and the term. Everything else is optional and lives behind the
 * "Advanced" disclosure in every path. The four paths are:
 *
 *   1 · CALCULATE DEAL        the staged workflow (vehicle → buyer → price →
 *                             payment mode → terms → comparison → finalize)
 *   2 · TARGET MONTHLY PAYMENT "land this deal near $450 a month" — the inverse
 *                             solver, searched on the server
 *   3 · FIT A PAYMENT BUDGET   "the customer has $2,000 down and can pay $375 —
 *                             what actually fits?"
 *   4 · MAKE CUSTOMER OFFER    the SELL side, face-to-face: "what is the best
 *                             deal Nexo can offer this customer?" — derived from
 *                             the same economic floor, with an ACCEPT / ADJUST /
 *                             REJECT verdict computed on the server.
 *
 * Only the selected path is mounted, so its ids are unique in the document.
 *
 * WHAT THIS COMPONENT IS NOT
 *   - It is not a calculator. Every money figure, rate, payment, gross, ROI,
 *     gap and recommendation on this screen was computed by the engine on the
 *     server and is rendered verbatim. There is no arithmetic in this file:
 *     `formatCents` / `formatBasisPoints` / `centsToDecimalString` are display
 *     and input echo only. The only `Math.*` calls here are `Math.max` /
 *     `Math.min` used to move between steps.
 *   - It is not a compliance authority. The rate-policy line, its `statement`
 *     and its `disclaimer` are the server's words, displayed unaltered. Nothing
 *     here certifies that a deal is legal.
 *   - It is not an underwriting or affordability decision. `FIT A PAYMENT
 *     BUDGET` answers one mathematical question across the modes and terms the
 *     operator allows; it never judges a customer. `MAKE CUSTOMER OFFER` reads
 *     only the numbers the customer STATES — a down payment and a maximum
 *     payment — and reports which structures fit them while preserving the
 *     dealership's configured economics. No income, debt, credit or bureau data
 *     exists anywhere in this component or the engine behind it.
 *   - It does not invent documents or contracts (see the PHASE 9B/9C GAP note on
 *     the server page that renders this workbench).
 *
 * ONE SET OF DEAL INPUTS, THREE SURFACES
 *   Every deal input is CONTROLLED by `draft` state. The staged workflow renders
 *   that state inside the outer `<form ref={formRef}>`, so the COMPARISON button
 *   can hand the whole deal to the server through `new FormData(form)`; the two
 *   calculator paths render their own `<form>` around their own fields, because
 *   a `<form>` may never be nested inside another. A path is never mounted at
 *   the same time as another, so no field NAME ever exists twice in the live DOM
 *   and `FormData` can never disagree with itself.
 *
 *   Sharing one draft is what makes "Use this structure" possible: carrying an
 *   option across paths is a state copy of the mode, the term and the down
 *   payment the SERVER computed — never a recalculation.
 */

interface DealDeskVehicle {
  id: string;
  label: string;
  askingPriceCents: number | null;
  status: string;
}

interface DealDeskLead {
  id: string;
  name: string;
}

interface DealDeskProps {
  vehicles: DealDeskVehicle[];
  leads: DealDeskLead[];
  selectedVehicleId: string | null;
  selectedLeadId: string | null;
  canWrite: boolean;
  canSeeFinance: boolean;
}

/** The seven steps, in order, exactly as the brief specifies them. */
const STEP_LABELS = ["VEHICLE", "BUYER", "PRICE", "PAYMENT MODE", "TERMS", "COMPARISON", "FINALIZE"] as const;
const LAST_STEP = STEP_LABELS.length - 1;
const PAYMENT_FREQUENCIES = ["MONTHLY", "SEMIMONTHLY", "BIWEEKLY", "WEEKLY"] as const;
const PREFERRED_CONTACT = ["PHONE", "EMAIL", "TEXT", "ANY"] as const;

/**
 * The four ways into the desk.
 *
 * Exactly four, defaulting to the first, rendered as one compact segmented
 * control that wraps on a phone: a path is a lens on the same deal, not a
 * separate application.
 */
const PATH_OPTIONS = [
  { id: "workflow", label: "CALCULATE DEAL", hint: "The staged deal workflow, start to finish." },
  {
    id: "target",
    label: "TARGET MONTHLY PAYMENT",
    hint: "Name the payment the customer is aiming for and read the term or the down payment that gets there.",
  },
  {
    id: "budget",
    label: "FIT A PAYMENT BUDGET",
    hint: "State the most the customer can pay per period and read what mathematically fits.",
  },
  {
    id: "offer",
    label: "MAKE CUSTOMER OFFER",
    hint: "The sell side, for the desk in front of a customer: the customer's down payment and top payment in, one recommended structure and the server's ACCEPT / ADJUST / REJECT verdict out.",
  },
] as const;

type DeskPath = (typeof PATH_OPTIONS)[number]["id"];

/**
 * The five payment choices.
 *
 * `financeType` is the enum `completeVehicleSaleAction` validates against; `mode`
 * is the engine's `DealPaymentMode`. Both live here so the two vocabularies can
 * never drift on screen.
 */
const MODE_OPTIONS: ReadonlyArray<{
  mode: DealPaymentMode;
  financeType: string;
  label: string;
  hint: string;
}> = [
  {
    mode: "CASH",
    financeType: "CASH",
    label: "CASH",
    hint: "Settled in full at delivery — no note, no rate, no term.",
  },
  {
    mode: "EXTERNAL_FINANCE",
    financeType: "FINANCE",
    label: "EXTERNAL FINANCE",
    hint: "A bank or credit union carries the note; the dealer is paid at closing.",
  },
  {
    mode: "BUY_HERE_PAY_HERE",
    financeType: "BUY_HERE_PAY_HERE",
    label: "BUY HERE PAY HERE",
    hint: "Nexo carries the note and collects the payments itself.",
  },
  {
    mode: "LEASE",
    financeType: "LEASE",
    label: "LEASE",
    hint: "A lease is not a loan: the customer pays for use, not for the vehicle.",
  },
  {
    mode: "LEASE_TO_OWN",
    financeType: "LEASE_TO_OWN",
    label: "LEASE TO OWN",
    hint: "A lease whose contract transfers ownership at the end.",
  },
];

/**
 * The four modes a periodic payment can be solved for.
 *
 * CASH is deliberately absent: a cash deal has no periodic payment, so there is
 * nothing for either solver to search. Both paths say so on screen.
 */
const FINANCED_MODE_OPTIONS = MODE_OPTIONS.filter((option) => option.mode !== "CASH");
const FINANCED_MODES = FINANCED_MODE_OPTIONS.map((option) => option.mode);

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500";
const labelClass = "block font-mono text-[11px] font-medium uppercase tracking-wider text-slate-600";
const cardClass = "rounded-xl border border-slate-200 bg-white p-5 shadow-xs";
const panelClass = "rounded-lg border border-slate-200 bg-slate-50 p-3";
const primaryButtonClass =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 sm:min-h-0 sm:py-1.5";
const tinyButtonClass =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-800 transition-colors hover:bg-orange-100";

function financeTypeFor(mode: DealPaymentMode): string {
  return MODE_OPTIONS.find((option) => option.mode === mode)?.financeType ?? "UNDECIDED";
}

function modeLabelFor(mode: DealPaymentMode): string {
  return MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
}

function isFinancedMode(mode: DealPaymentMode): boolean {
  return FINANCED_MODES.includes(mode);
}

/**
 * A payment-mode string the SERVER chose, recognised as one of the engine's own
 * five modes.
 *
 * This is a vocabulary check, never a conversion: the offer engine returns the
 * same `DealPaymentMode` strings the desk already uses, and a value outside that
 * closed set is refused rather than coerced into a mode the engine never chose.
 */
function isDealPaymentMode(value: string): value is DealPaymentMode {
  return MODE_OPTIONS.some((option) => option.mode === value);
}

/* -------------------------------------------------------------------------- */
/* The shared deal draft                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every deal input, as text, exactly as the server reads it by name.
 *
 * Text — not numbers — on purpose: the boundary parses money and percentages
 * through its own canonical parsers, so the browser never converts a currency
 * string into a float and never rounds anything.
 */
interface DealDraft {
  vehicleId: string;
  leadId: string;
  mode: DealPaymentMode;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  preferredContact: string;
  sellingPrice: string;
  dealerFees: string;
  salesTaxPercent: string;
  tradeInAllowance: string;
  tradeInPayoff: string;
  downPayment: string;
  aprPercent: string;
  termMonths: string;
  paymentFrequency: string;
  firstPaymentDate: string;
  residualValue: string;
  capCostReduction: string;
  moneyFactorAprPercent: string;
  purchaseOption: string;
  ratePolicyJurisdiction: string;
  saleDate: string;
  notes: string;
}

type DraftTextKey = { [K in keyof DealDraft]: DealDraft[K] extends string ? K : never }[keyof DealDraft];

function initialDraft(selectedVehicleId: string | null, selectedLeadId: string | null): DealDraft {
  const blank: Record<Exclude<DraftTextKey, "mode">, string> = {
    vehicleId: selectedVehicleId ?? "",
    leadId: selectedLeadId ?? "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    preferredContact: "ANY",
    sellingPrice: "",
    dealerFees: "",
    salesTaxPercent: "",
    tradeInAllowance: "",
    tradeInPayoff: "",
    downPayment: "",
    aprPercent: "",
    termMonths: "",
    paymentFrequency: "MONTHLY",
    firstPaymentDate: "",
    residualValue: "",
    capCostReduction: "",
    moneyFactorAprPercent: "",
    purchaseOption: "",
    ratePolicyJurisdiction: "",
    saleDate: "",
    notes: "",
  };
  return { ...blank, mode: "CASH" };
}

type DraftPatch = Partial<Omit<DealDraft, "mode">> & { mode?: DealPaymentMode };

type OnDraftChange = (patch: DraftPatch) => void;

/** The figures an option can carry into the staged workflow. */
interface CarrySeed {
  mode: DealPaymentMode;
  termMonths: number;
  downPaymentCents: number;
  /**
   * The sale price the server priced this structure at. Optional so the two
   * pre-existing calculators carry exactly what they always carried; the offer
   * path supplies it, because a recommended STRUCTURE is a price as well as a
   * term.
   */
  salePriceCents?: number;
}

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                       */
/* -------------------------------------------------------------------------- */

/** A labelled figure: the label always sits immediately next to its value. */
function Figure({
  label,
  value,
  accent = false,
  mono = true,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:text-[11px]">{label}</p>
      <p
        className={`break-words text-sm font-semibold ${accent ? "text-orange-700" : "text-slate-900"} ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function SectionSummary({ title, onEdit }: { title: string; onEdit: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">{title}</h3>
      <button type="button" onClick={onEdit} className={secondaryButtonClass}>
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Edit</span>
      </button>
    </div>
  );
}

/** A controlled text/number input, labelled, with the id the desk convention wants. */
function TextField({
  id,
  name,
  label,
  value,
  onChange,
  hint,
  placeholder,
  required = false,
  inputMode = "decimal",
  type = "text",
  className = "",
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: "decimal" | "numeric" | "tel" | "email" | "text";
  type?: string;
  className?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelClass}>
        {label} {required ? <span className="text-orange-600">*</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className={`${inputClass} font-mono ${className}`}
      />
      {hint ? <p className="text-[11px] leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** The vehicle picker, shared by every path (each path supplies its own id). */
function VehicleSelect({
  id,
  vehicles,
  value,
  onChange,
  hint,
}: {
  id: string;
  vehicles: DealDeskVehicle[];
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelClass}>
        Vehicle <span className="text-orange-600">*</span>
      </label>
      <select
        id={id}
        name="vehicleId"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        <option value="">Choose vehicle…</option>
        {vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {vehicle.label} — {formatCents(vehicle.askingPriceCents, { fallback: "no asking price" })} ·{" "}
            {vehicle.status.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      {hint ? <p className="text-[11px] leading-relaxed text-slate-500">{hint}</p> : null}
      {vehicles.length === 0 ? (
        <p className="text-[11px] text-amber-700">
          No vehicles are available to sell. Publish one in CARS first.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The price ladder, straight from the server's comparison contract.
 *
 * NOTHING IS COMPUTED HERE. The landed cost stays null for a role without
 * `finance:read`, and this panel says so instead of estimating a figure.
 */
function PriceLadder({
  comparison,
  canSeeFinance,
}: {
  comparison: DealComparisonContract | null;
  canSeeFinance: boolean;
}) {
  if (!comparison) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        {canSeeFinance
          ? "The price ladder arrives with the server comparison. Fill in the price and run step 6."
          : "The price ladder and every dealer-economics figure are shown to owners and managers only."}
      </p>
    );
  }

  const pricing = comparison.pricing;
  if (!pricing) {
    return <PricingUnavailable canSeeFinance={canSeeFinance} />;
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={labelClass}>Price ladder (from the server)</p>
        <span className="font-mono text-[11px] text-slate-500">
          binding constraint: {pricing.bindingConstraint.replace(/-/g, " ")}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-3">
        <Figure label="Asking price" value={formatCents(pricing.askingPriceCents)} />
        <Figure label="Target selling price" value={formatCents(pricing.targetSellingPriceCents)} />
        <Figure
          label="Minimum approved price"
          value={formatCents(pricing.minimumApprovedPriceCents, { fallback: "Not visible to your role" })}
        />
        <Figure
          label="Expected vehicle gross"
          value={formatCents(pricing.targetGrossCents, { fallback: "Hidden" })}
        />
        <Figure label="Expected ROI" value={formatBasisPoints(pricing.targetRoiBasisPoints, 2)} />
        <Figure label="Negotiation allowance" value={formatCents(pricing.negotiationAllowanceCents)} />
      </div>
      {pricing.reasons.length > 0 ? (
        <ul className="space-y-1 border-t border-slate-200 pt-2">
          {pricing.reasons.map((reason, index) => (
            <li key={`pricing-reason-${index}`} className="flex gap-2 text-xs leading-relaxed text-slate-600">
              <span aria-hidden="true" className="text-orange-500">
                •
              </span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {pricing.warnings.length > 0 ? (
        <ul className="space-y-1 border-t border-slate-200 pt-2">
          {pricing.warnings.map((warning, index) => (
            <li
              key={`pricing-warning-${index}`}
              className="flex gap-2 text-xs leading-relaxed text-amber-800"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A null `pricing` is a ROLE statement, not a zero: the server sends no ladder
 * when the acting role may not see the cost basis, and this panel says exactly
 * that instead of rendering an empty table.
 */
function PricingUnavailable({ canSeeFinance }: { canSeeFinance: boolean }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
      {canSeeFinance
        ? "The server did not return a price ladder for this vehicle."
        : "The cost basis is not visible to your role, so the server sends no price ladder, no minimum approved price and no expected gross. Nothing is estimated in its place."}
    </p>
  );
}

/** One short line of the server's echo, so an operator can trust the inputs read. */
function EchoLine({
  title,
  asOfIso,
  jurisdiction,
}: {
  title: string;
  asOfIso: string;
  jurisdiction: string | null;
}) {
  return (
    <p className="font-mono text-[11px] leading-relaxed text-slate-500">
      vehicle: {title} · as of {asOfIso} · jurisdiction: {jurisdiction ?? "not specified"}
    </p>
  );
}

/** The server's headline, shown as the loudest thing on the panel. */
function HeadlineBlock({
  headline,
  badge,
  badgeVariant,
  children,
}: {
  headline: string;
  badge: string;
  badgeVariant: "orange" | "neutral";
  children?: ReactNode;
}) {
  return (
    <div
      className={`space-y-3 rounded-xl border-2 p-4 ${
        badgeVariant === "orange" ? "border-orange-300 bg-orange-50" : "border-slate-300 bg-slate-50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={badge} variant={badgeVariant} size="md" />
      </div>
      <p className="text-base font-bold leading-snug tracking-tight text-slate-900 sm:text-lg">{headline}</p>
      {children}
    </div>
  );
}

function ReasonList({ items, title }: { items: readonly string[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {title ? (
        <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">{title}</p>
      ) : null}
      <ul className="space-y-1">
        {items.map((item, index) => (
          <li key={`reason-${index}`} className="flex gap-2 text-xs leading-relaxed text-slate-700">
            <span aria-hidden="true" className="text-orange-500">
              •
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WarningList({ items, title = "Warnings" }: { items: readonly string[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="font-mono text-[11px] uppercase tracking-wider text-amber-900">{title}</p>
      <ul className="space-y-1">
        {items.map((item, index) => (
          <li key={`warning-${index}`} className="flex gap-2 text-xs leading-relaxed text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
      <span>{message}</span>
    </p>
  );
}

function RiskLabels({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">Risk labels</span>
      {labels.map((riskLabel) => (
        <StatusBadge key={riskLabel} status={riskLabel} variant="warning" size="sm" />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* THE WORKBENCH                                                               */
/* -------------------------------------------------------------------------- */

export function DealDesk({
  vehicles,
  leads,
  selectedVehicleId,
  selectedLeadId,
  canWrite,
  canSeeFinance,
}: DealDeskProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  /* ---- which path is on screen (defaults to the staged deal workflow) ------ */
  const [path, setPath] = useState<DeskPath>("workflow");

  /* ---- the one shared deal draft, so a carried option survives a path change */
  const [draft, setDraft] = useState<DealDraft>(() =>
    initialDraft(selectedVehicleId, selectedLeadId),
  );
  function updateDraft(patch: DraftPatch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  /* ---- path 1: the staged workflow ---------------------------------------- */
  const [step, setStep] = useState(0);
  const [comparison, setComparison] = useState<DealComparisonContract | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  /* ---- path 2: target monthly payment ------------------------------------- */
  const [targetResult, setTargetResult] = useState<TargetPaymentResultContract | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  /* ---- path 3: fit a payment budget --------------------------------------- */
  const [budgetResult, setBudgetResult] = useState<PaymentBudgetResultContract | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  /* ---- path 4: make a customer offer (the sell side) ---------------------- */
  const [offerResult, setOfferResult] = useState<CustomerOfferContract | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);

  const vehicleLocked = selectedVehicleId !== null;
  const hasVehicle = draft.vehicleId !== "";
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === draft.vehicleId) ?? null;

  /** The one read of the whole deal — every visible input, by name. */
  function readDeal(): FormData | null {
    const form = formRef.current;
    return form ? new FormData(form) : null;
  }

  function handleEvaluate() {
    const formData = readDeal();
    if (!formData) return;
    setCompareError(null);
    startTransition(async () => {
      const result = await evaluateDealStructuresAction(formData);
      if (result.ok) {
        setComparison(result.data ?? null);
        if (!result.data) setCompareError("The server returned no comparison.");
      } else {
        setComparison(null);
        setCompareError(result.error);
      }
    });
  }

  /** PATH 2 — the target-payment solve, run entirely on the server. */
  function handleSolveTarget(formData: FormData) {
    setTargetError(null);
    startTransition(async () => {
      const result = await solveTargetPaymentAction(formData);
      if (result.ok && result.data) {
        setTargetResult(result.data);
      } else {
        setTargetResult(null);
        setTargetError(
          result.ok ? "The server returned no result for this target payment." : result.error,
        );
      }
    });
  }

  /** PATH 3 — the payment-budget fit, run entirely on the server. */
  function handleFitBudget(formData: FormData) {
    setBudgetError(null);
    startTransition(async () => {
      const result = await fitPaymentBudgetAction(formData);
      if (result.ok && result.data) {
        setBudgetResult(result.data);
      } else {
        setBudgetResult(null);
        setBudgetError(result.ok ? "The server returned no result for this budget." : result.error);
      }
    });
  }

  /**
   * PATH 4 — the customer offer, ONE call, run entirely on the server.
   *
   * The form is read once into a `FormData` and handed over whole: the engine
   * derives the economic floor, prices every allowed term against the customer's
   * stated budget and returns the verdict itself. Nothing is computed here and
   * nothing is stored anywhere.
   */
  function handleMakeOffer(formData: FormData) {
    setOfferError(null);
    startTransition(async () => {
      const result = await recommendCustomerOfferAction(formData);
      if (result.ok && result.data) {
        setOfferResult(result.data);
      } else {
        setOfferResult(null);
        setOfferError(result.ok ? "The server returned no offer for these numbers." : result.error);
      }
    });
  }

  /**
   * APPLY TO DEAL — copy the RECOMMENDED structure the server chose into the
   * staged workflow's own inputs.
   *
   * A state copy of the server's own figures, never a recomputation: the mode it
   * recommended, its term, its down payment and the sale price it priced at. The
   * desk then switches to CALCULATE DEAL so the operator can carry on through the
   * existing staged workflow. Nothing is saved, contracted or sent anywhere.
   */
  function applyRecommendedOffer(result: CustomerOfferContract) {
    const recommended = result.recommended;
    if (!recommended) return;
    carryOption({
      mode: isDealPaymentMode(result.mode) ? result.mode : draft.mode,
      termMonths: recommended.termMonths,
      downPaymentCents: result.downPaymentCents,
      salePriceCents: recommended.salePriceCents,
    });
  }

  /**
   * Carry a server-computed option into the staged workflow.
   *
   * CLIENT STATE ONLY, and no arithmetic: the down payment and the sale price the
   * engine reached are echoed straight back into the inputs as plain decimal
   * strings. The desk lands on TERMS, which is the step immediately after the
   * PAYMENT MODE the carry has just filled in, so the operator continues forward
   * through the existing staged workflow.
   */
  function carryOption(seed: CarrySeed) {
    updateDraft({
      mode: seed.mode,
      termMonths: String(seed.termMonths),
      downPayment: centsToDecimalString(seed.downPaymentCents),
      ...(seed.salePriceCents === undefined
        ? {}
        : { sellingPrice: centsToDecimalString(seed.salePriceCents) }),
    });
    setStep(4);
    setPath("workflow");
  }

  return (
    <div className="space-y-4">
      {/* PATH SELECTOR — a compact segmented control: four stacked rows with 40px
          targets on a phone, one wrapping row from the sm breakpoint up. */}
      <nav aria-label="Calculator path" className={cardClass}>
        <p className={labelClass}>What are you solving for?</p>
        <div
          role="group"
          aria-label="Calculator path"
          className="mt-2 inline-flex w-full flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:w-auto sm:flex-row sm:flex-wrap"
        >
          {PATH_OPTIONS.map((option) => {
            const isCurrent = option.id === path;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isCurrent}
                onClick={() => setPath(option.id)}
                className={`inline-flex min-h-[40px] flex-1 items-center justify-center rounded-md px-3 py-1.5 text-center font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors sm:flex-none ${
                  isCurrent
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          {PATH_OPTIONS.find((option) => option.id === path)?.hint}
        </p>
      </nav>

      {path === "workflow" ? (
        <WorkflowPath
          formRef={formRef}
          vehicles={vehicles}
          leads={leads}
          canWrite={canWrite}
          canSeeFinance={canSeeFinance}
          vehicleLocked={vehicleLocked}
          hasVehicle={hasVehicle}
          step={step}
          setStep={setStep}
          draft={draft}
          updateDraft={updateDraft}
          selectedVehicle={selectedVehicle}
          comparison={comparison}
          compareError={compareError}
          pending={pending}
          onEvaluate={handleEvaluate}
        />
      ) : null}

      {path === "target" ? (
        <TargetPaymentPath
          vehicles={vehicles}
          draft={draft}
          updateDraft={updateDraft}
          result={targetResult}
          error={targetError}
          pending={pending}
          canSeeFinance={canSeeFinance}
          onCalculate={handleSolveTarget}
          onCarry={carryOption}
        />
      ) : null}

      {path === "budget" ? (
        <BudgetPath
          vehicles={vehicles}
          draft={draft}
          updateDraft={updateDraft}
          result={budgetResult}
          error={budgetError}
          pending={pending}
          canSeeFinance={canSeeFinance}
          onCalculate={handleFitBudget}
          onCarry={carryOption}
        />
      ) : null}

      {path === "offer" ? (
        <OfferPath
          vehicles={vehicles}
          draft={draft}
          updateDraft={updateDraft}
          result={offerResult}
          error={offerError}
          pending={pending}
          canSeeFinance={canSeeFinance}
          onCalculate={handleMakeOffer}
          onApply={applyRecommendedOffer}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PATH 1 · THE STAGED DEAL WORKFLOW                                           */
/* -------------------------------------------------------------------------- */

function WorkflowPath({
  formRef,
  vehicles,
  leads,
  canWrite,
  canSeeFinance,
  vehicleLocked,
  hasVehicle,
  step,
  setStep,
  draft,
  updateDraft,
  selectedVehicle,
  comparison,
  compareError,
  pending,
  onEvaluate,
}: {
  formRef: React.RefObject<HTMLFormElement | null>;
  vehicles: DealDeskVehicle[];
  leads: DealDeskLead[];
  canWrite: boolean;
  canSeeFinance: boolean;
  vehicleLocked: boolean;
  hasVehicle: boolean;
  step: number;
  setStep: (step: number) => void;
  draft: DealDraft;
  updateDraft: OnDraftChange;
  selectedVehicle: DealDeskVehicle | null;
  comparison: DealComparisonContract | null;
  compareError: string | null;
  pending: boolean;
  onEvaluate: () => void;
}) {
  const isFinalize = step === LAST_STEP;

  return (
    <form ref={formRef} className="space-y-4" onSubmit={(event) => event.preventDefault()}>
      {/* STEP INDICATOR — wraps on a phone; earlier steps stay one tap away. */}
      <nav aria-label="Deal desk steps" className={cardClass}>
        <div className="flex flex-wrap gap-1.5">
          {STEP_LABELS.map((label, index) => {
            const isCurrent = index === step;
            const locked = index > 0 && !hasVehicle;
            return (
              <button
                key={label}
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                disabled={locked}
                onClick={() => setStep(index)}
                className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                  isCurrent
                    ? "border-slate-900 bg-slate-900 text-white"
                    : locked
                      ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span aria-hidden="true">{index + 1}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Step {step + 1} of {STEP_LABELS.length} · {STEP_LABELS[step]}
          {hasVehicle ? "" : " · pick a vehicle to unlock the rest of the desk"}
        </p>
      </nav>

      {/* 1 · VEHICLE ------------------------------------------------------ */}
      <section
        hidden={isFinalize || step !== 0}
        aria-label="Step 1, vehicle"
        className={!isFinalize && step === 0 ? `${cardClass} space-y-4` : "hidden"}
      >
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">1 · Vehicle</h2>
        <VehicleField
          vehicles={vehicles}
          vehicleId={draft.vehicleId}
          locked={vehicleLocked}
          onSelect={(value) => updateDraft({ vehicleId: value })}
        />
      </section>

      {/* 2 · BUYER -------------------------------------------------------- */}
      <section
        hidden={isFinalize || step !== 1}
        aria-label="Step 2, buyer"
        className={!isFinalize && step === 1 ? `${cardClass} space-y-4` : "hidden"}
      >
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">2 · Buyer</h2>
        <BuyerFields leads={leads} draft={draft} onChange={updateDraft} />
      </section>

      {/* 3 · PRICE -------------------------------------------------------- */}
      <section
        hidden={isFinalize || step !== 2}
        aria-label="Step 3, price"
        className={!isFinalize && step === 2 ? `${cardClass} space-y-4` : "hidden"}
      >
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">3 · Price</h2>
        <PriceFields draft={draft} onChange={updateDraft} />
        <PriceLadder comparison={comparison} canSeeFinance={canSeeFinance} />
      </section>

      {/* 4 · PAYMENT MODE ------------------------------------------------- */}
      <section
        hidden={isFinalize || step !== 3}
        aria-label="Step 4, payment mode"
        className={!isFinalize && step === 3 ? `${cardClass} space-y-4` : "hidden"}
      >
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">4 · Payment mode</h2>
        <ModeChooser mode={draft.mode} onSelect={(mode) => updateDraft({ mode })} />
      </section>

      {/* 5 · TERMS -------------------------------------------------------- */}
      <section
        hidden={isFinalize || step !== 4}
        aria-label="Step 5, terms"
        className={!isFinalize && step === 4 ? `${cardClass} space-y-4` : "hidden"}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">5 · Terms</h2>
          <StatusBadge status={modeLabelFor(draft.mode)} variant="orange" size="sm" />
        </div>
        <TermsFields mode={draft.mode} draft={draft} onChange={updateDraft} />
      </section>

      {/* 6 · COMPARISON --------------------------------------------------- */}
      <section
        hidden={isFinalize || step !== 5}
        aria-label="Step 6, comparison"
        className={!isFinalize && step === 5 ? `${cardClass} space-y-4` : "hidden"}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">6 · Comparison</h2>
          <span className="font-mono text-[11px] text-slate-500">scored on the server · read-only</span>
        </div>

        <button
          type="button"
          onClick={onEvaluate}
          disabled={pending || !hasVehicle}
          className={primaryButtonClass}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-orange-400" />}
          <span>{pending ? "Scoring structures…" : "Evaluate deal structures"}</span>
        </button>
        <p className="text-[11px] text-slate-500">
          Nothing is stored. The engine returns every structure it can build from these inputs, already
          masked for your role.
        </p>

        {compareError ? <ErrorNotice message={compareError} /> : null}

        {comparison ? <ComparisonPanel comparison={comparison} /> : null}
      </section>

      {/* 7 · FINALIZE ----------------------------------------------------- */}
      <section
        hidden={!isFinalize}
        aria-label="Step 7, finalize"
        className={isFinalize ? `${cardClass} space-y-5` : "hidden"}
      >
        <header className="space-y-1">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">7 · Finalize</h2>
          <p className="text-xs leading-relaxed text-slate-500">
            Confirm the deal below. Submitting records the sale, marks the vehicle SOLD and writes the
            terms the server re-validates. Nothing is invented for you: a blank required field is
            rejected.
          </p>
        </header>

        {!canWrite ? (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-start gap-2 text-xs font-semibold text-amber-900">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Completing a sale needs the deals-write capability.</span>
            </p>
            <p className="text-xs leading-relaxed text-amber-800">
              Your role can structure and compare deals, but it cannot contract one. Ask an owner or a
              manager to complete the sale. Nothing on this screen is submitted.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <Figure
            label="Vehicle"
            value={selectedVehicle ? selectedVehicle.label : draft.vehicleId === "" ? "Not chosen" : draft.vehicleId}
            mono={selectedVehicle === null}
          />
          <Figure
            label="Buyer"
            value={draft.leadId === "" ? "Walk-in" : buyerLabel(leads, draft.leadId)}
            mono={false}
          />
          <Figure label="Payment mode" value={modeLabelFor(draft.mode)} />
          <Figure label="Recorded as" value={financeTypeFor(draft.mode)} />
        </div>

        {canWrite ? (
          <ActionForm
            action={completeVehicleSaleAction}
            submitLabel="Finalize & contract sale"
            successMessage="Sale contracted and the vehicle is marked SOLD."
            buttonVariant="primary"
            buttonSize="lg"
          >
            <div className="space-y-5">
              {vehicleLocked ? (
                <input type="hidden" name="vehicleId" value={draft.vehicleId} />
              ) : (
                <div className="space-y-3">
                  <SectionSummary title="Vehicle" onEdit={() => setStep(0)} />
                  <VehicleField
                    vehicles={vehicles}
                    vehicleId={draft.vehicleId}
                    locked={false}
                    onSelect={(value) => updateDraft({ vehicleId: value })}
                  />
                </div>
              )}

              <div className="space-y-3">
                <SectionSummary title="Buyer" onEdit={() => setStep(1)} />
                <BuyerFields leads={leads} draft={draft} onChange={updateDraft} />
              </div>

              <div className="space-y-3">
                <SectionSummary title="Price" onEdit={() => setStep(2)} />
                <PriceFields draft={draft} onChange={updateDraft} />
              </div>

              <div className="space-y-3">
                <SectionSummary title="Terms" onEdit={() => setStep(4)} />
                <TermsFields mode={draft.mode} draft={draft} onChange={updateDraft} />
              </div>
            </div>
          </ActionForm>
        ) : (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <PriceFields draft={draft} onChange={updateDraft} />
            <TermsFields mode={draft.mode} draft={draft} onChange={updateDraft} />
            <p className="text-[11px] text-slate-500">
              These inputs are shown so you can read the deal back before handing it to someone who can
              contract it.
            </p>
          </div>
        )}
      </section>

      {/* STEP CONTROLS — 44px targets, stacking below the content on a phone. */}
      <nav aria-label="Step navigation" className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          className={secondaryButtonClass}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back</span>
        </button>
        <button
          type="button"
          onClick={() => setStep(Math.min(LAST_STEP, step + 1))}
          disabled={step === LAST_STEP || !hasVehicle}
          className={secondaryButtonClass}
        >
          <span>Next: {STEP_LABELS[Math.min(LAST_STEP, step + 1)]}</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        {!hasVehicle ? (
          <span className="text-[11px] text-amber-700">Choose a vehicle to continue.</span>
        ) : null}
      </nav>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* STEP 1 — vehicle                                                            */
/* -------------------------------------------------------------------------- */

function VehicleField({
  vehicles,
  vehicleId,
  locked,
  onSelect,
}: {
  vehicles: DealDeskVehicle[];
  vehicleId: string;
  locked: boolean;
  onSelect: (value: string) => void;
}) {
  if (locked) {
    return (
      <div className="space-y-1">
        <p className={labelClass}>Vehicle on the desk</p>
        <p className="text-sm font-semibold text-slate-900">
          {vehicles.find((vehicle) => vehicle.id === vehicleId)?.label ?? vehicleId}
        </p>
        <input type="hidden" name="vehicleId" value={vehicleId} readOnly />
        <p className="font-mono text-[11px] text-slate-500">Selected from the page — fixed for this desk.</p>
      </div>
    );
  }

  return <VehicleSelect id="desk-vehicleId" vehicles={vehicles} value={vehicleId} onChange={onSelect} />;
}

/* -------------------------------------------------------------------------- */
/* STEP 2 — buyer                                                              */
/* -------------------------------------------------------------------------- */

function BuyerFields({
  leads,
  draft,
  onChange,
}: {
  leads: DealDeskLead[];
  draft: DealDraft;
  onChange: OnDraftChange;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="desk-leadId" className={labelClass}>
          Open lead
        </label>
        <select
          id="desk-leadId"
          name="leadId"
          value={draft.leadId}
          onChange={(event) => onChange({ leadId: event.target.value })}
          className={inputClass}
        >
          <option value="">No lead — walk-in</option>
          {leads.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.name}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-slate-500">
          Linking a lead keeps the inquiry and the sale on one record. Leave it blank and the walk-in
          details below create the customer.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="desk-firstName" className={labelClass}>
            First name {draft.leadId === "" ? <span className="text-orange-600">*</span> : null}
          </label>
          <input
            id="desk-firstName"
            name="firstName"
            autoComplete="given-name"
            value={draft.firstName}
            onChange={(event) => onChange({ firstName: event.target.value })}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="desk-lastName" className={labelClass}>
            Last name
          </label>
          <input
            id="desk-lastName"
            name="lastName"
            autoComplete="family-name"
            value={draft.lastName}
            onChange={(event) => onChange({ lastName: event.target.value })}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="desk-phone" className={labelClass}>
            Phone
          </label>
          <input
            id="desk-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={draft.phone}
            onChange={(event) => onChange({ phone: event.target.value })}
            className={`${inputClass} font-mono`}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="desk-email" className={labelClass}>
            Email
          </label>
          <input
            id="desk-email"
            name="email"
            type="email"
            autoComplete="email"
            value={draft.email}
            onChange={(event) => onChange({ email: event.target.value })}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="desk-preferredContact" className={labelClass}>
            Preferred contact
          </label>
          <select
            id="desk-preferredContact"
            name="preferredContact"
            value={draft.preferredContact}
            onChange={(event) => onChange({ preferredContact: event.target.value })}
            className={inputClass}
          >
            {PREFERRED_CONTACT.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        Walk-in details are only needed when no lead is linked. The database requires at least one contact
        method on the customer record.
      </p>
    </div>
  );
}

function buyerLabel(leads: DealDeskLead[], leadId: string): string {
  return leads.find((lead) => lead.id === leadId)?.name ?? leadId;
}

/* -------------------------------------------------------------------------- */
/* STEP 3 — price                                                              */
/* -------------------------------------------------------------------------- */

function PriceFields({ draft, onChange }: { draft?: DealDraft; onChange?: OnDraftChange }) {
  const bind = (key: DraftTextKey) =>
    draft && onChange
      ? { value: draft[key], onChange: (next: string) => onChange({ [key]: next } as DraftPatch) }
      : {};

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <TextField
        id="desk-sellingPrice"
        name="sellingPrice"
        label="Selling price ($)"
        required
        placeholder="0.00"
        {...bind("sellingPrice")}
      />
      <TextField
        id="desk-dealerFees"
        name="dealerFees"
        label="Dealer fees ($)"
        placeholder="0.00"
        {...bind("dealerFees")}
      />
      <TextField
        id="desk-salesTaxPercent"
        name="salesTaxPercent"
        label="Sales tax (%)"
        placeholder="6.25"
        {...bind("salesTaxPercent")}
      />
      <TextField
        id="desk-tradeInAllowance"
        name="tradeInAllowance"
        label="Trade-in allowance ($)"
        placeholder="0.00"
        {...bind("tradeInAllowance")}
      />
      <TextField
        id="desk-tradeInPayoff"
        name="tradeInPayoff"
        label="Trade-in payoff ($)"
        placeholder="0.00"
        hint="The lien payoff the dealer sends to the lender."
        {...bind("tradeInPayoff")}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* STEP 4 — payment mode                                                       */
/* -------------------------------------------------------------------------- */

function ModeChooser({
  mode,
  onSelect,
}: {
  mode: DealPaymentMode;
  onSelect: (mode: DealPaymentMode) => void;
}) {
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className={labelClass}>How is this deal paid?</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODE_OPTIONS.map((option) => {
            const checked = option.mode === mode;
            return (
              <label
                key={option.mode}
                htmlFor={`desk-mode-${option.mode}`}
                className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                  checked ? "border-orange-500 bg-orange-50" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  id={`desk-mode-${option.mode}`}
                  type="radio"
                  name="desk-payment-mode"
                  value={option.mode}
                  checked={checked}
                  onChange={() => onSelect(option.mode)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-orange-600"
                />
                <span className="min-w-0 space-y-0.5">
                  <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-slate-900">
                    {option.label}
                  </span>
                  <span className="block text-[11px] leading-relaxed text-slate-600">{option.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <p className="font-mono text-[11px] text-slate-500">
        Recorded as financeType = {financeTypeFor(mode)}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* STEP 5 — terms, contextual to the payment mode                              */
/* -------------------------------------------------------------------------- */

function TermsFields({
  mode,
  draft,
  onChange,
}: {
  mode: DealPaymentMode;
  draft?: DealDraft;
  onChange?: OnDraftChange;
}) {
  const isCash = mode === "CASH";
  const isLease = mode === "LEASE" || mode === "LEASE_TO_OWN";
  const showLender = mode === "EXTERNAL_FINANCE";

  const bind = (key: DraftTextKey) =>
    draft && onChange
      ? { value: draft[key], onChange: (next: string) => onChange({ [key]: next } as DraftPatch) }
      : {};

  return (
    <div className="space-y-4">
      {/* The enum the backend reads, whichever radio is showing. */}
      <input type="hidden" name="financeType" value={financeTypeFor(mode)} readOnly />

      {isCash ? (
        <p className={panelClass}>
          <Wallet className="mr-1 inline h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs leading-relaxed text-slate-600">
            Cash deal: no APR, no term and no lender are recorded. The balance is settled in full at
            delivery.
          </span>
        </p>
      ) : null}

      {showLender ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField id="desk-lenderName" name="lenderName" label="Lender name" inputMode="text" />
        </div>
      ) : null}

      {isLease ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          A lease is not a loan. The customer pays for the use of the vehicle over the term; the residual
          value is what the vehicle is expected to be worth at the end.
        </p>
      ) : null}

      {!isCash ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            id="desk-downPayment"
            name="downPayment"
            label="Down payment ($)"
            placeholder="0.00"
            {...bind("downPayment")}
          />
          <TextField
            id="desk-aprPercent"
            name="aprPercent"
            label="APR (%)"
            placeholder="8.99"
            {...bind("aprPercent")}
          />
          <TextField
            id="desk-termMonths"
            name="termMonths"
            label={isLease ? "Lease term (months)" : "Term (months)"}
            inputMode="numeric"
            placeholder={isLease ? "36" : "60"}
            {...bind("termMonths")}
          />
          <div className="space-y-1">
            <label htmlFor="desk-paymentFrequency" className={labelClass}>
              Payment frequency
            </label>
            <select
              id="desk-paymentFrequency"
              name="paymentFrequency"
              value={draft?.paymentFrequency ?? "MONTHLY"}
              onChange={
                draft && onChange
                  ? (event) => onChange({ paymentFrequency: event.target.value })
                  : undefined
              }
              className={inputClass}
            >
              {PAYMENT_FREQUENCIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <TextField
            id="desk-firstPaymentDate"
            name="firstPaymentDate"
            label="First payment date"
            type="date"
            inputMode="text"
            {...bind("firstPaymentDate")}
          />
        </div>
      ) : null}

      {isLease ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            id="desk-residualValue"
            name="residualValue"
            label="Residual value ($)"
            required
            placeholder="0.00"
            hint="A lease cannot be written without one."
            {...bind("residualValue")}
          />
          <TextField
            id="desk-capCostReduction"
            name="capCostReduction"
            label="Cap cost reduction ($)"
            placeholder="0.00"
            {...bind("capCostReduction")}
          />
          <TextField
            id="desk-moneyFactorAprPercent"
            name="moneyFactorAprPercent"
            label="Money factor as APR (%)"
            placeholder="4.50"
            {...bind("moneyFactorAprPercent")}
          />
          <TextField
            id="desk-purchaseOption"
            name="purchaseOption"
            label="Purchase option ($)"
            placeholder="0.00"
            {...bind("purchaseOption")}
          />
        </div>
      ) : null}

      {!isCash ? (
        <p className="text-[11px] text-slate-500">
          Leave APR, term or payment blank and the server records the sale without inventing a rate or a
          payment.
        </p>
      ) : null}

      <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
          Advanced · rate-policy jurisdiction, sale date &amp; notes
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            id="desk-ratePolicyJurisdiction"
            name="ratePolicyJurisdiction"
            label="Jurisdiction code (2–8 characters)"
            placeholder="TX"
            inputMode="text"
            className="uppercase"
            hint="The software never assumes which jurisdiction governs a deal. Leave it blank to use the dealership default."
            {...bind("ratePolicyJurisdiction")}
          />
          <TextField
            id="desk-saleDate"
            name="saleDate"
            label="Sale date"
            type="date"
            inputMode="text"
            hint="Leave blank to use today."
            {...bind("saleDate")}
          />
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="desk-notes" className={labelClass}>
              Notes
            </label>
            <textarea
              id="desk-notes"
              name="notes"
              rows={2}
              value={draft?.notes}
              onChange={draft && onChange ? (event) => onChange({ notes: event.target.value }) : undefined}
              className={inputClass}
            />
          </div>
        </div>
      </details>

      <p className="text-[11px] text-slate-500">
        Sales tax, trade-in allowance and trade-in payoff are entered once on step 3 and travel with the
        whole deal.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* STEP 6 — the server's comparison                                            */
/* -------------------------------------------------------------------------- */

function ComparisonPanel({ comparison }: { comparison: DealComparisonContract }) {
  return (
    <div className="space-y-4" aria-live="polite">
      {/* The recommendation is the server's sentence, shown verbatim. */}
      <div
        className={`space-y-2 rounded-xl border-2 p-4 ${
          comparison.recommendedMode ? "border-orange-300 bg-orange-50" : "border-slate-300 bg-slate-50"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={comparison.recommendedMode ? "RECOMMENDED" : "NO RECOMMENDATION"}
            variant={comparison.recommendedMode ? "orange" : "neutral"}
            size="md"
          />
          <p className="text-sm font-bold tracking-tight text-slate-900">{comparison.headline}</p>
        </div>
        {comparison.reasons.length > 0 ? (
          <ul className="space-y-1">
            {comparison.reasons.map((reason, index) => (
              <li
                key={`headline-reason-${index}`}
                className="flex gap-2 text-xs leading-relaxed text-slate-700"
              >
                <span aria-hidden="true" className="text-orange-500">
                  •
                </span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <EchoLine
          title={comparison.echo.vehicleTitle}
          asOfIso={comparison.echo.asOfIso}
          jurisdiction={comparison.echo.jurisdiction}
        />
      </div>

      {comparison.structures.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          The server returned no structure it could build from these inputs. Adjust the price or the terms
          and evaluate again.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {comparison.structures.map((structure) => (
            <StructureCard
              key={structure.mode}
              structure={structure}
              recommended={structure.mode === comparison.recommendedMode}
            />
          ))}
        </div>
      )}

      {comparison.unavailable.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <h3 className="text-sm font-bold tracking-tight text-slate-900">Not available in this state</h3>
          <ul className="space-y-1">
            {comparison.unavailable.map((entry) => (
              <li key={`unavailable-${entry.mode}`} className="text-xs leading-relaxed text-slate-600">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                  {entry.mode.replace(/_/g, " ")}
                </span>
                {" — "}
                {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StructureCard({
  structure,
  recommended,
}: {
  structure: DealStructureContract;
  recommended: boolean;
}) {
  const ratePolicy = structure.ratePolicy;
  const policyBadge =
    ratePolicy.withinConfiguredRatePolicy === true
      ? { status: "WITHIN CONFIGURED POLICY", variant: "success" as const }
      : ratePolicy.withinConfiguredRatePolicy === false
        ? { status: "OUTSIDE CONFIGURED POLICY", variant: "danger" as const }
        : { status: "NO POLICY CONFIGURED", variant: "neutral" as const };

  return (
    <article
      className={`flex flex-col gap-4 rounded-xl border p-4 ${
        recommended ? "border-orange-400 bg-orange-50/40" : "border-slate-200 bg-white shadow-xs"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold tracking-tight text-slate-900">
          {modeIcon(structure.mode)}
          <span>{structure.label}</span>
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {recommended ? <StatusBadge status="RECOMMENDED" variant="orange" size="sm" /> : null}
          <StatusBadge
            status={structure.feasible ? "FEASIBLE" : "NOT FEASIBLE"}
            variant={structure.feasible ? "success" : "warning"}
            size="sm"
          />
        </div>
      </header>

      {!structure.feasible ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          {structure.unavailableReason ?? "The engine could not build this structure from these inputs."}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200/70 pt-3 lg:grid-cols-3">
            <Figure
              label="Cash received at closing"
              value={formatCents(structure.dealerCashReceivedAtClosingCents)}
            />
            <Figure
              label="Vehicle gross"
              value={formatCents(structure.vehicleGrossCents, { fallback: "Hidden" })}
            />
            <Figure
              label="Capital still exposed"
              value={formatCents(structure.dealerCapitalStillExposedCents)}
            />
            <Figure
              label="Projected finance income"
              value={formatCents(structure.projectedFinanceIncomeCents)}
            />
            <Figure label="Term (months)" value={String(structure.termMonths)} />
            <Figure
              label="Payment"
              value={`${formatCents(structure.paymentAmountCents)} · ${structure.paymentFrequency
                .replace(/_/g, " ")
                .toLowerCase()}`}
            />
            <Figure label="Amount due" value={formatCents(structure.amountDueCents)} />
            <Figure label="Trade equity" value={formatCents(structure.tradeEquityCents)} />
            <Figure label="Amount financed" value={formatCents(structure.amountFinancedCents)} />
            <Figure label="Total customer outlay" value={formatCents(structure.totalCustomerOutlayCents)} />
          </dl>

          {structure.lease ? (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">Lease terms</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-3">
                <Figure label="Gross cap cost" value={formatCents(structure.lease.grossCapCostCents)} />
                <Figure
                  label="Cap cost reduction"
                  value={formatCents(structure.lease.capCostReductionCents)}
                />
                <Figure label="Adjusted cap cost" value={formatCents(structure.lease.adjustedCapCostCents)} />
                <Figure label="Residual value" value={formatCents(structure.lease.residualValueCents)} />
                <Figure label="Depreciation" value={formatCents(structure.lease.depreciationCents)} />
                <Figure label="Rent charge" value={formatCents(structure.lease.rentChargeCents)} />
                <Figure label="Purchase option" value={formatCents(structure.lease.purchaseOptionCents)} />
                <Figure
                  label="Ownership transfer"
                  value={structure.lease.ownershipTransfer}
                  mono={false}
                />
              </dl>
            </div>
          ) : null}

          {/* RATE POLICY — the guard rail, in the server's own words. */}
          <RatePolicyPanel structure={structure} badge={policyBadge} />

          <RiskLabels labels={structure.riskLabels} />

          {structure.reasons.length > 0 ? (
            <ul className="space-y-1 border-t border-slate-200/70 pt-3">
              {structure.reasons.map((reason, index) => (
                <li
                  key={`${structure.mode}-reason-${index}`}
                  className="flex gap-2 text-xs leading-relaxed text-slate-600"
                >
                  <span aria-hidden="true" className="text-orange-500">
                    •
                  </span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {structure.contractGeneration === "BLOCKED" ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Contract generation is blocked:{" "}
                {structure.contractBlockedReason ?? "the engine recorded no reason."}
              </span>
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

function RatePolicyPanel({
  structure,
  badge,
}: {
  structure: DealStructureContract;
  badge: { status: string; variant: "success" | "danger" | "neutral" };
}) {
  const ratePolicy = structure.ratePolicy;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">Rate policy check</p>
        <StatusBadge status={badge.status} variant={badge.variant} size="sm" />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-3">
        <Figure label="Selected APR" value={formatBasisPoints(ratePolicy.aprBasisPoints, 2)} />
        <Figure
          label="Configured maximum"
          value={formatBasisPoints(ratePolicy.policyCeilingBasisPoints, 2)}
        />
        <Figure label="Policy jurisdiction" value={ratePolicy.policyJurisdiction ?? "not specified"} />
      </dl>
      <p className="text-xs leading-relaxed text-slate-700">{ratePolicy.statement}</p>
      <p className="text-[11px] leading-relaxed text-slate-500">{ratePolicy.disclaimer}</p>
    </div>
  );
}

function modeIcon(mode: string): ReactNode {
  const className = "h-4 w-4 shrink-0 text-orange-600";
  switch (mode) {
    case "CASH":
      return <Banknote className={className} />;
    case "EXTERNAL_FINANCE":
      return <Handshake className={className} />;
    case "BUY_HERE_PAY_HERE":
      return <Repeat className={className} />;
    case "LEASE":
      return <Key className={className} />;
    case "LEASE_TO_OWN":
      return <Scale className={className} />;
    default:
      return <Banknote className={className} />;
  }
}

/* ========================================================================== */
/* PATH 2 · TARGET MONTHLY PAYMENT                                             */
/* ========================================================================== */

/**
 * "Land this deal near $450 a month."
 *
 * The form is deliberately three fields: the vehicle, the payment mode and the
 * target payment (plus the cash the customer puts down). Everything the engine
 * can default — the price, the rate, the term list — is left blank on purpose,
 * because `readDealSetup` already falls back to the vehicle's asking price, the
 * dealership's configured rate and the standard term candidates.
 */
function TargetPaymentPath({
  vehicles,
  draft,
  updateDraft,
  result,
  error,
  pending,
  canSeeFinance,
  onCalculate,
  onCarry,
}: {
  vehicles: DealDeskVehicle[];
  draft: DealDraft;
  updateDraft: OnDraftChange;
  result: TargetPaymentResultContract | null;
  error: string | null;
  pending: boolean;
  canSeeFinance: boolean;
  onCalculate: (formData: FormData) => void;
  onCarry: (seed: CarrySeed) => void;
}) {
  const mode = isFinancedMode(draft.mode) ? draft.mode : "EXTERNAL_FINANCE";

  return (
    <section aria-label="Target monthly payment" className="space-y-4">
      <form
        className={`${cardClass} space-y-5`}
        onSubmit={(event) => {
          event.preventDefault();
          onCalculate(new FormData(event.currentTarget));
        }}
      >
        <header className="space-y-1">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">
            Target monthly payment
          </h2>
          <p className="text-xs leading-relaxed text-slate-500">
            Name the payment the customer is aiming for. The server searches the standard terms and
            returns the ones that land at or under that payment, plus the down payment each term would
            need instead.
          </p>
        </header>

        <VehicleSelect
          id="desk-target-vehicleId"
          vehicles={vehicles}
          value={draft.vehicleId}
          onChange={(value) => updateDraft({ vehicleId: value })}
          hint="Price, fees and tax come from the vehicle record unless you set them under Advanced."
        />

        <FinancedModeRadio
          idPrefix="desk-target"
          label="Payment mode"
          value={mode}
          onChange={(next) => updateDraft({ mode: next })}
          hint="A cash deal has no periodic payment, so CASH is not offered here — there is nothing for the solver to search."
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            id="desk-target-downPayment"
            name="downPayment"
            label="Down payment ($)"
            placeholder="0.00"
            value={draft.downPayment}
            onChange={(value) => updateDraft({ downPayment: value })}
          />
          <TextField
            id="desk-target-targetPayment"
            name="targetPayment"
            label="Target payment per month ($)"
            required
            placeholder="450.00"
          />
        </div>

        <AdvancedDealFields
          idPrefix="desk-target"
          draft={draft}
          updateDraft={updateDraft}
          summary="Advanced · rate, term, price, fees, tax and lease terms"
        />

        <button type="submit" disabled={pending || draft.vehicleId === ""} className={primaryButtonClass}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-orange-400" />}
          <span>{pending ? "Solving on the server…" : "Calculate target payment"}</span>
        </button>
        <p className="text-[11px] text-slate-500">
          Read-only: the solver computes and returns; it stores nothing and decides nothing.
        </p>
      </form>

      {error ? <ErrorNotice message={error} /> : null}

      {result ? (
        <TargetPaymentResultPanel result={result} canSeeFinance={canSeeFinance} onCarry={onCarry} />
      ) : null}
    </section>
  );
}

function TargetPaymentResultPanel({
  result,
  canSeeFinance,
  onCarry,
}: {
  result: TargetPaymentResultContract;
  canSeeFinance: boolean;
  onCarry: (seed: CarrySeed) => void;
}) {
  const fits = result.feasible.length > 0;

  return (
    <div className="space-y-4" aria-live="polite">
      <HeadlineBlock
        headline={result.headline}
        badge={fits ? "FITS" : "NO FEASIBLE TERM"}
        badgeVariant={fits ? "orange" : "neutral"}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Figure label="Mode solved" value={result.modeLabel} mono={false} />
          <Figure label="Target payment" value={formatCents(result.targetPaymentCents)} />
          <Figure label="Down payment used" value={formatCents(result.downPaymentCents)} />
          <Figure label="Rate used" value={formatBasisPoints(result.aprBasisPoints, 2)} />
          <Figure label="Frequency" value={result.paymentFrequency.replace(/_/g, " ").toLowerCase()} mono={false} />
          <Figure
            label="Shortest feasible term"
            value={result.shortestFeasibleTermMonths === null ? "none" : `${result.shortestFeasibleTermMonths} months`}
            mono={false}
          />
        </div>
        {/* The server's reasons. On a no-fit result they are shown once, in the
            explanation panel below, rather than twice. */}
        {fits ? <ReasonList items={result.reasons} /> : null}
        <EchoLine
          title={result.echo.vehicleTitle}
          asOfIso={result.echo.asOfIso}
          jurisdiction={result.echo.jurisdiction}
        />
      </HeadlineBlock>

      {!fits ? (
        <div className="space-y-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-amber-900">
            No candidate term reaches this payment
          </p>
          <ReasonList items={result.reasons} />
          <p className="text-[11px] leading-relaxed text-amber-900">
            The per-term figures are still listed below: they show the payment each term actually produces
            and the down payment each term would need to reach the target.
          </p>
        </div>
      ) : null}

      <WarningList items={result.warnings} title="Terms that could not be built" />

      {result.options.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          The server built no candidate structure at all. Check that the mode has the terms it needs — a
          lease requires a residual value — then calculate again.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {result.options.map((option) => (
            <TargetOptionCard
              key={`${option.termMonths}-${option.numberOfPayments}`}
              option={option}
              recommended={option.termMonths === result.recommendedTermMonths}
              onCarry={onCarry}
            />
          ))}
        </div>
      )}

      <PricingNote pricing={result.pricing} canSeeFinance={canSeeFinance} />
    </div>
  );
}

function TargetOptionCard({
  option,
  recommended,
  onCarry,
}: {
  option: TargetPaymentOptionContract;
  recommended: boolean;
  onCarry: (seed: CarrySeed) => void;
}) {
  return (
    <article
      className={`flex flex-col gap-4 rounded-xl border p-4 ${
        recommended ? "border-orange-400 bg-orange-50/40" : "border-slate-200 bg-white shadow-xs"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold tracking-tight text-slate-900">
          {option.termMonths} months · {option.numberOfPayments} payments
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {recommended ? <StatusBadge status="RECOMMENDED" variant="orange" size="sm" /> : null}
          <StatusBadge
            status={option.fits ? "FITS" : "DOES NOT FIT"}
            variant={option.fits ? "success" : "danger"}
            size="sm"
          />
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200/70 pt-3 lg:grid-cols-3">
        <Figure label="Payment" value={formatCents(option.paymentAmountCents)} accent />
        <Figure label="Amount financed" value={formatCents(option.amountFinancedCents)} />
        <Figure
          label="Largest financeable principal"
          value={formatCents(option.maxAmountFinancedCents)}
        />
        <Figure
          label="Down payment to hit target"
          value={formatCents(option.requiredDownPaymentCents)}
        />
        <Figure label="Finance charge" value={formatCents(option.financeChargeCents)} />
        <Figure label="Total customer outlay" value={formatCents(option.totalCustomerOutlayCents)} />
        <Figure
          label="Capital still exposed"
          value={formatCents(option.dealerCapitalStillExposedCents)}
        />
        <Figure
          label="Vehicle gross"
          value={formatCents(option.vehicleGrossCents, { fallback: "Hidden" })}
        />
        <Figure label="APR" value={formatBasisPoints(option.structure.aprBasisPoints, 2)} />
      </dl>

      {!option.fits ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-800">
          {/* The gap is the server's own subtraction, displayed, never re-derived. */}
          Above the target by <span className="font-mono font-semibold">{formatCents(option.gapCents)}</span>{" "}
          at this down payment.
        </p>
      ) : null}

      <RiskLabels labels={option.structure.riskLabels} />

      {option.structure.reasons.length > 0 ? <ReasonList items={option.structure.reasons} /> : null}

      <CarryButton
        label={`Use this structure · ${option.termMonths} months`}
        onClick={() =>
          onCarry({
            mode: option.structure.mode as DealPaymentMode,
            termMonths: option.termMonths,
            downPaymentCents: option.structure.downPaymentCents,
          })
        }
      />
    </article>
  );
}

/* ========================================================================== */
/* PATH 3 · FIT A PAYMENT BUDGET                                               */
/* ========================================================================== */

/**
 * "The customer can put $2,000 down and pay $375 a month — what fits?"
 *
 * A mathematical fit against a stated budget, not an affordability judgement:
 * the operator states the ceiling, the server answers which structures are at or
 * under it, and says plainly when none is.
 */
function BudgetPath({
  vehicles,
  draft,
  updateDraft,
  result,
  error,
  pending,
  canSeeFinance,
  onCalculate,
  onCarry,
}: {
  vehicles: DealDeskVehicle[];
  draft: DealDraft;
  updateDraft: OnDraftChange;
  result: PaymentBudgetResultContract | null;
  error: string | null;
  pending: boolean;
  canSeeFinance: boolean;
  onCalculate: (formData: FormData) => void;
  onCarry: (seed: CarrySeed) => void;
}) {
  return (
    <section aria-label="Fit a payment budget" className="space-y-4">
      <form
        className={`${cardClass} space-y-5`}
        onSubmit={(event) => {
          event.preventDefault();
          onCalculate(new FormData(event.currentTarget));
        }}
      >
        <header className="space-y-1">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Fit a payment budget</h2>
          <p className="text-xs leading-relaxed text-slate-500">
            State the down payment and the most the customer can pay per period. The server builds each
            mode and term, keeps the ones inside the budget, and ranks them with the same engine the deal
            comparison uses.
          </p>
        </header>

        <VehicleSelect
          id="desk-budget-vehicleId"
          vehicles={vehicles}
          value={draft.vehicleId}
          onChange={(value) => updateDraft({ vehicleId: value })}
          hint="Price, fees and tax come from the vehicle record unless you set them under Advanced."
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            id="desk-budget-downPayment"
            name="downPayment"
            label="Down payment ($)"
            placeholder="0.00"
            value={draft.downPayment}
            onChange={(value) => updateDraft({ downPayment: value })}
          />
          <TextField
            id="desk-budget-maxPayment"
            name="maxPayment"
            label="Most the customer can pay per period ($)"
            required
            placeholder="375.00"
          />
        </div>

        <fieldset className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <legend className={labelClass}>Payment modes to consider</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FINANCED_MODE_OPTIONS.map((option) => (
              <label
                key={option.mode}
                htmlFor={`desk-budget-mode-${option.mode}`}
                className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border border-slate-300 bg-white p-3 transition-colors hover:bg-slate-50"
              >
                <input
                  id={`desk-budget-mode-${option.mode}`}
                  type="checkbox"
                  name="modes"
                  value={option.mode}
                  defaultChecked
                  className="mt-0.5 h-4 w-4 shrink-0 accent-orange-600"
                />
                <span className="min-w-0 space-y-0.5">
                  <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-slate-900">
                    {option.label}
                  </span>
                  <span className="block text-[11px] leading-relaxed text-slate-600">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Tick none and the server considers all four financed modes. CASH is not listed: a cash deal has
            no periodic payment to fit a budget against.
          </p>
        </fieldset>

        <AdvancedDealFields
          idPrefix="desk-budget"
          draft={draft}
          updateDraft={updateDraft}
          summary="Advanced · rate, term, price, fees, tax and lease terms"
        />

        <button type="submit" disabled={pending || draft.vehicleId === ""} className={primaryButtonClass}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-orange-400" />}
          <span>{pending ? "Building and ranking structures…" : "Calculate what fits"}</span>
        </button>
        <p className="text-[11px] text-slate-500">
          Read-only: this is a mathematical fit against the stated budget. It stores nothing, and it is not
          an approval, a credit decision or an affordability judgement.
        </p>
      </form>

      {error ? <ErrorNotice message={error} /> : null}

      {result ? (
        <BudgetResultPanel result={result} canSeeFinance={canSeeFinance} onCarry={onCarry} />
      ) : null}
    </section>
  );
}

function BudgetResultPanel({
  result,
  canSeeFinance,
  onCarry,
}: {
  result: PaymentBudgetResultContract;
  canSeeFinance: boolean;
  onCarry: (seed: CarrySeed) => void;
}) {
  const recommended = result.recommended;
  const hasOptions = result.options.length > 0;

  return (
    <div className="space-y-4" aria-live="polite">
      <HeadlineBlock
        headline={result.headline}
        badge={recommended ? "RECOMMENDED" : "NO FEASIBLE STRUCTURE"}
        badgeVariant={recommended ? "orange" : "neutral"}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Figure label="Budget per period" value={formatCents(result.maxPaymentCents)} />
          <Figure label="Down payment" value={formatCents(result.downPaymentCents)} />
          <Figure label="Frequency" value={result.paymentFrequency.replace(/_/g, " ").toLowerCase()} mono={false} />
          <Figure label="Options inside budget" value={String(result.options.length)} />
          <Figure label="Structures built" value={String(result.optionCountBuilt)} />
          <Figure
            label="Shortest feasible term"
            value={
              result.shortestFeasibleTermMonths === null
                ? "none"
                : `${result.shortestFeasibleTermMonths} months`
            }
            mono={false}
          />
        </div>
        <EchoLine
          title={result.echo.vehicleTitle}
          asOfIso={result.echo.asOfIso}
          jurisdiction={result.echo.jurisdiction}
        />
      </HeadlineBlock>

      {/* THE RECOMMENDED PANEL — the server's own choice, with its reasons. */}
      {recommended ? (
        <div className="space-y-3 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status="RECOMMENDED" variant="orange" size="md" />
            <p className="text-sm font-bold tracking-tight text-slate-900">
              {recommended.modeLabel} · {recommended.termMonths} months ·{" "}
              {formatCents(recommended.paymentAmountCents)} per{" "}
              {result.paymentFrequency.replace(/_/g, " ").toLowerCase()}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Figure label="Payment" value={formatCents(recommended.paymentAmountCents)} accent />
            <Figure label="Amount financed" value={formatCents(recommended.amountFinancedCents)} />
            <Figure label="Amount due" value={formatCents(recommended.amountDueCents)} />
            <Figure
              label="Total customer outlay"
              value={formatCents(recommended.totalCustomerOutlayCents)}
            />
            <Figure
              label="Capital still exposed"
              value={formatCents(recommended.dealerCapitalStillExposedCents)}
            />
            <Figure
              label="Vehicle gross"
              value={formatCents(recommended.vehicleGrossCents, { fallback: "Hidden" })}
            />
          </dl>
          <ReasonList items={result.reasons} title="Why the server ranked it first" />
          <RiskLabels labels={recommended.structure.riskLabels} />
          <CarryButton
            label={`Use this structure · ${recommended.modeLabel} · ${recommended.termMonths} months`}
            onClick={() =>
              onCarry({
                mode: recommended.structure.mode as DealPaymentMode,
                termMonths: recommended.termMonths,
                downPaymentCents: recommended.structure.downPaymentCents,
              })
            }
          />
        </div>
      ) : null}

      {/* NO FEASIBLE STRUCTURE — the server's explanation, never an empty table. */}
      {!hasOptions ? (
        <div className="space-y-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-amber-900">
            NO FEASIBLE STRUCTURE
          </p>
          <ReasonList items={result.reasons} />
          <p className="text-[11px] leading-relaxed text-amber-900">
            Nothing built from these modes and terms fits {formatCents(result.maxPaymentCents)} per{" "}
            {result.paymentFrequency.replace(/_/g, " ").toLowerCase()} with{" "}
            {formatCents(result.downPaymentCents)} down. Raise the budget, add down payment, change the
            modes considered, or set a price or rate under Advanced.
          </p>
        </div>
      ) : null}

      {hasOptions ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {result.options.map((option) => (
            <BudgetOptionCard
              key={`${option.mode}-${option.termMonths}`}
              option={option}
              recommended={
                recommended !== null &&
                recommended.mode === option.mode &&
                recommended.termMonths === option.termMonths
              }
              onCarry={onCarry}
            />
          ))}
        </div>
      ) : null}

      {result.unavailable.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <h3 className="text-sm font-bold tracking-tight text-slate-900">Modes not built</h3>
          <ul className="space-y-1">
            {result.unavailable.map((entry) => (
              <li key={`budget-unavailable-${entry.mode}`} className="text-xs leading-relaxed text-slate-600">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                  {entry.mode.replace(/_/g, " ")}
                </span>
                {" — "}
                {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <WarningList items={result.warnings} />

      <PricingNote pricing={result.pricing} canSeeFinance={canSeeFinance} />
    </div>
  );
}

function BudgetOptionCard({
  option,
  recommended,
  onCarry,
}: {
  option: PaymentBudgetOptionContract;
  recommended: boolean;
  onCarry: (seed: CarrySeed) => void;
}) {
  return (
    <article
      className={`flex flex-col gap-4 rounded-xl border p-4 ${
        recommended ? "border-orange-400 bg-orange-50/40" : "border-slate-200 bg-white shadow-xs"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold tracking-tight text-slate-900">
          {modeIcon(option.mode)}
          <span>{option.modeLabel}</span>
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {recommended ? <StatusBadge status="RECOMMENDED" variant="orange" size="sm" /> : null}
          <StatusBadge status="INSIDE BUDGET" variant="success" size="sm" />
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200/70 pt-3 lg:grid-cols-3">
        <Figure label="Term" value={`${option.termMonths} months · ${option.numberOfPayments} payments`} />
        <Figure label="Payment" value={formatCents(option.paymentAmountCents)} accent />
        <Figure label="Amount financed" value={formatCents(option.amountFinancedCents)} />
        <Figure label="Amount due" value={formatCents(option.amountDueCents)} />
        <Figure label="Finance charge" value={formatCents(option.financeChargeCents)} />
        <Figure label="Total customer outlay" value={formatCents(option.totalCustomerOutlayCents)} />
        <Figure
          label="Capital still exposed"
          value={formatCents(option.dealerCapitalStillExposedCents)}
        />
        <Figure
          label="Vehicle gross"
          value={formatCents(option.vehicleGrossCents, { fallback: "Hidden" })}
        />
        <Figure label="APR" value={formatBasisPoints(option.aprBasisPoints, 2)} />
      </dl>

      <RiskLabels labels={option.structure.riskLabels} />

      {option.structure.reasons.length > 0 ? <ReasonList items={option.structure.reasons} /> : null}

      <CarryButton
        label={`Use this structure · ${option.termMonths} months`}
        onClick={() =>
          onCarry({
            mode: option.structure.mode as DealPaymentMode,
            termMonths: option.termMonths,
            downPaymentCents: option.structure.downPaymentCents,
          })
        }
      />
    </article>
  );
}

/* ========================================================================== */
/* PATH 4 · MAKE CUSTOMER OFFER (the sell side)                                */
/* ========================================================================== */

/**
 * "The customer has $2,500 down and wants to stay near $420 a month. What can we
 * offer?"
 *
 * THE MINIMAL FORM IS THE POINT. This path is used standing at a desk next to a
 * customer on a phone, so the visible form is four things: the vehicle, the
 * payment mode the customer wants, what they can put down and the most they say
 * they can pay. Everything else — a negotiated price, the rate, the frequency,
 * the terms allowed, the fees, the tax, the trade-in and the lease fields — lives
 * in the same collapsed Advanced disclosure the other calculators use.
 *
 * ONE CALL. `FIND BEST DEAL` hands the whole form to
 * `recommendCustomerOfferAction` once; the engine derives the economic floor,
 * prices every allowed term, ranks the survivors and returns the verdict. No
 * figure on the panel below is computed in the browser.
 *
 * WHAT IT IS NOT: not underwriting, not a credit decision, not an affordability
 * judgement and not lender approval. The customer STATES two numbers and the
 * server says which structures fit them while preserving the dealership's
 * configured economics.
 */
function OfferPath({
  vehicles,
  draft,
  updateDraft,
  result,
  error,
  pending,
  canSeeFinance,
  onCalculate,
  onApply,
}: {
  vehicles: DealDeskVehicle[];
  draft: DealDraft;
  updateDraft: OnDraftChange;
  result: CustomerOfferContract | null;
  error: string | null;
  pending: boolean;
  canSeeFinance: boolean;
  onCalculate: (formData: FormData) => void;
  onApply: (result: CustomerOfferContract) => void;
}) {
  const mode = draft.mode;

  return (
    <section aria-label="Make customer offer" className="space-y-4">
      {/* ONE <form>, ONE submission: everything the server reads lives inside it. */}
      <form
        className={`${cardClass} space-y-5`}
        onSubmit={(event) => {
          event.preventDefault();
          onCalculate(new FormData(event.currentTarget));
        }}
      >
        <header className="space-y-1">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Make customer offer</h2>
          <p className="text-xs leading-relaxed text-slate-500">
            Four answers are enough: the vehicle, how the customer wants to pay, what they can put down and
            the most they can pay a month. The server derives the dealership&apos;s minimum acceptable
            price, finds the best structure that fits both numbers, and returns its own verdict.
          </p>
        </header>

        <VehicleSelect
          id="desk-offer-vehicleId"
          vehicles={vehicles}
          value={draft.vehicleId}
          onChange={(value) => updateDraft({ vehicleId: value })}
          hint="The asking price, the cost basis and the days in inventory come from the vehicle record. The offer engine offers at the asking price unless you type a negotiated price below."
        />

        <fieldset className="space-y-2">
          <legend className={labelClass}>Payment mode</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {MODE_OPTIONS.map((option) => {
              const checked = option.mode === mode;
              return (
                <label
                  key={option.mode}
                  htmlFor={`desk-offer-mode-${option.mode}`}
                  className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                    checked ? "border-orange-500 bg-orange-50" : "border-slate-300 bg-white hover:bg-slate-50"
                  }`}
                >
                  <input
                    id={`desk-offer-mode-${option.mode}`}
                    type="radio"
                    name="mode"
                    value={option.mode}
                    checked={checked}
                    onChange={() => updateDraft({ mode: option.mode })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-orange-600"
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-slate-900">
                      {option.label}
                    </span>
                    <span className="block text-[11px] leading-relaxed text-slate-600">{option.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            A CASH offer is structured too: it simply has no periodic payment, so the payment target below
            is not what decides it.
          </p>
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            id="desk-offer-downPayment"
            name="downPayment"
            label="Customer down payment ($)"
            placeholder="0.00"
            value={draft.downPayment}
            onChange={(value) => updateDraft({ downPayment: value })}
            hint="Type 0 when the customer is putting nothing down — a literal zero is sent as zero, not treated as blank."
          />
          <TextField
            id="desk-offer-maxPayment"
            name="maxPayment"
            label="Most the customer can pay per month ($)"
            placeholder="420.00"
            hint="The customer's own stated ceiling. The server checks every candidate against it and reports which ones fit."
          />
        </div>

        {/* The negotiated price is worth being in the open: it is the one number a
            salesperson changes mid-conversation. It stays OPTIONAL, and only
            `proposedSalePrice` is sent, because the offer engine takes the vehicle's
            asking price as its ceiling unless the operator proposes a different one. */}
        <TextField
          id="desk-offer-proposedSalePrice"
          name="proposedSalePrice"
          label="Negotiated sale price, if you have one ($)"
          placeholder="from the vehicle"
          value={draft.sellingPrice}
          onChange={(value) => updateDraft({ sellingPrice: value })}
          hint="Leave blank to offer at the vehicle's asking price. The server refuses to price below the dealership's economic minimum, whatever you type here."
        />

        <AdvancedDealFields
          idPrefix="desk-offer"
          draft={draft}
          updateDraft={updateDraft}
          summary="Advanced · rate, allowed terms, frequency, fees, tax, trade-in and lease terms"
        >
          {/* The terms this offer may use — the one Advanced input the offer engine
              reads that the other two calculators do not have. */}
          <fieldset className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
            <legend className={labelClass}>Terms this offer may use (months)</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {OFFER_TERM_OPTIONS.map((term) => (
                <label
                  key={term}
                  htmlFor={`desk-offer-term-${term}`}
                  className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 transition-colors hover:bg-slate-50"
                >
                  <input
                    id={`desk-offer-term-${term}`}
                    type="checkbox"
                    name="allowedTerms"
                    value={String(term)}
                    defaultChecked
                    className="h-4 w-4 shrink-0 accent-orange-600"
                  />
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-900">
                    {term}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              The server searches every ticked term and ranks what fits. Untick all of them and it falls
              back to its own standard set.
            </p>
          </fieldset>
        </AdvancedDealFields>

        <button type="submit" disabled={pending || draft.vehicleId === ""} className={primaryButtonClass}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4 text-orange-400" />}
          <span>{pending ? "Working out the best offer…" : "Find best deal"}</span>
        </button>
        <p className="text-[11px] leading-relaxed text-slate-500">
          One request, read-only: the server prices every allowed term against these two numbers, holds the
          dealership&apos;s economic floor, and returns its own verdict. It stores nothing, applies nothing
          and approves nothing — no credit, income or lender data is involved, because none exists here.
        </p>
      </form>

      {error ? <ErrorNotice message={error} /> : null}

      {result ? (
        <OfferResultPanel result={result} canSeeFinance={canSeeFinance} onApply={onApply} />
      ) : null}
    </section>
  );
}

/** The terms the offer form lets an operator allow, shortest first. */
const OFFER_TERM_OPTIONS = [12, 24, 36, 42, 48, 60, 72, 84] as const;

/**
 * THE RESULT — the offer as a salesperson would read it out loud.
 *
 * Order is deliberate: the verdict, then the ONE recommended structure, then the
 * two explicit checks, then why, then everything else. `OFFER_VERDICT_VARIANTS`
 * only maps the server's own verdict string onto a colour; the words shown are
 * always the server's `verdictLabel`.
 */
function OfferResultPanel({
  result,
  canSeeFinance,
  onApply,
}: {
  result: CustomerOfferContract;
  canSeeFinance: boolean;
  onApply: (result: CustomerOfferContract) => void;
}) {
  const recommended = result.recommended;
  const variant = OFFER_VERDICT_VARIANTS[result.verdict] ?? "neutral";

  return (
    <div className="space-y-4" aria-live="polite">
      {/* THE VERDICT — never invented here, never softened here. */}
      <div
        className={`space-y-3 rounded-xl border-2 p-4 ${
          variant === "success"
            ? "border-emerald-300 bg-emerald-50"
            : variant === "warning"
              ? "border-amber-300 bg-amber-50"
              : variant === "danger"
                ? "border-rose-300 bg-rose-50"
                : "border-slate-300 bg-slate-50"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={result.verdictLabel} variant={variant} size="md" />
          <StatusBadge status={result.modeLabel} variant="neutral" size="sm" />
        </div>
        <p className="text-base font-bold leading-snug tracking-tight text-slate-900 sm:text-lg">
          {recommended
            ? `${formatCents(recommended.salePriceCents)} at ${recommended.termMonths} months · ${formatCents(recommended.paymentAmountCents)} per period`
            : result.verdictLabel}
        </p>
        <p className="text-xs leading-relaxed text-slate-600">
          {result.maxPaymentCents === null
            ? "No maximum payment was stated, so the payment target does not constrain this offer."
            : `Judged against the customer's stated maximum of ${formatCents(result.maxPaymentCents)} per period and the dealership's own economic floor.`}
        </p>
        <EchoLine
          title={result.echo.vehicleTitle}
          asOfIso={result.echo.asOfIso}
          jurisdiction={result.echo.jurisdiction}
        />
      </div>

      {/* THE RECOMMENDED STRUCTURE — one card, read top to bottom. */}
      {recommended ? (
        <div className="space-y-4 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status="RECOMMENDED" variant="orange" size="md" />
            <p className="text-sm font-bold tracking-tight text-slate-900">
              {result.modeLabel} · {recommended.termMonths} months · {recommended.numberOfPayments} payments
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Figure label="Sale price" value={formatCents(recommended.salePriceCents)} />
            <Figure label="Down payment" value={formatCents(recommended.downPaymentCents)} />
            <Figure label="Amount financed" value={formatCents(recommended.amountFinancedCents)} />
            <Figure
              label="Term"
              value={`${recommended.termMonths} months · ${recommended.numberOfPayments} payments`}
            />
            <Figure label="APR" value={formatBasisPoints(recommended.aprBasisPoints, 2)} />
            <Figure
              label={`Payment every ${frequencyWord(result.paymentFrequency)}`}
              value={formatCents(recommended.paymentAmountCents)}
              accent
            />
          </dl>

          {/* VEHICLE GROSS AND PROJECTED FINANCE INCOME — TWO SEPARATE LINES,
              ALWAYS. They are never added together and never called "profit"
              anywhere on this screen, because the engine keeps them apart. */}
          <div className="space-y-2 border-t border-orange-200 pt-3">
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:text-[11px]">
                  Vehicle gross
                </dt>
                <dd className="break-words font-mono text-sm font-semibold text-slate-900">
                  {formatCents(recommended.vehicleGrossCents, { fallback: "Hidden" })}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:text-[11px]">
                  Projected finance income
                </dt>
                <dd className="break-words font-mono text-sm font-semibold text-slate-900">
                  {formatCents(recommended.projectedFinanceIncomeCents)}
                </dd>
              </div>
            </dl>
            <p className="text-[11px] leading-relaxed text-slate-600">
              Two separate figures on purpose. Vehicle gross is the margin on the vehicle; projected
              finance income is a separate revenue stream that the server never adds to it. There is no
              combined profit figure on this screen.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-orange-200 pt-3 sm:grid-cols-3">
            <Figure
              label="Cash received today"
              value={formatCents(recommended.dealerCashReceivedAtClosingCents)}
            />
            <Figure
              label="Nexo capital exposed"
              value={formatCents(recommended.dealerCapitalStillExposedCents)}
            />
            <Figure
              label="Return on Nexo capital"
              value={
                recommended.vehicleRoiBasisPoints === null
                  ? "Hidden"
                  : formatBasisPoints(recommended.vehicleRoiBasisPoints, 2)
              }
            />
            <Figure label="Finance charge on the contract" value={formatCents(recommended.financeChargeCents)} />
            <Figure label="Total customer outlay" value={formatCents(recommended.totalCustomerOutlayCents)} />
            <Figure label="Rate policy (the server's own wording)" value={recommended.ratePolicyStatement} mono={false} />
          </dl>

          {/* THE TWO CHECKS — the server's booleans, stated as the server's facts. */}
          <div className="space-y-2 border-t border-orange-200 pt-3">
            <OfferCheckLine
              ok={recommended.fitsPaymentTarget}
              text={`FITS PAYMENT TARGET${
                result.maxPaymentCents === null
                  ? " (no maximum payment was stated)"
                  : ` — customer target ${formatCents(result.maxPaymentCents)}/${frequencyWord(result.paymentFrequency)}`
              }`}
            />
            <OfferCheckLine
              ok={recommended.meetsEconomicFloor}
              text={
                recommended.meetsEconomicFloor
                  ? `MEETS MINIMUM MARGIN${floorSuffix(result.minimumSalePriceCents)}`
                  : "MEETS MINIMUM MARGIN — not verified at or above the dealership's economic floor"
              }
            />
            <p className="text-[11px] leading-relaxed text-slate-600">
              These are the server&apos;s own checks, not a judgement about the customer.
            </p>
          </div>

          <ReasonList items={recommended.structure.reasons} title="Why this structure" />
          <RiskLabels labels={recommended.structure.riskLabels} />

          <CarryButton
            label="Apply to deal"
            icon={<Handshake className="h-3.5 w-3.5" />}
            onClick={() => onApply(result)}
            note="Copies the recommended mode, term, sale price and down payment into CALCULATE DEAL and switches to it. Nothing is saved or finalized — you carry on through the staged workflow yourself."
          />
        </div>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          The server recommended no structure for these numbers. The checks and the reasons below say why.
        </p>
      )}

      {/* THE BLOCKERS — the server's own labels, in the server's own words.
          The engine accumulates a blocker for EVERY candidate term it could not
          use, so an ACCEPT can legitimately arrive with blockers attached: they
          describe the terms that did not fit, not the recommendation. The heading
          says which, rather than implying the recommendation is in doubt. */}
      {result.blockerLabels.length > 0 ? (
        <div className="space-y-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-amber-900">
            {result.verdict === "ACCEPT"
              ? "Terms the engine could not use (the recommendation above is unaffected)"
              : "What is in the way"}
          </p>
          <ul className="space-y-1">
            {result.blockerLabels.map((label, index) => (
              <li key={`offer-blocker-${index}`} className="flex gap-2 text-xs leading-relaxed text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* THE MINIMUM VIABLE OFFER — the ADJUST case, with its own reason verbatim. */}
      {result.minimumViable ? (
        <div className="space-y-3 rounded-xl border-2 border-orange-300 bg-white p-4 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status="WHAT WOULD MAKE IT WORK" variant="orange" size="md" />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Figure label="Down payment" value={formatCents(result.minimumViable.downPaymentCents)} accent />
            <Figure label="Term" value={`${result.minimumViable.termMonths} months`} />
            <Figure label="Sale price" value={formatCents(result.minimumViable.salePriceCents)} />
            <Figure label="Amount financed" value={formatCents(result.minimumViable.amountFinancedCents)} />
            <Figure
              label="Resulting payment"
              value={formatCents(result.minimumViable.paymentAmountCents)}
              accent
            />
            <Figure
              label="Vehicle gross"
              value={formatCents(result.minimumViable.vehicleGrossCents, { fallback: "Hidden" })}
            />
          </dl>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
            {result.minimumViable.reason}
          </p>
          <p className="text-[11px] leading-relaxed text-slate-500">
            This is the smallest change the server found, not an approval and not a promise: the customer
            would still have to agree to it.
          </p>
        </div>
      ) : null}

      {/* EVERY CANDIDATE TERM — stacked rows on a phone, two columns on a wider
          screen. A wide table would be unreadable at a desk. */}
      {result.options.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-bold tracking-tight text-slate-900">Every allowed term the server costed</h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {result.options.map((option) => (
              <OfferOptionCard
                key={`offer-option-${option.termMonths}-${option.numberOfPayments}`}
                option={option}
                recommended={
                  recommended !== null &&
                  recommended.termMonths === option.termMonths &&
                  recommended.salePriceCents === option.salePriceCents
                }
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* THE ECONOMIC FLOOR — or an honest statement about why it is missing. */}
      {result.pricePolicy ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <h3 className="text-sm font-bold tracking-tight text-slate-900">The floor this offer had to clear</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Figure
              label="Minimum acceptable sale price"
              value={formatCents(result.pricePolicy.floorCents, { fallback: "Not computed" })}
            />
            <Figure label="Target selling price" value={formatCents(result.pricePolicy.targetCents)} />
            <Figure label="Asking price" value={formatCents(result.askingPriceCents)} />
            <Figure
              label="Price offered"
              value={formatCents(result.recommendedSalePriceCents, { fallback: "no structure recommended" })}
            />
            <Figure
              label="Binding constraint"
              value={result.pricePolicy.bindingConstraint === null ? "—" : result.pricePolicy.bindingConstraint.replace(/-/g, " ")}
              mono={false}
            />
          </dl>
          <ReasonList items={result.pricePolicy.reasons} />
        </div>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          {canSeeFinance
            ? "The server did not return the dealership's price floor for this vehicle."
            : "The cost basis is not visible to your role, so the server sends no price floor and no minimum acceptable sale price. The payment maths above is still exact, but no margin figure can be confirmed here — nothing is estimated in its place."}
        </p>
      )}

      <ReasonList items={result.reasons} title="How the server reached this" />
      <WarningList items={result.warnings} title="Warnings" />
    </div>
  );
}

/** The server's verdict string onto a badge colour. The WORDS are always the server's. */
const OFFER_VERDICT_VARIANTS: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  ACCEPT: "success",
  ADJUST: "warning",
  REJECT: "danger",
};

/** One of the server's two checks, stated as a fact rather than a judgement. */
function OfferCheckLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p
      className={`flex items-start gap-2 text-xs font-semibold leading-relaxed ${
        ok ? "text-emerald-800" : "text-amber-900"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      )}
      <span>{text}</span>
    </p>
  );
}

/** " — floor $18,400", or nothing at all when the server sent no floor. */
function floorSuffix(floorCents: number | null): string {
  return floorCents === null ? "" : ` — floor ${formatCents(floorCents)}`;
}

/**
 * The payment period in the operator's own words.
 *
 * A display mapping of the server's frequency string, nothing more: no rate and
 * no payment is derived from it.
 */
function frequencyWord(frequency: string): string {
  const normalized = frequency.toUpperCase();
  if (normalized === "SEMIMONTHLY") return "half-month";
  if (normalized === "BIWEEKLY") return "two weeks";
  if (normalized === "WEEKLY") return "week";
  return "month";
}

/** One candidate term, as a stacked row rather than a table cell. */
function OfferOptionCard({
  option,
  recommended,
}: {
  option: CustomerOfferOptionContract;
  recommended: boolean;
}) {
  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border p-4 ${
        recommended ? "border-orange-400 bg-orange-50/40" : "border-slate-200 bg-white shadow-xs"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold tracking-tight text-slate-900">
          {option.termMonths} months · {option.numberOfPayments} payments
        </h4>
        <div className="flex flex-wrap items-center gap-1.5">
          {recommended ? <StatusBadge status="RECOMMENDED" variant="orange" size="sm" /> : null}
          <StatusBadge
            status={option.fitsPaymentTarget ? "FITS" : "DOES NOT FIT"}
            variant={option.fitsPaymentTarget ? "success" : "danger"}
            size="sm"
          />
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200/70 pt-3">
        <Figure label="Payment" value={formatCents(option.paymentAmountCents)} accent />
        <Figure label="Sale price" value={formatCents(option.salePriceCents)} />
        <Figure label="Down payment" value={formatCents(option.downPaymentCents)} />
        <Figure label="Amount financed" value={formatCents(option.amountFinancedCents)} />
      </dl>

      {!option.meetsEconomicFloor ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          Below minimum margin: the server did not verify this structure at or above the dealership&apos;s
          economic floor — either the price is under it, or the cost basis is not visible to your role.
        </p>
      ) : null}

      {!option.fitsPaymentTarget ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          This term does not reach the customer&apos;s stated payment target. The figure above is the payment
          the server actually computed for it.
        </p>
      ) : null}

      {option.ratePolicyStatement ? (
        <p className="font-mono text-[11px] leading-relaxed text-slate-500">
          {option.ratePolicyStatement}
        </p>
      ) : null}
    </article>
  );
}

/* ========================================================================== */
/* SHARED CALCULATOR PIECES                                                    */
/* ========================================================================== */

/**
 * One carry affordance, used by all three calculators.
 *
 * It copies the SERVER's mode, term, down payment and (for the offer path) the
 * sale price into the staged workflow's own inputs — a state copy, never a
 * recomputation, and never a database write.
 */
function CarryButton({
  label,
  onClick,
  note = "Carries the payment mode, the term and the down payment into CALCULATE DEAL. It fills the inputs and stops there — nothing is saved.",
  icon,
}: {
  label: string;
  onClick: () => void;
  note?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="space-y-1 border-t border-slate-200/70 pt-3">
      <button type="button" onClick={onClick} className={tinyButtonClass}>
        {icon ?? <ArrowRight className="h-3.5 w-3.5" />}
        <span>{label}</span>
      </button>
      <p className="text-[11px] leading-relaxed text-slate-500">{note}</p>
    </div>
  );
}

/**
 * The four financed modes as radios, for the target-payment path.
 *
 * CASH is absent and the hint says why: with no periodic payment there is nothing
 * for a payment solver to search.
 */
function FinancedModeRadio({
  idPrefix,
  label,
  value,
  onChange,
  hint,
}: {
  idPrefix: string;
  label: string;
  value: DealPaymentMode;
  onChange: (mode: DealPaymentMode) => void;
  hint: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className={labelClass}>{label}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FINANCED_MODE_OPTIONS.map((option) => {
          const checked = option.mode === value;
          return (
            <label
              key={option.mode}
              htmlFor={`${idPrefix}-mode-${option.mode}`}
              className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                checked ? "border-orange-500 bg-orange-50" : "border-slate-300 bg-white hover:bg-slate-50"
              }`}
            >
              <input
                id={`${idPrefix}-mode-${option.mode}`}
                type="radio"
                name="mode"
                value={option.mode}
                checked={checked}
                onChange={() => onChange(option.mode)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-orange-600"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-slate-900">
                  {option.label}
                </span>
                <span className="block text-[11px] leading-relaxed text-slate-600">{option.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">{hint}</p>
    </fieldset>
  );
}

/**
 * The collapsed "Advanced" disclosure every calculator shares.
 *
 * Every field here is OPTIONAL: `readDealSetup` falls back to the vehicle's
 * asking price, the dealership's configured rate and term, and zero fees and
 * tax. `idPrefix` keeps the ids distinct even though only one path is ever
 * mounted.
 *
 * `children` renders at the END of the disclosure, still inside it, for a path
 * that needs one extra optional control (the offer path's allowed terms) without
 * a second disclosure. The other two paths pass nothing and are unchanged.
 */
function AdvancedDealFields({
  idPrefix,
  draft,
  updateDraft,
  summary,
  children,
}: {
  idPrefix: string;
  draft: DealDraft;
  updateDraft: OnDraftChange;
  summary: string;
  children?: ReactNode;
}) {
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">{summary}</summary>
      <div className="mt-3 space-y-4">
        <p className="text-[11px] leading-relaxed text-slate-500">
          Everything here is optional. Leave it blank and the server uses the vehicle&apos;s asking price,
          the dealership&apos;s configured rate and term, and zero fees and tax.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            id={`${idPrefix}-sellingPrice`}
            name="sellingPrice"
            label="Selling price ($)"
            placeholder="from the vehicle"
            value={draft.sellingPrice}
            onChange={(value) => updateDraft({ sellingPrice: value })}
          />
          <TextField
            id={`${idPrefix}-dealerFees`}
            name="dealerFees"
            label="Dealer fees ($)"
            placeholder="0.00"
            value={draft.dealerFees}
            onChange={(value) => updateDraft({ dealerFees: value })}
          />
          <TextField
            id={`${idPrefix}-salesTaxPercent`}
            name="salesTaxPercent"
            label="Sales tax (%)"
            placeholder="0.00"
            value={draft.salesTaxPercent}
            onChange={(value) => updateDraft({ salesTaxPercent: value })}
          />
          <TextField
            id={`${idPrefix}-tradeInAllowance`}
            name="tradeInAllowance"
            label="Trade-in allowance ($)"
            placeholder="0.00"
            value={draft.tradeInAllowance}
            onChange={(value) => updateDraft({ tradeInAllowance: value })}
          />
          <TextField
            id={`${idPrefix}-tradeInPayoff`}
            name="tradeInPayoff"
            label="Trade-in payoff ($)"
            placeholder="0.00"
            value={draft.tradeInPayoff}
            onChange={(value) => updateDraft({ tradeInPayoff: value })}
          />
          <TextField
            id={`${idPrefix}-aprPercent`}
            name="aprPercent"
            label="APR (%)"
            placeholder="dealership default"
            value={draft.aprPercent}
            onChange={(value) => updateDraft({ aprPercent: value })}
          />
          <TextField
            id={`${idPrefix}-termMonths`}
            name="termMonths"
            label="Term if no override applies (months)"
            inputMode="numeric"
            placeholder="candidate terms"
            hint="The solvers search their own standard terms; this is the default term the server falls back to."
            value={draft.termMonths}
            onChange={(value) => updateDraft({ termMonths: value })}
          />
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-paymentFrequency`} className={labelClass}>
              Payment frequency
            </label>
            <select
              id={`${idPrefix}-paymentFrequency`}
              name="paymentFrequency"
              value={draft.paymentFrequency}
              onChange={(event) => updateDraft({ paymentFrequency: event.target.value })}
              className={inputClass}
            >
              {PAYMENT_FREQUENCIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">
            Lease terms · used by LEASE and LEASE TO OWN
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TextField
              id={`${idPrefix}-residualValue`}
              name="residualValue"
              label="Residual value ($)"
              placeholder="0.00"
              hint="A lease cannot be built without one."
              value={draft.residualValue}
              onChange={(value) => updateDraft({ residualValue: value })}
            />
            <TextField
              id={`${idPrefix}-capCostReduction`}
              name="capCostReduction"
              label="Cap cost reduction ($)"
              placeholder="0.00"
              value={draft.capCostReduction}
              onChange={(value) => updateDraft({ capCostReduction: value })}
            />
            <TextField
              id={`${idPrefix}-moneyFactorAprPercent`}
              name="moneyFactorAprPercent"
              label="Money factor as APR (%)"
              placeholder="0.00"
              value={draft.moneyFactorAprPercent}
              onChange={(value) => updateDraft({ moneyFactorAprPercent: value })}
            />
            <TextField
              id={`${idPrefix}-purchaseOption`}
              name="purchaseOption"
              label="Purchase option ($)"
              placeholder="0.00"
              value={draft.purchaseOption}
              onChange={(value) => updateDraft({ purchaseOption: value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            id={`${idPrefix}-ratePolicyJurisdiction`}
            name="ratePolicyJurisdiction"
            label="Jurisdiction code (2–8 characters)"
            placeholder="dealership default"
            inputMode="text"
            className="uppercase"
            hint="The software never assumes which jurisdiction governs a deal. The server repeats its own rate-policy wording in the result."
            value={draft.ratePolicyJurisdiction}
            onChange={(value) => updateDraft({ ratePolicyJurisdiction: value })}
          />
        </div>

        {children}
      </div>
    </details>
  );
}

/**
 * The pricing block for the two calculators.
 *
 * A null `pricing` is a ROLE statement, not a zero — the server sends no ladder
 * when the cost basis is not visible, and this says so instead of showing one.
 */
function PricingNote({
  pricing,
  canSeeFinance,
}: {
  pricing: DealPricingContract | null;
  canSeeFinance: boolean;
}) {
  if (!pricing) {
    return <PricingUnavailable canSeeFinance={canSeeFinance} />;
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold tracking-tight text-slate-900">Price ladder (from the server)</h3>
        <span className="font-mono text-[11px] text-slate-500">
          binding constraint: {pricing.bindingConstraint.replace(/-/g, " ")}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-3">
        <Figure label="Asking price" value={formatCents(pricing.askingPriceCents)} />
        <Figure label="Target selling price" value={formatCents(pricing.targetSellingPriceCents)} />
        <Figure
          label="Minimum approved price"
          value={formatCents(pricing.minimumApprovedPriceCents, { fallback: "Not visible to your role" })}
        />
        <Figure
          label="Expected vehicle gross"
          value={formatCents(pricing.targetGrossCents, { fallback: "Hidden" })}
        />
        <Figure label="Negotiation allowance" value={formatCents(pricing.negotiationAllowanceCents)} />
        <Figure label="Ageing discount" value={formatCents(pricing.agingDiscountCents)} />
      </dl>
      <ReasonList items={pricing.reasons} />
      <WarningList items={pricing.warnings} />
    </div>
  );
}
