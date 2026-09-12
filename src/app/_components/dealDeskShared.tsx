"use client";

import { type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Handshake,
  Key,
  Repeat,
  Scale,
} from "lucide-react";

import { StatusBadge } from "@/app/_components/StatusBadge";
import { type DealPaymentMode } from "@/lib/deal-structuring";
import { formatBasisPoints, formatCents } from "@/lib/money";

/* The shared vocabulary every other module in the family imports from here. The
   money helpers are NOT re-exported: each module takes them from `@/lib/money`
   directly, so the family's display rule stays visible at every call site. */
export { StatusBadge };
export type { DealPaymentMode };

/**
 * THE DEAL DESK FAMILY.
 * 
 * The desk used to be ONE ~3.4k-line `"use client"` module, so opening /sales/desk
 * made the browser download and parse the staged workflow AND all three calculators
 * whether or not the operator ever chose one. It is now five sibling modules:
 * 
 *   dealDeskShared.tsx            the shared deal draft's vocabulary, the path
 *                                 vocabulary, and every presentational primitive
 *                                 more than one path renders.
 *   DealDesk.workflowPath.tsx     path 1 · CALCULATE DEAL, the default. Kept a
 *                                 STATIC import of the shell so the default path
 *                                 paints with the page; it is never a lazy surprise.
 *   DealDesk.calculatorParts.tsx  the pieces the three calculators share.
 *   DealDesk.calculators.tsx      paths 2-4 · TARGET MONTHLY PAYMENT, FIT A PAYMENT
 *                                 BUDGET and MAKE CUSTOMER OFFER, reached through
 *                                 `next/dynamic` so their code is only fetched and
 *                                 parsed when the operator picks one.
 *   DealDesk.tsx                  the thin shell: the one shared controlled draft,
 *                                 the path selector, the dynamic boundary.
 * 
 * THIS IS A MOVE, NOT A REWRITE. Every line below that is not an import, an
 * `export` keyword or one of the three documented `readDeal()` call sites is
 * byte-identical to the single module it came from: no field name, no visible string,
 * no verdict, no badge, no comment and no masking rule changed. `FormData` still
 * reads the same names from the same live form, and only one path is still mounted at
 * a time, so no field name ever exists twice in the live DOM.
 * 
 * The governing rule is unchanged: NO FINANCIAL MATH IN THE BROWSER.
 * `formatCents` / `formatBasisPoints` / `centsToDecimalString` are display and input
 * echo only, and the only `Math.*` calls in the whole family are `Math.min` /
 * `Math.max` moving between wizard steps. The server stays authoritative for every
 * figure, verdict and recommendation.
 */

export interface DealDeskVehicle {
  id: string;
  label: string;
  askingPriceCents: number | null;
  status: string;
}

export interface DealDeskLead {
  id: string;
  name: string;
}

export interface DealDeskProps {
  vehicles: DealDeskVehicle[];
  leads: DealDeskLead[];
  selectedVehicleId: string | null;
  selectedLeadId: string | null;
  canWrite: boolean;
  canSeeFinance: boolean;
}

/** The seven steps, in order, exactly as the brief specifies them. */
export const STEP_LABELS = ["VEHICLE", "BUYER", "PRICE", "PAYMENT MODE", "TERMS", "COMPARISON", "FINALIZE"] as const;
export const LAST_STEP = STEP_LABELS.length - 1;
export const PAYMENT_FREQUENCIES = ["MONTHLY", "SEMIMONTHLY", "BIWEEKLY", "WEEKLY"] as const;
export const PREFERRED_CONTACT = ["PHONE", "EMAIL", "TEXT", "ANY"] as const;

/**
 * The four ways into the desk.
 *
 * Exactly four, defaulting to the first, rendered as one compact segmented
 * control that wraps on a phone: a path is a lens on the same deal, not a
 * separate application.
 */
export const PATH_OPTIONS = [
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

export type DeskPath = (typeof PATH_OPTIONS)[number]["id"];

/**
 * The five payment choices.
 *
 * `financeType` is the enum `completeVehicleSaleAction` validates against; `mode`
 * is the engine's `DealPaymentMode`. Both live here so the two vocabularies can
 * never drift on screen.
 */
export const MODE_OPTIONS: ReadonlyArray<{
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
export const FINANCED_MODE_OPTIONS = MODE_OPTIONS.filter((option) => option.mode !== "CASH");
export const FINANCED_MODES = FINANCED_MODE_OPTIONS.map((option) => option.mode);

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500";
export const labelClass = "block font-mono text-[11px] font-medium uppercase tracking-wider text-slate-600";
export const cardClass = "rounded-xl border border-slate-200 bg-white p-5 shadow-xs";
export const panelClass = "rounded-lg border border-slate-200 bg-slate-50 p-3";
export const primaryButtonClass =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60";
export const secondaryButtonClass =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 sm:min-h-0 sm:py-1.5";
export const tinyButtonClass =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-800 transition-colors hover:bg-orange-100";

export function financeTypeFor(mode: DealPaymentMode): string {
  return MODE_OPTIONS.find((option) => option.mode === mode)?.financeType ?? "UNDECIDED";
}

export function modeLabelFor(mode: DealPaymentMode): string {
  return MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
}

export function isFinancedMode(mode: DealPaymentMode): boolean {
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
export function isDealPaymentMode(value: string): value is DealPaymentMode {
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
export interface DealDraft {
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

export type DraftTextKey = { [K in keyof DealDraft]: DealDraft[K] extends string ? K : never }[keyof DealDraft];

export function initialDraft(selectedVehicleId: string | null, selectedLeadId: string | null): DealDraft {
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

export type DraftPatch = Partial<Omit<DealDraft, "mode">> & { mode?: DealPaymentMode };

export type OnDraftChange = (patch: DraftPatch) => void;

/** The figures an option can carry into the staged workflow. */
export interface CarrySeed {
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

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                       */
/* -------------------------------------------------------------------------- */

/** A labelled figure: the label always sits immediately next to its value. */
export function Figure({
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

export function TextField({
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

export function VehicleSelect({
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

export function PricingUnavailable({ canSeeFinance }: { canSeeFinance: boolean }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
      {canSeeFinance
        ? "The server did not return a price ladder for this vehicle."
        : "The cost basis is not visible to your role, so the server sends no price ladder, no minimum approved price and no expected gross. Nothing is estimated in its place."}
    </p>
  );
}

/** One short line of the server's echo, so an operator can trust the inputs read. */

export function EchoLine({
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

export function HeadlineBlock({
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

export function ReasonList({ items, title }: { items: readonly string[]; title?: string }) {
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

export function WarningList({ items, title = "Warnings" }: { items: readonly string[]; title?: string }) {
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

export function ErrorNotice({ message }: { message: string }) {
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

export function RiskLabels({ labels }: { labels: readonly string[] }) {
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


/* -------------------------------------------------------------------------- */
/* PATH 1 · THE STAGED DEAL WORKFLOW                                           */
/* -------------------------------------------------------------------------- */

export function modeIcon(mode: string): ReactNode {
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
