import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import { publishVehicleAction, unpublishVehicleAction } from "@/app/actions/cars";
import { hasCapability } from "@/lib/auth/roles";
import { formatCents } from "@/lib/money";
import { listInventory } from "@/lib/operations/inventory";
import { pageOperationContext } from "@/lib/operations/runtime";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { MoneyMetric } from "@/app/_components/MoneyMetric";
import { Car, Plus, ChevronRight, Clock, DollarSign, ArrowRight, Eye, EyeOff, ShoppingBag } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CarsPage() {
  const ctx = await pageOperationContext("inventory:read");

  const [activeRes, allRes] = await Promise.all([
    listInventory(ctx, { listingStatus: "ACTIVE", limit: 50 }),
    listInventory(ctx, { limit: 100 }),
  ]);

  const vehicles = allRes.items;
  const canPrice = hasCapability(ctx.actor.role, "pricing:write");
  const canSeeFinance = hasCapability(ctx.actor.role, "finance:read");
  const canSourcing = hasCapability(ctx.actor.role, "sourcing:write");

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-orange-700 uppercase tracking-widest">
            <Car className="w-4 h-4 text-orange-600" />
            <span>Fleet Inventory</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-0.5">
            CARS — Fleet Command
          </h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Manage reconditioning, pricing strategy, storefront publishing, and vehicle lifecycles.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 shadow-xs">
            <span className="text-slate-400">Published Active:</span>
            <span className="font-bold text-slate-900">{activeRes.total} vehicles</span>
          </div>

          {canSourcing && (
            <Link
              href="/buy"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold shadow-xs transition-colors"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Source New Vehicle</span>
            </Link>
          )}
        </div>
      </div>

      {/* Fleet Vehicles Table / Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          All Inventory ({vehicles.length})
        </h2>

        {vehicles.length === 0 ? (
          <div className="p-8 sm:p-12 text-center rounded-xl bg-white border border-slate-200 space-y-3 shadow-xs">
            <Car className="w-10 h-10 text-slate-400 mx-auto" />
            <h3 className="text-base font-bold text-slate-900">No vehicles in inventory</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Evaluate and acquire prospective vehicles in the BUY workspace to populate the fleet.
            </p>
            {canSourcing && (
              <div className="pt-2">
                <Link
                  href="/buy"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Go to BUY Sourcing</span>
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {vehicles.map((v) => {
              const isPublished = v.listingStatus === "ACTIVE";

              return (
                <div
                  key={v.id}
                  className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-all"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[11px] font-mono text-slate-400 block">
                          Stock #{v.stockNumber}
                        </span>
                        <h3 className="text-base font-bold text-slate-900">
                          {v.year} {v.make} {v.model}
                        </h3>
                        {v.trim && <p className="text-xs text-slate-500">{v.trim}</p>}
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge status={v.status} size="sm" />
                        <span className="text-[10px] font-mono text-slate-400 uppercase">
                          {v.listingStatus}
                        </span>
                      </div>
                    </div>

                    {/* Specs & Mileage */}
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase">Mileage:</span>
                        <span className="font-semibold text-slate-800">
                          {v.mileage.toLocaleString("en-US")} mi
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase">Asking Price:</span>
                        <span className="font-bold text-slate-900">
                          {v.askingPriceCents ? formatCents(v.askingPriceCents) : "—"}
                        </span>
                      </div>
                    </div>

                    {/* Economics Matrix (Masked for Sales) */}
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono p-2.5 rounded-lg bg-slate-50/50 border border-slate-100">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase">Landed Cost:</span>
                        <span className="font-medium text-slate-700">
                          {canSeeFinance ? (v.landedCostCents ? formatCents(v.landedCostCents) : "—") : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase">Est. Gross:</span>
                        <span className="font-bold text-emerald-700">
                          {canSeeFinance
                            ? v.estimatedGrossProfitCents
                              ? formatCents(v.estimatedGrossProfitCents)
                              : "—"
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <Link
                      href={`/cars/${v.id}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 transition-colors"
                    >
                      <span>Manage Record</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>

                    {canPrice && (
                      <div>
                        {isPublished ? (
                          <ActionForm
                            action={unpublishVehicleAction}
                            submitLabel="Unpublish"
                            successMessage="Vehicle unpublished from catalog."
                            buttonVariant="outline"
                            buttonSize="sm"
                          >
                            <input type="hidden" name="vehicleId" value={v.id} />
                          </ActionForm>
                        ) : (
                          <ActionForm
                            action={publishVehicleAction}
                            submitLabel="Publish"
                            successMessage="Vehicle published to live catalog!"
                            buttonVariant="success"
                            buttonSize="sm"
                          >
                            <input type="hidden" name="vehicleId" value={v.id} />
                          </ActionForm>
                        )}
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
