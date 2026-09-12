import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import { cancelDealAction, completeVehicleSaleAction } from "@/app/actions/sales";
import { hasCapability } from "@/lib/auth/roles";
import { formatBasisPoints, formatCents } from "@/lib/money";
import { FINANCE_TYPES, getLiveDealForVehicle, type DealTermsView } from "@/lib/operations/sales";
import { isMissingSchemaError } from "@/lib/operations";
import { listInventory } from "@/lib/operations/inventory";
import { CONTACT_METHODS, listLeads } from "@/lib/operations/leads";
import { leadStatusLabel } from "@/lib/lead-status";
import { pageOperationContext } from "@/lib/operations/runtime";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { MoneyMetric } from "@/app/_components/MoneyMetric";
import { TrendingUp, Plus, CheckCircle2, ArrowRight, Car, BadgeCheck, Calculator } from "lucide-react";

/** Payment period suffix, for a compact structure line. Presentation only. */
const PERIOD_SUFFIX: Record<string, string> = {
  MONTHLY: "mo",
  SEMIMONTHLY: "semi-mo",
  BIWEEKLY: "bi-wk",
  WEEKLY: "wk",
};

/**
 * SALES — deals and closings.
 *
 * READS go through the operation layer only. Completed-sale economics (final
 * price, landed cost, gross profit, ROI, days in inventory) come from the
 * vehicle view the inventory operation returns, already masked by role — this
 * page never loads a raw Deal or Customer row, and never derives a figure of
 * its own.
 *
 * Buyer identity is deliberately absent: no operation exposes it for a closed
 * deal. See the Phase 7 report — displaying it would need a new read operation.
 */

export const dynamic = "force-dynamic";

/** Days in inventory is a count, not money — it needs its own treatment. */
function DaysMetric({ days }: { days: number | null }) {
  return (
    <div className="flex flex-col space-y-0.5">
      <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-500">
        Days in inventory
      </span>
      <span className="font-mono text-sm tracking-tight text-slate-900">{days ?? "—"}</span>
    </div>
  );
}

export default async function SalesPage() {
  const ctx = await pageOperationContext("deals:read");

  const canWrite = hasCapability(ctx.actor.role, "deals:write");
  const canSeeFinance = hasCapability(ctx.actor.role, "finance:read");

  const { items: vehicles } = await listInventory(ctx, { limit: 100 });

  // Open leads are offered as sale attribution: the operation validates the
  // lead exists and links it to the deal it creates.
  const { items: openLeads } = await listLeads(ctx, { limit: 200, openOnly: true });

  // A vehicle carries its own outcome: `isSold` is true once a final sale price
  // is recorded, and `cancelDeal` clears it when a sale is unwound.
  const completed = vehicles.filter((vehicle) => vehicle.isSold);
  const onTheLot = vehicles.filter(
    (vehicle) => !vehicle.isSold && vehicle.status !== "WHOLESALE" && vehicle.status !== "REJECTED",
  );

  // CODE AND SCHEMA DEPLOY SEPARATELY (Phase 9D). The Phase 9 code can reach
  // production BEFORE migration 0006 is applied there, in which case this read
  // fails on a column the database does not have yet. That must degrade into an
  // honest notice on this page rather than a 500 — and it must never write
  // anything. Any other error is re-thrown untouched.
  let dealTermsAvailable = true;
  let dealByVehicle = new Map<string, DealTermsView | null>();
  try {
    // One contract read per vehicle. Phase 9B widened it: it now returns the
    // recorded payment structure (rate, term, payment, finance charge) as well
    // as the id and status, so a completed sale shows the terms it was written on.
    dealByVehicle = new Map(
      await Promise.all(
        [...completed, ...onTheLot].map(
          async (vehicle) => [vehicle.id, await getLiveDealForVehicle(ctx, vehicle.id)] as const,
        ),
      ),
    );
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    dealTermsAvailable = false;
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-orange-700">
            <TrendingUp className="h-4 w-4 text-orange-600" />
            <span>Deals &amp; Closings</span>
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">SALES</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Contract a sale, confirm what it actually earned, and unwind a deal if it falls through.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <Link
            href="/sales/desk"
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 font-semibold text-white shadow-xs transition-colors hover:bg-orange-700"
          >
            <Calculator className="h-3.5 w-3.5" />
            <span>Deal Desk</span>
          </Link>
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 shadow-xs">
            On the lot: <span className="font-bold text-slate-900">{onTheLot.length}</span>
          </span>
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 shadow-xs">
            Completed: <span className="font-bold text-slate-900">{completed.length}</span>
          </span>
        </div>
      </div>

      {/* Completed sales — the numbers a dealer actually reviews */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">
            Completed sales ({completed.length})
          </h2>
        </div>

        {completed.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs sm:p-12">
            <TrendingUp className="mx-auto h-10 w-10 text-slate-300" />
            <h3 className="text-base font-bold text-slate-900">No completed sales yet</h3>
            <p className="mx-auto max-w-md text-xs text-slate-500">
              Once a vehicle is sold above, its final price, real cost and actual gross profit appear here —
              calculated by the backend from the costs recorded while it was in inventory.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {completed.map((vehicle) => {
              const deal = dealByVehicle.get(vehicle.id);
              return (
                <div
                  key={vehicle.id}
                  className="flex flex-col justify-between space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition-all hover:border-slate-300 sm:p-6"
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </h3>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">
                          Stock {vehicle.stockNumber}
                          {vehicle.dateSold ? ` · sold ${vehicle.dateSold.toISOString().slice(0, 10)}` : ""}
                        </p>
                      </div>
                      <StatusBadge status="SOLD" size="sm" />
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3.5 sm:grid-cols-3">
                      <MoneyMetric
                        label="Final sale price"
                        valueCents={vehicle.finalSalePriceCents}
                        accent="orange"
                        size="sm"
                      />
                      <MoneyMetric
                        label="Landed cost"
                        valueCents={vehicle.landedCostCents}
                        masked={!canSeeFinance}
                        size="sm"
                      />
                      <MoneyMetric
                        label="Gross profit"
                        valueCents={vehicle.actualGrossProfitCents}
                        accent={vehicle.actualGrossProfitCents !== null && vehicle.actualGrossProfitCents >= 0 ? "green" : "default"}
                        masked={!canSeeFinance}
                        size="sm"
                      />
                      <MoneyMetric
                        label="ROI"
                        valueCents={null}
                        roiBasisPoints={vehicle.actualRoiBasisPoints}
                        masked={!canSeeFinance}
                        size="sm"
                      />
                      <DaysMetric days={vehicle.daysInInventory} />
                    </div>

                    {/* Phase 9B: the terms the contract was actually written on.
                        These are the buyer's disclosed figures (rate, term,
                        payment, finance charge), not dealership cost. */}
                    {deal && deal.paymentAmountCents !== null ? (
                      <p className="font-mono text-[11px] leading-relaxed text-slate-600">
                        {deal.financeType.replace(/_/g, " ")}
                        {deal.financeType !== "CASH" && deal.aprBasisPoints !== null
                          ? ` · ${formatBasisPoints(deal.aprBasisPoints, 2)} APR`
                          : ""}
                        {deal.termMonths ? ` · ${deal.termMonths} months` : ""}
                        {deal.numberOfPayments
                          ? ` · ${deal.numberOfPayments} payments`
                          : ""}
                        {deal.paymentAmountCents
                          ? ` · ${formatCents(deal.paymentAmountCents)}/${PERIOD_SUFFIX[deal.paymentFrequency] ?? "period"}`
                          : ""}
                        {deal.financeChargeCents
                          ? ` · finance charge ${formatCents(deal.financeChargeCents)}`
                          : ""}
                      </p>
                    ) : null}

                    {!canSeeFinance ? (
                      <p className="text-[11px] text-slate-500">
                        Cost and profit are shown to owners and managers only.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <Link
                      href={`/cars/${vehicle.id}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 transition-colors hover:text-orange-600"
                    >
                      <span>Vehicle record</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>

                    {canWrite && deal ? (
                      <ActionForm
                        action={cancelDealAction}
                        submitLabel="Unwind sale"
                        successMessage="Deal cancelled and the vehicle is back on the lot."
                        buttonVariant="danger"
                        buttonSize="sm"
                      >
                        <input type="hidden" name="dealId" value={deal.dealId} />
                      </ActionForm>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Contract & complete a sale */}
      {!dealTermsAvailable ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900 shadow-xs">
          <p className="font-semibold">Recorded deal terms are unavailable on this deployment.</p>
          <p className="mt-1">
            This database has not received the deal-structuring migration
            (<span className="font-mono">0006_deal_structuring_and_finance</span>) yet, so the stored payment
            terms, rate and finance charge cannot be read. Nothing was changed and no figure is being guessed.
            Sales can still be recorded; the terms will appear once the migration is applied.
          </p>
        </section>
      ) : null}

      {canWrite ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-900">
              <Plus className="h-4 w-4 text-orange-600" />
              <span>Contract &amp; complete a sale</span>
            </h2>
            <span className="font-mono text-[11px] text-slate-500">Atomic transaction</span>
          </div>

          <ActionForm
            action={completeVehicleSaleAction}
            submitLabel="Finalize & contract sale"
            successMessage="Sale contracted and the vehicle is marked SOLD."
            buttonVariant="primary"
            buttonSize="md"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1 sm:col-span-2">
                <label
                  htmlFor="sale-vehicle"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Vehicle <span className="text-orange-600">*</span>
                </label>
                <select
                  id="sale-vehicle"
                  name="vehicleId"
                  required
                  defaultValue=""
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                >
                  <option value="" disabled>
                    Choose vehicle…
                  </option>
                  {onTheLot.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.year} {vehicle.make} {vehicle.model} (#{vehicle.stockNumber}) —{" "}
                      {formatCents(vehicle.askingPriceCents)}
                    </option>
                  ))}
                </select>
                {onTheLot.length === 0 ? (
                  <p className="text-[11px] text-amber-700">
                    Nothing is available to sell. Publish a vehicle in CARS first.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sale-first-name"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Buyer first name <span className="text-orange-600">*</span>
                </label>
                <input
                  id="sale-first-name"
                  name="firstName"
                  required
                  autoComplete="given-name"
                  placeholder="e.g. John"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sale-last-name"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Buyer last name
                </label>
                <input
                  id="sale-last-name"
                  name="lastName"
                  autoComplete="family-name"
                  placeholder="e.g. Doe"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sale-phone"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Buyer phone
                </label>
                <input
                  id="sale-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(512) 555-0188"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sale-email"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Buyer email
                </label>
                <input
                  id="sale-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="buyer@example.com"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sale-price"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Final sale price ($) <span className="text-orange-600">*</span>
                </label>
                <input
                  id="sale-price"
                  name="salePrice"
                  inputMode="decimal"
                  required
                  placeholder="15500.00"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sale-fees"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Dealer / doc fees ($)
                </label>
                <input
                  id="sale-fees"
                  name="dealerFees"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sale-finance"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Payment / financing
                </label>
                <select
                  id="sale-finance"
                  name="financeType"
                  defaultValue="CASH"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                >
                  {FINANCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sale-preferred-contact"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Preferred contact
                </label>
                <select
                  id="sale-preferred-contact"
                  name="preferredContact"
                  defaultValue="ANY"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                >
                  {CONTACT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sale-date"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Sale date
                </label>
                <input
                  id="sale-date"
                  name="saleDate"
                  type="date"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
                <p className="text-[11px] text-slate-500">Leave blank to use today.</p>
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label
                  htmlFor="sale-lead"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Attribute to a lead
                </label>
                <select
                  id="sale-lead"
                  name="leadId"
                  defaultValue=""
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                >
                  <option value="">Not linked to a lead</option>
                  {openLeads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.customer.firstName} {lead.customer.lastName ?? ""} — {leadStatusLabel(lead.status)}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  Linking the deal keeps the inquiry and the sale on the same record.
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="sale-notes"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
              >
                Deal notes
              </label>
              <textarea
                id="sale-notes"
                name="notes"
                rows={2}
                placeholder="Trade-in accepted, lender approved, delivery arranged…"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Buyer name, phone or email must be supplied — a customer record is created for the sale and the
              database enforces that at least one contact method exists.
            </p>
          </ActionForm>
        </section>
      ) : null}

      {/* On the lot */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Car className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">
            On the lot ({onTheLot.length})
          </h2>
        </div>

        {onTheLot.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs sm:p-12">
            <Car className="mx-auto h-10 w-10 text-slate-300" />
            <h3 className="text-base font-bold text-slate-900">Nothing is ready to sell</h3>
            <p className="mx-auto max-w-md text-xs text-slate-500">
              Publish a vehicle from CARS and it will appear here, ready to contract.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {onTheLot.map((vehicle) => {
              const deal = dealByVehicle.get(vehicle.id);
              return (
                <div
                  key={vehicle.id}
                  className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </h3>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">
                          Stock {vehicle.stockNumber} · {vehicle.mileage.toLocaleString("en-US")} mi
                        </p>
                      </div>
                      <StatusBadge status={vehicle.listingStatus} size="sm" />
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <MoneyMetric
                        label="Asking"
                        valueCents={vehicle.askingPriceCents}
                        accent="orange"
                        size="sm"
                      />
                      <DaysMetric days={vehicle.daysInInventory} />
                    </div>

                    {deal ? (
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <CheckCircle2 className="h-3.5 w-3.5 text-amber-600" />
                        <span>
                          Live deal <StatusBadge status={deal.status} size="sm" />
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <Link
                      href={`/cars/${vehicle.id}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 transition-colors hover:text-orange-600"
                    >
                      <span>Vehicle record</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>

                    {canWrite && deal ? (
                      <ActionForm
                        action={cancelDealAction}
                        submitLabel="Cancel deal"
                        successMessage="Deal cancelled and the vehicle released."
                        buttonVariant="outline"
                        buttonSize="sm"
                      >
                        <input type="hidden" name="dealId" value={deal.dealId} />
                      </ActionForm>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
