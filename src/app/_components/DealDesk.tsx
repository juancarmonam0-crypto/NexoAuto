"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useTransition } from "react";

import { evaluateDealStructuresAction } from "@/app/actions/sales";
import { WorkflowPath } from "@/app/_components/DealDesk.workflowPath";
import {
  PATH_OPTIONS,
  cardClass,
  initialDraft,
  isDealPaymentMode,
  labelClass,
  type CarrySeed,
  type DealDeskLead,
  type DealDeskProps,
  type DealDeskVehicle,
  type DealDraft,
  type DeskPath,
  type DraftPatch,
} from "@/app/_components/dealDeskShared";
import type {
  CustomerOfferContract,
  DealComparisonContract,
  PaymentBudgetResultContract,
  TargetPaymentResultContract,
} from "@/lib/boundary/contracts";
import { centsToDecimalString } from "@/lib/money";

/**
 * THE DEAL DESK — four ways in, one engine underneath.
 *
 * THE PRODUCT PRINCIPLE: BACKEND SOPHISTICATED, CALCULATOR SIMPLE.
 * A normal operator needs four things — the vehicle, how it is paid, the down
 * payment and the term. Everything else is optional and lives behind the
 * "Advanced" disclosure in every path. The four paths are:
 *
 *   1 · CALCULATE DEAL         the staged workflow (vehicle → buyer → price →
 *                              payment mode → terms → comparison → finalize)
 *   2 · TARGET MONTHLY PAYMENT "land this deal near $450 a month" — the inverse
 *                              solver, searched on the server
 *   3 · FIT A PAYMENT BUDGET   "the customer has $2,000 down and can pay $375 —
 *                              what actually fits?"
 *   4 · MAKE CUSTOMER OFFER    the SELL side, face-to-face
 *
 * This module is the SHELL. It owns the one shared controlled draft, the path
 * selector and the four path boundaries. The paths themselves live in the family
 * modules:
 *
 *   DealDesk.workflowPath.tsx     path 1 — a STATIC import, because it is the
 *                                 default: it paints with the page.
 *   DealDesk.calculators.tsx      paths 2-4 — `next/dynamic`, so an operator who
 *                                 does not choose a calculator never downloads or
 *                                 parses it. `ssr: false` is honest here: these
 *                                 are session-local forms around a server call,
 *                                 so there is nothing for the server to pre-render
 *                                 and nothing is lost by loading them on demand.
 *   DealDesk.calculatorParts.tsx  what the three calculators share.
 *   dealDeskShared.tsx            the draft vocabulary and the shared primitives.
 *
 * Only the selected path is mounted, so its ids are unique in the document, and
 * no field NAME ever exists twice in the live DOM — `FormData` can never disagree
 * with itself.
 *
 * WHAT THIS COMPONENT IS NOT
 *   - It is not a calculator. Every money figure, rate, payment, gross, ROI, gap
 *     and recommendation on this screen was computed by the engine on the server
 *     and is rendered verbatim. There is no arithmetic in this file: the only
 *     call into `@/lib/money` is `centsToDecimalString`, used to echo the
 *     SERVER's own down payment and sale price back into the shared draft when an
 *     operator carries a structure. There is no `Math.*` call here at all.
 *   - It is not a compliance authority. The rate-policy line, its `statement` and
 *     its `disclaimer` are the server's words, displayed unaltered.
 *   - It is not an underwriting or affordability decision. `FIT A PAYMENT BUDGET`
 *     answers one mathematical question across the modes and terms the operator
 *     allows; it never judges a customer. `MAKE CUSTOMER OFFER` reads only the
 *     numbers the customer STATES. No income, debt, credit or bureau data exists
 *     anywhere in this family or the engine behind it.
 *
 * ONE SET OF DEAL INPUTS, THREE SURFACES
 *   Every deal input is CONTROLLED by `draft` state. The staged workflow renders
 *   that state inside the outer `<form ref={formRef}>`, so the COMPARISON button
 *   can hand the whole deal to the server through `new FormData(form)`; the two
 *   calculator paths render their own `<form>` around their own fields, because a
 *   `<form>` may never be nested inside another.
 *
 *   Sharing one draft is what makes "Use this structure" possible: carrying an
 *   option across paths is a state copy of the mode, the term, the down payment
 *   and (for the offer path) the sale price the SERVER computed — never a
 *   recalculation.
 */

/** The placeholder shown while the calculator bundle is being fetched. */
function CalculatorLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading the selected calculator…</p>
      <div className={`${cardClass} space-y-5`}>
        <div className="space-y-2">
          <div className="h-4 w-48 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-full max-w-md animate-pulse rounded bg-slate-100" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
          <div className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-slate-200" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
          </div>
        </div>
        <div className="h-[44px] w-full max-w-xs animate-pulse rounded-lg bg-slate-200" />
      </div>
    </div>
  );
}

/**
 * PATH 2-4 — the calculator bundle, fetched the first time an operator picks one
 * of them.
 *
 * One dynamic component for all three paths on purpose: they share their
 * "Advanced" disclosure, their carry affordance and their price note, and they
 * are one contiguous block of the module they came from. The path id is a prop,
 * so switching between calculators never remounts the shell, the shared draft or
 * any result already on screen.
 *
 * `loading` is a small, calm placeholder that mirrors the calculator form's rough
 * height so choosing a path does not jump the page.
 */
const Calculators = dynamic(
  () => import("@/app/_components/DealDesk.calculators").then((module) => module.CalculatorPaths),
  { ssr: false, loading: CalculatorLoading },
);

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

  /**
   * The one read of the whole deal — every visible input, by name.
   *
   * The staged workflow owns its own form element, so the shell reads the live
   * `<form>` only while that path is the mounted one. The calculators read their
   * own forms inside their own module.
   */
  function readDeal(): FormData | null {
    const form = formRef.current;
    return form ? new FormData(form) : null;
  }

  /** PATH 1 · step 6 — the comparison, run entirely on the server. */
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

      {path !== "workflow" ? (
        <Calculators
          path={path}
          vehicles={vehicles}
          canSeeFinance={canSeeFinance}
          draft={draft}
          updateDraft={updateDraft}
          readDeal={readDeal}
          carryOption={carryOption}
          applyOffer={applyRecommendedOffer}
          targetResult={targetResult}
          setTargetResult={setTargetResult}
          targetError={targetError}
          setTargetError={setTargetError}
          budgetResult={budgetResult}
          setBudgetResult={setBudgetResult}
          budgetError={budgetError}
          setBudgetError={setBudgetError}
          offerResult={offerResult}
          setOfferResult={setOfferResult}
          offerError={offerError}
          setOfferError={setOfferError}
        />
      ) : null}
    </div>
  );
}
