"use client";

import { type ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import {
  FINANCED_MODE_OPTIONS,
  Figure,
  PAYMENT_FREQUENCIES,
  PricingUnavailable,
  ReasonList,
  TextField,
  WarningList,
  inputClass,
  labelClass,
  tinyButtonClass,
  type DealDraft,
  type DealPaymentMode,
  type OnDraftChange,
} from "@/app/_components/dealDeskShared";
import type { DealPricingContract } from "@/lib/boundary/contracts";
import { formatCents } from "@/lib/money";

/**
 * The pieces all three calculators share: CarryButton ("Use this structure"), the
 * financed-mode radios, the collapsed "Advanced" disclosure and the calculators'
 * price note.
 * 
 * Kept out of the two path modules so no calculator carries its own copy, and out of
 * the shell so opening /sales/desk does not parse an "Advanced" panel the default
 * path never renders.
 * 
 * CARRYING IS A STATE COPY, NEVER A RECOMPUTATION: the down payment and the sale price
 * the server computed are echoed back into the shared draft's inputs as plain decimal
 * strings through `centsToDecimalString`.
 */

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
export function CarryButton({
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

export function FinancedModeRadio({
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

export function AdvancedDealFields({
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

export function PricingNote({
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
