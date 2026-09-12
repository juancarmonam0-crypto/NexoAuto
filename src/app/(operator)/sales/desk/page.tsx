import Link from "next/link";
import { ArrowLeft, FileText, Gauge, Workflow } from "lucide-react";

import { DealDesk } from "@/app/_components/DealDesk";
import { FieldList } from "@/app/_components/FieldList";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { hasCapability } from "@/lib/auth/roles";
import { formatBasisPoints, formatCents } from "@/lib/money";
import { getVehicleDetail, listInventory } from "@/lib/operations/inventory";
import { listLeads } from "@/lib/operations/leads";
import { getLiveDealForVehicle } from "@/lib/operations/sales";
import { isMissingSchemaError } from "@/lib/operations";
import { pageOperationContext } from "@/lib/operations/runtime";

export const dynamic = "force-dynamic";

const labelClass = "font-mono text-[11px] font-medium uppercase tracking-wider text-slate-500";

/**
 * SALES / DEAL DESK — the operator's daily screen, one vehicle at a time.
 *
 * This page READS the operation layer and hands what it returns to the client
 * workbench. It computes nothing: the price ladder, the structures, the scores
 * and the recommendation in the COMPARISON step are produced by the Phase 9B
 * engine through `evaluateDealStructuresAction`, and the money it prints here is
 * formatted, never derived.
 *
 * There is NO Prisma access on this page, by design: `getVehicleDetail()` and
 * `getLiveDealForVehicle()` already apply the role masking, and both THROW when
 * the id does not exist. A not-found vehicle is therefore a NotFoundError the
 * app's error boundary renders — not a silently empty desk. They are called only
 * when a `vehicleId` was supplied, so a capability they require can never be
 * asserted for an operator who simply opened the desk.
 *
 * PHASE 9B/9C GAP: DOCUMENTS.
 * There is no document operation anywhere on the boundary — nothing lists,
 * uploads, verifies or generates a document or a contract. This page therefore
 * renders an honest empty state instead of inventing a document checklist, and
 * it does not generate contracts. See the DOCUMENTS section below.
 */

/** The header identity of the vehicle currently on the desk. */
function vehicleTitle(vehicle: {
  year: number;
  make: string;
  model: string;
  trim: string | null;
}): string {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ");
}

/** `DealTermsView` timestamps are ISO strings; a date is friendlier on a desk. */
function dateOnly(iso: string | null): string | null {
  if (iso === null) return null;
  return iso.slice(0, 10);
}

export default async function DealDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicleId?: string; leadId?: string; customerId?: string }>;
}) {
  const ctx = await pageOperationContext("deals:read");
  const params = await searchParams;
  const vehicleId = params.vehicleId;

  const { items: vehicles } = await listInventory(ctx, { limit: 100 });
  const { items: leads } = await listLeads(ctx, { limit: 100, openOnly: true });

  // Both reads are guarded by the presence of an id: `getVehicleDetail` asserts
  // `inventory:read` and `getLiveDealForVehicle` asserts `deals:read`, so calling
  // them unconditionally would be a capability decision this page has no business
  // making. A throw from either is left to propagate.
  const detail = vehicleId ? await getVehicleDetail(ctx, vehicleId) : null;

  // CODE AND SCHEMA DEPLOY SEPARATELY (Phase 9D). The Phase 9 code can reach
  // production BEFORE migration 0006 is applied there. The deal-terms read then
  // fails on a column the database does not have yet, and that must degrade into
  // an honest notice instead of a 500 — with nothing written and nothing guessed.
  // Any other error is re-thrown untouched.
  let liveDeal: Awaited<ReturnType<typeof getLiveDealForVehicle>> = null;
  let dealTermsAvailable = true;
  if (vehicleId) {
    try {
      liveDeal = await getLiveDealForVehicle(ctx, vehicleId);
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
      dealTermsAvailable = false;
    }
  }

  const canWrite = hasCapability(ctx.actor.role, "deals:write");
  const canSeeFinance = hasCapability(ctx.actor.role, "finance:read");

  const selected = detail?.vehicle ?? null;
  const title = selected ? vehicleTitle(selected) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2">
            <Link
              href="/sales"
              className="inline-flex min-h-[40px] items-center gap-1 font-mono text-xs font-bold uppercase tracking-widest text-orange-700 hover:text-orange-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>SALES</span>
            </Link>
          </nav>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            DEAL DESK
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Structure one deal end to end: pick the vehicle, the buyer and the price, choose how it is
            paid, then let the server score every structure.
          </p>
          {selected && title ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-900">{title}</span>
              <StatusBadge status={selected.listingStatus} size="sm" />
              {selected.stockNumber ? (
                <span className="font-mono text-[11px] text-slate-500">stock {selected.stockNumber}</span>
              ) : null}
              <span className="font-mono text-[11px] text-slate-500">
                asking {formatCents(selected.askingPriceCents)}
              </span>
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              No vehicle is on the desk yet — pick one in step 1.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 shadow-xs">
            role: <span className="font-bold text-slate-900">{ctx.actor.role}</span>
          </span>
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 shadow-xs">
            {canWrite ? "can contract a sale" : "read-only: cannot contract"}
          </span>
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 shadow-xs">
            {canSeeFinance ? "cost basis visible" : "cost basis hidden"}
          </span>
        </div>
      </div>

      {/* The workbench */}
      <DealDesk
        vehicles={vehicles.map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicleTitle(vehicle)}${vehicle.stockNumber ? ` (#${vehicle.stockNumber})` : ""}`,
          askingPriceCents: vehicle.askingPriceCents,
          status: vehicle.status,
        }))}
        leads={leads.map((lead) => ({
          id: lead.id,
          name: `${lead.customer.firstName} ${lead.customer.lastName ?? ""}`.trim() || "Unnamed customer",
        }))}
        selectedVehicleId={vehicleId ?? null}
        selectedLeadId={params.leadId ?? null}
        canWrite={canWrite}
        canSeeFinance={canSeeFinance}
      />

      {/* MIGRATION NOTICE — code and schema deploy separately (Phase 9D) */}
      {!dealTermsAvailable ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900 shadow-xs">
          <p className="font-semibold">Recorded deal terms are unavailable on this deployment.</p>
          <p className="mt-1">
            This database has not received the deal-structuring migration
            (<span className="font-mono">0006_deal_structuring_and_finance</span>) yet, so a stored deal cannot be
            read. Nothing was changed and no figure is being guessed. The calculators below still work from the
            vehicle&apos;s own data; the recorded terms will appear once the migration is applied.
          </p>
        </section>
      ) : null}

      {/* WORKFLOW — the recorded deal on this vehicle, when one exists */}
      {liveDeal ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-900">
              <Workflow className="h-4 w-4 text-orange-600" />
              <span>Workflow</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={liveDeal.status} size="md" />
              <span className="font-mono text-[11px] text-slate-500">deal {liveDeal.dealId}</span>
            </div>
          </div>

          <div className="mt-4 space-y-5">
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-orange-700">
                <Gauge className="h-3.5 w-3.5" />
                <span>Recorded deal</span>
              </h3>
              <FieldList
                columns={3}
                fields={[
                  { label: "Buyer", value: liveDeal.customerName || "Not recorded" },
                  { label: "Financing type", value: liveDeal.financeType.replace(/_/g, " ") },
                  { label: "Lender", value: liveDeal.lenderName },
                  { label: "Negotiated price", value: formatCents(liveDeal.negotiatedPriceCents), mono: true },
                  { label: "Sale price", value: formatCents(liveDeal.salePriceCents), mono: true },
                  { label: "Dealer fees", value: formatCents(liveDeal.dealerFeesCents), mono: true },
                  { label: "Sales tax", value: formatCents(liveDeal.salesTaxCents), mono: true },
                  { label: "Trade-in allowance", value: formatCents(liveDeal.tradeInAllowanceCents), mono: true },
                  { label: "Trade-in payoff", value: formatCents(liveDeal.tradeInPayoffCents), mono: true },
                  { label: "Sale date", value: dateOnly(liveDeal.saleDateIso), mono: true },
                  { label: "Delivery date", value: dateOnly(liveDeal.deliveryDateIso), mono: true },
                ]}
              />
            </div>

            <div className="space-y-3 border-t border-slate-100 pt-4">
              <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-orange-700">
                Payment terms
              </h3>
              <FieldList
                columns={3}
                fields={[
                  { label: "Down payment", value: formatCents(liveDeal.downPaymentCents), mono: true },
                  { label: "Amount financed", value: formatCents(liveDeal.amountFinancedCents), mono: true },
                  { label: "APR", value: formatBasisPoints(liveDeal.aprBasisPoints, 2), mono: true },
                  { label: "Term", value: liveDeal.termMonths === null ? null : `${liveDeal.termMonths} months`, mono: true },
                  {
                    label: "Payment frequency",
                    value: liveDeal.paymentFrequency.replace(/_/g, " "),
                  },
                  { label: "Number of payments", value: liveDeal.numberOfPayments, mono: true },
                  { label: "Payment amount", value: formatCents(liveDeal.paymentAmountCents), mono: true },
                  { label: "Final payment", value: formatCents(liveDeal.finalPaymentCents), mono: true },
                  { label: "First payment date", value: dateOnly(liveDeal.firstPaymentDateIso), mono: true },
                  { label: "Finance charge", value: formatCents(liveDeal.financeChargeCents), mono: true },
                  { label: "Total of payments", value: formatCents(liveDeal.totalOfPaymentsCents), mono: true },
                  { label: "Remaining balance", value: formatCents(liveDeal.remainingBalanceCents), mono: true },
                ]}
              />
            </div>

            {liveDeal.financeType === "LEASE" || liveDeal.financeType === "LEASE_TO_OWN" ? (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-orange-700">
                  Lease terms
                </h3>
                <FieldList
                  columns={3}
                  fields={[
                    { label: "Capitalized cost", value: formatCents(liveDeal.capitalizedCostCents), mono: true },
                    { label: "Cap cost reduction", value: formatCents(liveDeal.capCostReductionCents), mono: true },
                    { label: "Residual value", value: formatCents(liveDeal.residualValueCents), mono: true },
                    {
                      label: "Money factor as APR",
                      value: formatBasisPoints(liveDeal.moneyFactorAprBasisPoints, 2),
                      mono: true,
                    },
                    { label: "Purchase option", value: formatCents(liveDeal.purchaseOptionCents), mono: true },
                  ]}
                />
              </div>
            ) : null}

            <div className="space-y-3 border-t border-slate-100 pt-4">
              <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-orange-700">
                Official workflow
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <span className={labelClass}>Title work</span>
                <StatusBadge status={liveDeal.titleWorkStatus.replace(/_/g, " ")} size="sm" />
                <span className={labelClass}>Registration</span>
                <StatusBadge status={liveDeal.registrationStatus.replace(/_/g, " ")} size="sm" />
              </div>
              <FieldList
                columns={2}
                fields={[
                  { label: "Official notes", value: liveDeal.officialNotes },
                  { label: "Deal notes", value: liveDeal.notes },
                  {
                    label: "Rate policy applied",
                    value: liveDeal.ratePolicyId,
                    note: liveDeal.ratePolicyEvaluatedAtIso
                      ? `evaluated ${dateOnly(liveDeal.ratePolicyEvaluatedAtIso)}`
                      : null,
                    mono: true,
                  },
                  {
                    label: "Rate policy ceiling",
                    value:
                      liveDeal.ratePolicyCeilingBasisPoints === null
                        ? null
                        : formatBasisPoints(liveDeal.ratePolicyCeilingBasisPoints, 2),
                    note: "configured maximum, not a compliance determination",
                    mono: true,
                  },
                ]}
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* DOCUMENTS */}
      {/* PHASE 9B/9C GAP: no document operation exists on the boundary. Nothing  */}
      {/* lists, uploads, verifies or generates a document or a contract, so this */}
      {/* panel states that plainly instead of inventing a checklist.            */}
      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-5 shadow-xs">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-900">
          <FileText className="h-4 w-4 text-slate-400" />
          <span>Documents</span>
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          Document tracking is not available yet — no backend operation lists, uploads or verifies
          documents.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          PHASE 9B/9C GAP: the deal record, the terms and the rate-policy snapshot above are the whole
          record. Nothing here generates a contract.
        </p>
      </section>
    </div>
  );
}
