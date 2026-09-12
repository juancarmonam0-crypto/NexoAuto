"use client";

import { useState, useTransition, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Handshake, Loader2, Sparkles, XCircle } from "lucide-react";

import {
  fitPaymentBudgetAction,
  recommendCustomerOfferAction,
  solveTargetPaymentAction,
} from "@/app/actions/sales";
import {
  AdvancedDealFields,
  CarryButton,
  FinancedModeRadio,
  PricingNote,
} from "@/app/_components/DealDesk.calculatorParts";
import {
  EchoLine,
  ErrorNotice,
  FINANCED_MODE_OPTIONS,
  Figure,
  HeadlineBlock,
  MODE_OPTIONS,
  ReasonList,
  RiskLabels,
  StatusBadge,
  TextField,
  VehicleSelect,
  WarningList,
  cardClass,
  isFinancedMode,
  labelClass,
  modeIcon,
  primaryButtonClass,
  type CarrySeed,
  type DealDeskVehicle,
  type DealDraft,
  type DealPaymentMode,
  type OnDraftChange,
} from "@/app/_components/dealDeskShared";
import type {
  CustomerOfferContract,
  CustomerOfferOptionContract,
  PaymentBudgetOptionContract,
  PaymentBudgetResultContract,
  TargetPaymentOptionContract,
  TargetPaymentResultContract,
} from "@/lib/boundary/contracts";
import { centsToDecimalString, formatBasisPoints, formatCents } from "@/lib/money";

/**
 * PATHS 2-4 · the three calculators.
 * 
 *   PATH 2 · TARGET MONTHLY PAYMENT
 *   PATH 3 · FIT A PAYMENT BUDGET
 *   PATH 4 · MAKE CUSTOMER OFFER
 * 
 * Only ever reached through `next/dynamic` from DealDesk.tsx, so an operator who
 * stays on CALCULATE DEAL never downloads or parses a line of it.
 * 
 * The three path components are moved verbatim. What is new in this module is the
 * `CalculatorPaths` dispatcher at the end and the three one-line submissions that now
 * call the shell's own `readDeal()` — the same `new FormData(form)` on the same live
 * form, with the same field names, so the server reads exactly what it read before.
 * 
 * Nothing about the server calls changed: the form is read once and handed over whole,
 * the result contract is rendered verbatim, and an `ok:false` outcome still becomes
 * the same error notice in the same place.
 * 
 * No arithmetic. `formatCents` / `formatBasisPoints` only print the server's own
 * figures, and `centsToDecimalString` only echoes the server's own down payment and
 * sale price back into the shared draft when an operator carries a structure into the
 * staged workflow.
 */

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
export function TargetPaymentPath({
  vehicles,
  draft,
  updateDraft,
  result,
  error,
  pending,
  canSeeFinance,
  onRead,
  onSubmit,
  onCarry,
}: {
  vehicles: DealDeskVehicle[];
  draft: DealDraft;
  updateDraft: OnDraftChange;
  result: TargetPaymentResultContract | null;
  error: string | null;
  pending: boolean;
  canSeeFinance: boolean;
  /** The shell's one read of the live form: `new FormData(form)`, by name. */
  onRead: () => FormData | null;
  /** The server call this path has always made, owned by the shell. */
  onSubmit: (formData: FormData) => void;
  onCarry: (seed: CarrySeed) => void;
}) {
  const mode = isFinancedMode(draft.mode) ? draft.mode : "EXTERNAL_FINANCE";

  return (
    <section aria-label="Target monthly payment" className="space-y-4">
      <form
        className={`${cardClass} space-y-5`}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = onRead();
          if (formData) onSubmit(formData);
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

export function TargetPaymentResultPanel({
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

export function TargetOptionCard({
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

export function BudgetPath({
  vehicles,
  draft,
  updateDraft,
  result,
  error,
  pending,
  canSeeFinance,
  onRead,
  onSubmit,
  onCarry,
}: {
  vehicles: DealDeskVehicle[];
  draft: DealDraft;
  updateDraft: OnDraftChange;
  result: PaymentBudgetResultContract | null;
  error: string | null;
  pending: boolean;
  canSeeFinance: boolean;
  /** The shell's one read of the live form: `new FormData(form)`, by name. */
  onRead: () => FormData | null;
  /** The server call this path has always made, owned by the shell. */
  onSubmit: (formData: FormData) => void;
  onCarry: (seed: CarrySeed) => void;
}) {
  return (
    <section aria-label="Fit a payment budget" className="space-y-4">
      <form
        className={`${cardClass} space-y-5`}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = onRead();
          if (formData) onSubmit(formData);
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

export function BudgetResultPanel({
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

export function BudgetOptionCard({
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

export function OfferPath({
  vehicles,
  draft,
  updateDraft,
  result,
  error,
  pending,
  canSeeFinance,
  onRead,
  onSubmit,
  onApply,
}: {
  vehicles: DealDeskVehicle[];
  draft: DealDraft;
  updateDraft: OnDraftChange;
  result: CustomerOfferContract | null;
  error: string | null;
  pending: boolean;
  canSeeFinance: boolean;
  /** The shell's one read of the live form: `new FormData(form)`, by name. */
  onRead: () => FormData | null;
  /** The server call this path has always made, owned by the shell. */
  onSubmit: (formData: FormData) => void;
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
          const formData = onRead();
          if (formData) onSubmit(formData);
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

export const OFFER_TERM_OPTIONS = [12, 24, 36, 42, 48, 60, 72, 84] as const;

/**
 * THE RESULT — the offer as a salesperson would read it out loud.
 *
 * Order is deliberate: the verdict, then the ONE recommended structure, then the
 * two explicit checks, then why, then everything else. `OFFER_VERDICT_VARIANTS`
 * only maps the server's own verdict string onto a colour; the words shown are
 * always the server's `verdictLabel`.
 */

export function OfferResultPanel({
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

export function OfferCheckLine({ ok, text }: { ok: boolean; text: string }) {
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

export function floorSuffix(floorCents: number | null): string {
  return floorCents === null ? "" : ` — floor ${formatCents(floorCents)}`;
}

/**
 * The payment period in the operator's own words.
 *
 * A display mapping of the server's frequency string, nothing more: no rate and
 * no payment is derived from it.
 */

export function frequencyWord(frequency: string): string {
  const normalized = frequency.toUpperCase();
  if (normalized === "SEMIMONTHLY") return "half-month";
  if (normalized === "BIWEEKLY") return "two weeks";
  if (normalized === "WEEKLY") return "week";
  return "month";
}

/** One candidate term, as a stacked row rather than a table cell. */

export function OfferOptionCard({
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
/* THE CALCULATOR DISPATCHER                                                   */
/* ========================================================================== */

/**
 * ONE dynamic import for all three calculators, chosen by prop.
 *
 * The shell mounts exactly one path at a time, exactly as it did when the four
 * conditional renders lived inside the single module. The difference is that this
 * code is no longer in the shell's own chunk, so an operator who never picks a
 * calculator never fetches or parses one.
 *
 * Each path renders its own `<form>` (it always did) and submits through the
 * shell's `readDeal`, so the `FormData` handed to the server still carries exactly
 * the fields that form holds. Results live in the shell's state, which is why
 * switching between calculators keeps the shared draft and any result already on
 * screen.
 */
export interface CalculatorPathsProps {
  /** The chosen calculator. `workflow` never reaches this module. */
  path: "target" | "budget" | "offer";
  vehicles: DealDeskVehicle[];
  canSeeFinance: boolean;
  draft: DealDraft;
  updateDraft: OnDraftChange;
  /** The shell's one read of the live form: `new FormData(form)`, by name. */
  readDeal: () => FormData | null;
  carryOption: (seed: CarrySeed) => void;
  /** APPLY TO DEAL — copies the server's recommended structure into the draft. */
  applyOffer: (result: CustomerOfferContract) => void;
  targetResult: TargetPaymentResultContract | null;
  setTargetResult: (result: TargetPaymentResultContract | null) => void;
  targetError: string | null;
  setTargetError: (message: string | null) => void;
  budgetResult: PaymentBudgetResultContract | null;
  setBudgetResult: (result: PaymentBudgetResultContract | null) => void;
  budgetError: string | null;
  setBudgetError: (message: string | null) => void;
  offerResult: CustomerOfferContract | null;
  setOfferResult: (result: CustomerOfferContract | null) => void;
  offerError: string | null;
  setOfferError: (message: string | null) => void;
}

export function CalculatorPaths({
  path,
  vehicles,
  canSeeFinance,
  draft,
  updateDraft,
  readDeal,
  carryOption,
  applyOffer,
  targetResult,
  setTargetResult,
  targetError,
  setTargetError,
  budgetResult,
  setBudgetResult,
  budgetError,
  setBudgetError,
  offerResult,
  setOfferResult,
  offerError,
  setOfferError,
}: CalculatorPathsProps) {
  const [pending, startTransition] = useTransition();

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

  if (path === "target") {
    return (
      <TargetPaymentPath
        vehicles={vehicles}
        canSeeFinance={canSeeFinance}
        draft={draft}
        updateDraft={updateDraft}
        result={targetResult}
        error={targetError}
        pending={pending}
        onRead={readDeal}
        onSubmit={handleSolveTarget}
        onCarry={carryOption}
      />
    );
  }

  if (path === "budget") {
    return (
      <BudgetPath
        vehicles={vehicles}
        canSeeFinance={canSeeFinance}
        draft={draft}
        updateDraft={updateDraft}
        result={budgetResult}
        error={budgetError}
        pending={pending}
        onRead={readDeal}
        onSubmit={handleFitBudget}
        onCarry={carryOption}
      />
    );
  }

  if (path === "offer") {
    return (
      <OfferPath
        vehicles={vehicles}
        canSeeFinance={canSeeFinance}
        draft={draft}
        updateDraft={updateDraft}
        result={offerResult}
        error={offerError}
        pending={pending}
        onRead={readDeal}
        onSubmit={handleMakeOffer}
        onApply={applyOffer}
      />
    );
  }

  return null;
}
