import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import { cancelDealAction, completeVehicleSaleAction } from "@/app/actions/sales";
import { hasCapability } from "@/lib/auth/roles";
import { formatCents } from "@/lib/money";
import { FINANCE_TYPES } from "@/lib/operations/sales";
import { listInventory } from "@/lib/operations/inventory";
import { pageOperationContext } from "@/lib/operations/runtime";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { MoneyMetric } from "@/app/_components/MoneyMetric";
import { TrendingUp, Plus, DollarSign, CheckCircle2, ArrowRight, User, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const ctx = await pageOperationContext("deals:read");

  const [{ items: vehicles }, deals] = await Promise.all([
    listInventory(ctx, { limit: 100 }),
    ctx.db.deal.findMany({
      include: {
        vehicle: true,
        customer: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const canWrite = hasCapability(ctx.actor.role, "deals:write");
  const canSeeFinance = hasCapability(ctx.actor.role, "finance:read");

  // Filter vehicles eligible for sale
  const eligibleVehicles = vehicles.filter(
    (v) => !v.isSold && v.status !== "WHOLESALE" && v.status !== "REJECTED",
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-orange-700 uppercase tracking-widest">
            <TrendingUp className="w-4 h-4 text-orange-600" />
            <span>Deals & Revenue Ledger</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-0.5">
            SALES — Deals & Closings
          </h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Complete vehicle sales transactions, contract records, and delivery history.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 shadow-xs">
          <span className="text-slate-400">Total Deals:</span>
          <span className="font-bold text-slate-900">{deals.length} recorded</span>
        </div>
      </div>

      {/* Complete Vehicle Sale Form */}
      {canWrite ? (
        <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Plus className="w-4 h-4 text-orange-600" />
              <span>Contract & Complete Vehicle Sale</span>
            </h2>
            <span className="text-[11px] font-mono text-slate-500">Atomic transaction</span>
          </div>

          <ActionForm
            action={completeVehicleSaleAction}
            submitLabel="Finalize & Contract Sale"
            successMessage="Sale contracted and vehicle marked as SOLD!"
            buttonVariant="primary"
            buttonSize="md"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Select Vehicle <span className="text-orange-600">*</span>
                </label>
                <select
                  name="vehicleId"
                  required
                  defaultValue=""
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                >
                  <option value="" disabled>
                    Choose vehicle...
                  </option>
                  {eligibleVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.year} {v.make} {v.model} (#{v.stockNumber})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Buyer First Name <span className="text-orange-600">*</span>
                </label>
                <input
                  name="firstName"
                  required
                  placeholder="e.g. John"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Buyer Last Name
                </label>
                <input
                  name="lastName"
                  placeholder="e.g. Doe"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Buyer Phone
                </label>
                <input
                  name="phone"
                  placeholder="(512) 555-0188"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Buyer Email
                </label>
                <input
                  type="email"
                  name="email"
                  placeholder="buyer@example.com"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Final Sale Price ($) <span className="text-orange-600">*</span>
                </label>
                <input
                  name="salePrice"
                  inputMode="decimal"
                  required
                  placeholder="15500.00"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Dealer / Doc Fees ($)
                </label>
                <input
                  name="dealerFees"
                  inputMode="decimal"
                  defaultValue="150.00"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Payment / Financing
                </label>
                <select
                  name="financeType"
                  defaultValue="CASH"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                >
                  {FINANCE_TYPES.map((f) => (
                    <option key={f} value={f}>
                      {f.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </ActionForm>
        </section>
      ) : null}

      {/* Deals List */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          Deals Ledger ({deals.length})
        </h2>

        {deals.length === 0 ? (
          <div className="p-8 sm:p-12 text-center rounded-xl bg-white border border-slate-200 space-y-3 shadow-xs">
            <TrendingUp className="w-10 h-10 text-slate-400 mx-auto" />
            <h3 className="text-base font-bold text-slate-900">No deals created yet</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Finalize a new deal when a customer purchases an inventory vehicle.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {deals.map((deal) => {
              const vTitle = deal.vehicle
                ? `${deal.vehicle.year} ${deal.vehicle.make} ${deal.vehicle.model}`
                : "Vehicle N/A";
              const customerName = deal.customer
                ? `${deal.customer.firstName} ${deal.customer.lastName ?? ""}`.trim()
                : "Unknown Buyer";
              const isContracted = deal.status === "CONTRACTED";
              const isCancelled = deal.status === "CANCELLED";

              return (
                <div
                  key={deal.id}
                  className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-all"
                >
                  <div className="space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">{vTitle}</h3>
                        <div className="flex items-center gap-2 text-xs text-slate-600 mt-0.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-medium">{customerName}</span>
                          {deal.customer?.phone && (
                            <>
                              <span>•</span>
                              <span className="font-mono">{deal.customer.phone}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <StatusBadge status={deal.status} size="sm" />
                    </div>

                    {/* Financial Matrix */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-100">
                      <MoneyMetric label="Sale Price" valueCents={deal.salePriceCents} accent="orange" size="sm" />
                      <MoneyMetric label="Dealer Fees" valueCents={deal.dealerFeesCents} size="sm" />
                      <MoneyMetric
                        label="Asking Price"
                        valueCents={deal.askingPriceCents}
                        size="sm"
                      />
                    </div>
                  </div>

                  {/* Actions & Unwind */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    {deal.vehicle ? (
                      <Link
                        href={`/cars/${deal.vehicle.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-orange-600 transition-colors"
                      >
                        <span>Vehicle Record</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    ) : (
                      <div />
                    )}

                    {canWrite && isContracted && !isCancelled && (
                      <ActionForm
                        action={cancelDealAction}
                        submitLabel="Unwind / Cancel Deal"
                        successMessage="Deal cancelled and vehicle released."
                        buttonVariant="danger"
                        buttonSize="sm"
                      >
                        <input type="hidden" name="dealId" value={deal.id} />
                      </ActionForm>
                    )}

                    {isContracted && (
                      <div className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Contracted & Sold</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
