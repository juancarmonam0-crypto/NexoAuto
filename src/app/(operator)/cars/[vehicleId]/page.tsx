import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import {
  deleteVehiclePhotoAction,
  publishVehicleAction,
  recordReconItemAction,
  recordVehicleExpenseAction,
  setPrimaryVehiclePhotoAction,
  transitionVehicleStatusAction,
  unpublishVehicleAction,
  updateVehicleDetailsAction,
  updateVehiclePricingAction,
  uploadVehiclePhotoAction,
} from "@/app/actions/cars";
import { hasCapability } from "@/lib/auth/roles";
import { centsToDecimalString, formatBasisPoints, formatCents } from "@/lib/money";
import { EXPENSE_CATEGORIES, getVehicleDetail } from "@/lib/operations";
import { pageOperationContext } from "@/lib/operations/runtime";
import { allowedTransitions, STATUS_LABELS } from "@/lib/vehicle-status";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { MoneyMetric } from "@/app/_components/MoneyMetric";
import { VehiclePhotoGallery } from "@/app/_components/VehiclePhotoGallery";
import {
  Car,
  ChevronRight,
  DollarSign,
  Wrench,
  Camera,
  History,
  Tag,
  FileText,
  Clock,
  ExternalLink,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ vehicleId: string }>;
}

export default async function VehiclePage({ params }: PageProps) {
  const { vehicleId } = await params;
  const ctx = await pageOperationContext("inventory:read");
  const detail = await getVehicleDetail(ctx, vehicleId);
  const vehicle = detail.vehicle;

  const canWriteInventory = hasCapability(ctx.actor.role, "inventory:write");
  const canPrice = hasCapability(ctx.actor.role, "pricing:write");
  const canExpense = hasCapability(ctx.actor.role, "expenses:write");
  const canRecon = hasCapability(ctx.actor.role, "recon:write");
  const canSeeFinance = hasCapability(ctx.actor.role, "finance:read");

  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`;

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Top Command Bar */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Link href="/cars" className="hover:text-orange-600 transition-colors">
            CARS Fleet
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-800 font-semibold">{title}</span>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">{title}</h1>
              <StatusBadge status={vehicle.status} size="md" />
              <StatusBadge
                status={vehicle.listingStatus === "ACTIVE" ? "LISTED" : "UNLISTED"}
                variant={vehicle.listingStatus === "ACTIVE" ? "success" : "neutral"}
                size="md"
              />
              {detail.publiclyVisible && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-800 font-mono bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  <ExternalLink className="w-3 h-3" />
                  <span>Storefront Live</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-slate-500">
              <span>Stock #{vehicle.stockNumber}</span>
              <span>•</span>
              <span>VIN: {vehicle.vin}</span>
              <span>•</span>
              <span>{vehicle.daysInInventory ?? 0} days in stock</span>
            </div>
          </div>

          {/* Quick Publish / Unpublish Action */}
          {canPrice && (
            <div className="flex items-center gap-2">
              {vehicle.listingStatus === "ACTIVE" ? (
                <ActionForm
                  action={unpublishVehicleAction}
                  submitLabel="Unpublish Listing"
                  successMessage="Unpublished from public catalog."
                  buttonVariant="outline"
                  buttonSize="md"
                >
                  <input type="hidden" name="vehicleId" value={vehicle.id} />
                </ActionForm>
              ) : (
                <ActionForm
                  action={publishVehicleAction}
                  submitLabel="Publish to Storefront"
                  successMessage="Published to public catalog!"
                  buttonVariant="success"
                  buttonSize="md"
                >
                  <input type="hidden" name="vehicleId" value={vehicle.id} />
                </ActionForm>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Financial Overview Card */}
      <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-orange-600" />
            <span>Financial Ledger & Performance Metrics</span>
          </h2>
          <span className="text-[11px] font-mono text-slate-500">
            {canSeeFinance ? "Finance Role Authorized" : "Finance Fields Withheld"}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
          <MoneyMetric label="Asking Price" valueCents={vehicle.askingPriceCents} accent="orange" size="md" />
          <MoneyMetric label="Target Retail" valueCents={vehicle.targetRetailPriceCents} size="md" />
          <MoneyMetric label="Min Approved" valueCents={vehicle.minimumApprovedCents} size="md" />
          <MoneyMetric label="Landed Cost" valueCents={vehicle.landedCostCents} size="md" />
          <MoneyMetric label="Est. Gross" valueCents={vehicle.estimatedGrossProfitCents} size="md" />
          <MoneyMetric label="Actual Gross" valueCents={vehicle.actualGrossProfitCents} size="md" />
          <MoneyMetric
            label="ROI %"
            valueCents={null}
            roiBasisPoints={vehicle.actualRoiBasisPoints ?? vehicle.estimatedRoiBasisPoints}
            size="md"
          />
        </div>
      </section>

      {/* Main Command Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Gallery, Lifecycle & Details */}
        <div className="lg:col-span-7 space-y-6">
          {/* Photo Gallery */}
          <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Camera className="w-4 h-4 text-orange-600" />
              <span>Vehicle Gallery ({detail.photos.length} Photos)</span>
            </h2>

            <VehiclePhotoGallery photos={detail.photos} vehicleTitle={title} />

            {/* Photo Upload & Management */}
            {canWriteInventory && (
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Upload New Photo
                </span>
                <ActionForm
                  action={uploadVehiclePhotoAction}
                  submitLabel="Upload Photo"
                  successMessage="Photo uploaded successfully!"
                  buttonVariant="secondary"
                  buttonSize="sm"
                >
                  <input type="hidden" name="vehicleId" value={vehicle.id} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="file"
                      name="file"
                      aria-label="Photo image file"
                      accept="image/jpeg,image/png,image/webp"
                      required
                      className="text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
                    />
                    <input
                      name="alt"
                      aria-label="Photo alt description"
                      placeholder="Alt description text"
                      className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400"
                    />
                  </div>
                </ActionForm>

                {/* Photo List */}
                {detail.photos.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <span className="text-[11px] font-mono text-slate-500 block">Manage Uploaded Photos</span>
                    <div className="divide-y divide-slate-100 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                      {detail.photos.map((photo) => (
                        <div key={photo.id} className="p-2.5 flex items-center justify-between text-xs gap-3">
                          <span className="truncate text-slate-700 font-mono max-w-xs">
                            {photo.alt || photo.url}
                          </span>
                          <div className="flex items-center gap-2">
                            {photo.isPrimary ? (
                              <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-800 font-mono text-[10px] font-bold">
                                Primary
                              </span>
                            ) : (
                              <ActionForm
                                action={setPrimaryVehiclePhotoAction}
                                submitLabel="Make Primary"
                                buttonVariant="outline"
                                buttonSize="sm"
                              >
                                <input type="hidden" name="photoId" value={photo.id} />
                              </ActionForm>
                            )}
                            <ActionForm
                              action={deleteVehiclePhotoAction}
                              submitLabel="Delete"
                              buttonVariant="danger"
                              buttonSize="sm"
                            >
                              <input type="hidden" name="photoId" value={photo.id} />
                            </ActionForm>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Lifecycle State Transition Box */}
          {canWriteInventory && (
            <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-600" />
                <span>Lifecycle Status Control</span>
              </h2>

              <ActionForm
                action={transitionVehicleStatusAction}
                submitLabel="Transition Lifecycle Status"
                successMessage="Vehicle status updated."
                buttonVariant="primary"
                buttonSize="md"
              >
                <input type="hidden" name="vehicleId" value={vehicle.id} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="toStatus" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Target Status
                    </label>
                    <select id="toStatus"
                      name="toStatus"
                      required
                      defaultValue=""
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900"
                    >
                      <option value="" disabled>
                        Select Next Status
                      </option>
                      {allowedTransitions(vehicle.status).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]} ({s})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="note" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Status Note
                    </label>
                    <input id="note"
                      name="note"
                      placeholder="e.g. Completed recon inspection"
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400"
                    />
                  </div>
                </div>
              </ActionForm>
            </section>
          )}

          {/* Listing Details & Specifications Form */}
          {canWriteInventory && (
            <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-orange-600" />
                <span>Edit Vehicle Specifications</span>
              </h2>

              <ActionForm
                action={updateVehicleDetailsAction}
                submitLabel="Save Vehicle Details"
                successMessage="Vehicle specifications updated."
                buttonVariant="secondary"
                buttonSize="md"
              >
                <input type="hidden" name="vehicleId" value={vehicle.id} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="mileage" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Mileage
                    </label>
                    <input id="mileage"
                      name="mileage"
                      defaultValue={vehicle.mileage}
                      inputMode="numeric"
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="location" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Location
                    </label>
                    <input id="location"
                      name="location"
                      defaultValue={vehicle.location ?? ""}
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="exteriorColor" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Exterior Color
                    </label>
                    <input id="exteriorColor"
                      name="exteriorColor"
                      defaultValue={vehicle.exteriorColor ?? ""}
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="interiorColor" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Interior Color
                    </label>
                    <input id="interiorColor"
                      name="interiorColor"
                      defaultValue={vehicle.interiorColor ?? ""}
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900"
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-1">
                    <label htmlFor="description" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Public Description
                    </label>
                    <textarea id="description"
                      name="description"
                      defaultValue={vehicle.description ?? ""}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400"
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-1">
                    <label htmlFor="notes" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Internal Operator Notes
                    </label>
                    <textarea id="notes"
                      name="notes"
                      defaultValue={vehicle.notes ?? ""}
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400"
                    />
                  </div>
                </div>
              </ActionForm>
            </section>
          )}
        </div>

        {/* Right 5 Columns: Pricing, Recon, Expenses & Audit History */}
        <div className="lg:col-span-5 space-y-6">
          {/* Pricing Controls Card */}
          {canPrice && (
            <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Tag className="w-4 h-4 text-orange-600" />
                <span>Pricing Strategy</span>
              </h2>

              <ActionForm
                action={updateVehiclePricingAction}
                submitLabel="Save Pricing Strategy"
                successMessage="Vehicle pricing updated."
                buttonVariant="primary"
                buttonSize="md"
              >
                <input type="hidden" name="vehicleId" value={vehicle.id} />
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="askingPrice" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Asking Price ($)
                    </label>
                    <input id="askingPrice"
                      name="askingPrice"
                      defaultValue={
                        vehicle.askingPriceCents !== null ? centsToDecimalString(vehicle.askingPriceCents) : ""
                      }
                      inputMode="decimal"
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="targetRetail" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Target Retail Price ($)
                    </label>
                    <input id="targetRetail"
                      name="targetRetail"
                      defaultValue={
                        vehicle.targetRetailPriceCents !== null
                          ? centsToDecimalString(vehicle.targetRetailPriceCents)
                          : ""
                      }
                      inputMode="decimal"
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="minimumApproved" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                      Minimum Approved Price ($)
                    </label>
                    <input id="minimumApproved"
                      name="minimumApproved"
                      defaultValue={
                        vehicle.minimumApprovedCents !== null
                          ? centsToDecimalString(vehicle.minimumApprovedCents)
                          : ""
                      }
                      inputMode="decimal"
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900"
                    />
                  </div>
                </div>
              </ActionForm>
            </section>
          )}

          {/* Reconditioning Items */}
          {canRecon && (
            <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Wrench className="w-4 h-4 text-orange-600" />
                <span>Reconditioning Tasks</span>
              </h2>

              <ActionForm
                action={recordReconItemAction}
                submitLabel="Add Recon Item"
                successMessage="Recon item added."
                buttonVariant="secondary"
                buttonSize="sm"
              >
                <input type="hidden" name="vehicleId" value={vehicle.id} />
                <div className="space-y-3 text-xs">
                  <div>
                    <label htmlFor="issue" className="text-slate-600 font-medium block mb-1">Issue Description</label>
                    <input id="issue"
                      name="issue"
                      required
                      placeholder="e.g. Replace front brake pads"
                      className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-900"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="estimate" className="text-slate-600 font-medium block mb-1">Est. Cost ($)</label>
                      <input id="estimate"
                        name="estimate"
                        inputMode="decimal"
                        placeholder="250.00"
                        className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-mono text-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="actualCost" className="text-slate-600 font-medium block mb-1">Actual Cost ($)</label>
                      <input id="actualCost"
                        name="actualCost"
                        inputMode="decimal"
                        placeholder="240.00"
                        className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-mono text-slate-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="status" className="text-slate-600 font-medium block mb-1">Status</label>
                    <select id="status"
                      name="status"
                      defaultValue="ESTIMATED"
                      className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-900"
                    >
                      <option value="ESTIMATED">ESTIMATED</option>
                      <option value="APPROVED">APPROVED</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="COMPLETED">COMPLETED</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                  </div>
                </div>
              </ActionForm>

              {/* Recon List */}
              {detail.reconItems && detail.reconItems.length > 0 ? (
                <div className="divide-y divide-slate-100 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                  {detail.reconItems.map((item) => (
                    <div key={item.id} className="p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between font-semibold text-slate-900">
                        <span>{item.issue}</span>
                        <StatusBadge status={item.status} size="sm" />
                      </div>
                      <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
                        <span>Est: {formatCents(item.estimateCents)}</span>
                        <span>•</span>
                        <span>Actual: {formatCents(item.actualCostCents)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 font-mono text-center">No recon items logged.</p>
              )}
            </section>
          )}

          {/* Expenses Log */}
          {canExpense && (
            <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-orange-600" />
                <span>Vehicle Expenses</span>
              </h2>

              <ActionForm
                action={recordVehicleExpenseAction}
                submitLabel="Record Expense"
                successMessage="Expense logged."
                buttonVariant="secondary"
                buttonSize="sm"
              >
                <input type="hidden" name="vehicleId" value={vehicle.id} />
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="category" className="text-slate-600 font-medium block mb-1">Category</label>
                      <select id="category"
                        name="category"
                        required
                        defaultValue="PARTS"
                        className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-900"
                      >
                        {EXPENSE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="amount" className="text-slate-600 font-medium block mb-1">Amount ($)</label>
                      <input id="amount"
                        name="amount"
                        inputMode="decimal"
                        required
                        placeholder="150.00"
                        className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-mono text-slate-900"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="vendor" className="text-slate-600 font-medium block mb-1">Vendor</label>
                      <input id="vendor"
                        name="vendor"
                        placeholder="AutoZone"
                        className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="incurredOn" className="text-slate-600 font-medium block mb-1">Incurred Date</label>
                      <input id="incurredOn"
                        type="date"
                        name="incurredOn"
                        className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-900"
                      />
                    </div>
                  </div>
                </div>
              </ActionForm>

              {/* Expense List */}
              {detail.expenses && detail.expenses.length > 0 ? (
                <div className="divide-y divide-slate-100 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                  {detail.expenses.map((exp) => (
                    <div key={exp.id} className="p-2.5 text-xs flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-slate-900 block">{exp.category}</span>
                        <span className="text-[11px] font-mono text-slate-500">
                          {exp.vendor ?? "N/A"} • {exp.incurredOn.toISOString().slice(0, 10)}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-slate-900">{formatCents(exp.amountCents)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 font-mono text-center">No expenses logged.</p>
              )}
            </section>
          )}

          {/* Audit Trail History */}
          <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-orange-600" />
              <span>Status Event History</span>
            </h2>

            <div className="divide-y divide-slate-100 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden text-xs">
              {detail.statusEvents.map((evt) => (
                <div key={evt.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between font-mono text-slate-700">
                    <span>
                      {evt.fromStatus ? `${evt.fromStatus} → ` : ""}
                      <strong className="text-orange-700">{evt.toStatus}</strong>
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {evt.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                  {evt.note && <p className="text-slate-600 text-[11px]">{evt.note}</p>}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
