"use client";

import { type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Lock,
  Sparkles,
  Wallet,
} from "lucide-react";

import { ActionForm } from "@/app/_components/ActionForm";
import { completeVehicleSaleAction } from "@/app/actions/sales";
import { StatusBadge } from "@/app/_components/StatusBadge";
import {
  EchoLine,
  ErrorNotice,
  Figure,
  HeadlineBlock,
  LAST_STEP,
  MODE_OPTIONS,
  PAYMENT_FREQUENCIES,
  PREFERRED_CONTACT,
  PricingUnavailable,
  ReasonList,
  RiskLabels,
  STEP_LABELS,
  TextField,
  VehicleSelect,
  WarningList,
  cardClass,
  financeTypeFor,
  inputClass,
  labelClass,
  modeIcon,
  modeLabelFor,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  type DealDeskLead,
  type DealDeskVehicle,
  type DealDraft,
  type DealPaymentMode,
  type DraftPatch,
  type DraftTextKey,
  type OnDraftChange,
} from "@/app/_components/dealDeskShared";
import type { DealComparisonContract, DealStructureContract } from "@/lib/boundary/contracts";
import { formatBasisPoints, formatCents } from "@/lib/money";

/**
 * PATH 1 · CALCULATE DEAL — the staged deal workflow, moved verbatim out of the
 * single DealDesk module.
 * 
 * The DEFAULT path, and deliberately a STATIC import of the shell: an operator who
 * opens /sales/desk gets the staged workflow in the same paint as the page, exactly
 * as before. Only the three calculators the operator has NOT chosen are
 * `next/dynamic` — see DealDesk.tsx.
 * 
 * No visible behaviour, field name, step, verdict or masking rule changed in the
 * move.
 */

export function SectionSummary({ title, onEdit }: { title: string; onEdit: () => void }) {
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

export function PriceLadder({
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

export function WorkflowPath({
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

export function VehicleField({
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

export function BuyerFields({
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

export function buyerLabel(leads: DealDeskLead[], leadId: string): string {
  return leads.find((lead) => lead.id === leadId)?.name ?? leadId;
}

/* -------------------------------------------------------------------------- */
/* STEP 3 — price                                                              */
/* -------------------------------------------------------------------------- */

export function PriceFields({ draft, onChange }: { draft?: DealDraft; onChange?: OnDraftChange }) {
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

export function ModeChooser({
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

export function TermsFields({
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

export function ComparisonPanel({ comparison }: { comparison: DealComparisonContract }) {
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

export function StructureCard({
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

export function RatePolicyPanel({
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
