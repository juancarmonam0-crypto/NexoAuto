import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm } from "@/app/_components/ActionForm";
import {
  deleteVehiclePhotoAction,
  publishVehicleAction,
  recordReconItemAction,
  recordVehicleExpenseAction,
  setPrimaryVehiclePhotoAction,
  transitionVehicleStatusAction,
  unpublishVehicleAction,
  updateReconItemAction,
  updateVehicleAcquisitionAction,
  updateVehicleDetailsAction,
  updateVehiclePricingAction,
  uploadVehiclePhotoAction,
} from "@/app/actions/cars";
import { cancelDealAction } from "@/app/actions/sales";
import { DetailTabs, type DetailTab } from "@/app/_components/DetailTabs";
import { FieldList } from "@/app/_components/FieldList";
import { MoneyMetric } from "@/app/_components/MoneyMetric";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { Timeline, type TimelineEntry } from "@/app/_components/Timeline";
import { VehiclePhotoGallery } from "@/app/_components/VehiclePhotoGallery";
import { hasCapability } from "@/lib/auth/roles";
import { centsToDecimalString, formatBasisPoints, formatCents } from "@/lib/money";
import {
  ACQUISITION_SOURCES,
  EXPENSE_CATEGORIES,
  RECON_STATUSES,
  TITLE_STATUSES,
  getVehicleDetail,
  getLiveDealForVehicle,
} from "@/lib/operations";
import { pageOperationContext } from "@/lib/operations/runtime";
import { allowedTransitions, STATUS_LABELS } from "@/lib/vehicle-status";
import {
  ArrowRight,
  Camera,
  Car,
  ChevronRight,
  Clock,
  DollarSign,
  ExternalLink,
  EyeOff,
  FileText,
  History,
  Tag,
  Wrench,
} from "lucide-react";

/**
 * Vehicle command center.
 *
 * One screen used to hold every form the vehicle has. It now shows ONE section
 * at a time, chosen by `?tab=`, so an operator working on reconditioning is not
 * scrolling past pricing and photo upload to find it.
 *
 * The tab is URL state, not client state: every section is deep-linkable, the
 * back button works, and this stays a server component with no client bundle
 * beyond the existing form/gallery primitives.
 *
 * Money is FORMATTED here, never computed. The backend returns cents and
 * already-masked figures; a `null` means "not recorded" or "withheld by role"
 * and is rendered as such, never as zero.
 */

export const dynamic = "force-dynamic";

const TAB_KEYS = [
  "overview",
  "economics",
  "recon",
  "expenses",
  "photos",
  "deal",
  "documents",
  "history",
] as const;

type VehicleTab = (typeof TAB_KEYS)[number];

const CARD = "rounded-xl border border-slate-200 bg-white p-5 shadow-xs";
const SECTION_LABEL = "font-mono text-[11px] font-bold uppercase tracking-widest text-orange-700";
const FIELD_LABEL = "mb-1 block font-mono text-[11px] font-medium uppercase tracking-wider text-slate-500";
const INPUT =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500";
const MONO_INPUT = `${INPUT} font-mono`;
const CHIP = "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px]";

interface PageProps {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className={`flex items-center gap-2 border-b border-slate-100 pb-3 ${SECTION_LABEL}`}>
      {icon}
      <span>{children}</span>
    </h2>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}

/** Dates are formatted for display only; no date arithmetic happens here. */
function formatDateOnly(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function formatDateTime(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

/** Presentation-only tone mapping for the activity timeline. */
function timelineTone(status: string): TimelineEntry["tone"] {
  if (status === "REJECTED") return "danger";
  if (status === "SOLD" || status === "DELIVERED" || status === "WHOLESALE") return "success";
  if (status === "READY" || status === "LISTED" || status === "RESERVED") return "progress";
  return "neutral";
}

export default async function VehiclePage({ params, searchParams }: PageProps) {
  const { vehicleId } = await params;

  const ctx = await pageOperationContext("inventory:read");
  const detail = await getVehicleDetail(ctx, vehicleId);
  const vehicle = detail.vehicle;

  // Rendering gates only. The server re-checks every capability on every action;
  // hiding a control is not authorization.
  const canWriteInventory = hasCapability(ctx.actor.role, "inventory:write");
  const canPrice = hasCapability(ctx.actor.role, "pricing:write");
  const canExpense = hasCapability(ctx.actor.role, "expenses:write");
  const canRecon = hasCapability(ctx.actor.role, "recon:write");
  const canSeeFinance = hasCapability(ctx.actor.role, "finance:read");
  const canWriteDeals = hasCapability(ctx.actor.role, "deals:write");
  // `getLiveDealForVehicle` asserts `deals:read`, which RECON does not hold, so the
  // read is gated here instead of turning the page into an error for that role.
  const canReadDeals = hasCapability(ctx.actor.role, "deals:read");

  const requestedTab = (await searchParams).tab;
  const tab: VehicleTab = TAB_KEYS.includes(requestedTab as VehicleTab)
    ? (requestedTab as VehicleTab)
    : "overview";

  const deal = canReadDeals ? await getLiveDealForVehicle(ctx, vehicleId) : null;

  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`;
  const transitions = allowedTransitions(vehicle.status);

  const tabs: readonly DetailTab[] = [
    { key: "overview", label: "Overview" },
    { key: "economics", label: "Economics" },
    { key: "recon", label: "Recon", count: detail.reconItems?.length },
    { key: "expenses", label: "Expenses", count: detail.expenses?.length },
    { key: "photos", label: "Photos", count: detail.photos.length },
    { key: "deal", label: "Deal" },
    { key: "documents", label: "Documents" },
    { key: "history", label: "History" },
  ];

  const timelineEntries: TimelineEntry[] = detail.statusEvents.map((event) => ({
    id: event.id,
    title: event.fromStatus ? `${event.fromStatus} → ${event.toStatus}` : event.toStatus,
    timestamp: formatDateTime(event.createdAt),
    body: event.note,
    tone: timelineTone(event.toStatus),
  }));

  return (
    <div className="space-y-5">
      {/* Command bar — identity and lifecycle at a glance, on every tab. */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Link href="/cars" className="transition-colors hover:text-orange-600">
            CARS Fleet
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span className="font-mono text-slate-700">{vehicle.stockNumber}</span>
        </div>

        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
              <StatusBadge status={vehicle.status} size="md" />
              <StatusBadge
                status={vehicle.listingStatus}
                variant={vehicle.listingStatus === "ACTIVE" ? "success" : "neutral"}
                size="md"
              />
              {detail.publiclyVisible ? (
                <span className={`${CHIP} border-emerald-200 bg-emerald-50 text-emerald-800`}>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  <span>Storefront live</span>
                </span>
              ) : (
                <span className={`${CHIP} border-slate-200 bg-slate-50 text-slate-500`}>
                  <EyeOff className="h-3 w-3" aria-hidden="true" />
                  <span>Not public</span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-500">
              <span>Stock #{vehicle.stockNumber}</span>
              <span aria-hidden="true">•</span>
              <span>VIN {vehicle.vin}</span>
              <span aria-hidden="true">•</span>
              <span>{vehicle.mileage.toLocaleString("en-US")} mi</span>
              <span aria-hidden="true">•</span>
              <span>
                {vehicle.daysInInventory === null
                  ? "days in stock not recorded"
                  : `${vehicle.daysInInventory} days in stock`}
              </span>
            </div>
          </div>

          {detail.publiclyVisible ? (
            <Link
              href={`/inventory/${vehicle.id}`}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <span>View public listing</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <Link
              href="/inventory"
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <span>Public catalog</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      <DetailTabs basePath={`/cars/${vehicle.id}`} tabs={tabs} active={tab} />

      {/* ---------------------------------------------------------------- */}
      {/* OVERVIEW                                                          */}
      {/* ---------------------------------------------------------------- */}
      {tab === "overview" ? (
        <div className="space-y-5">
          <section className={`${CARD} space-y-4`}>
            <SectionTitle icon={<Car className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
              Identity &amp; specifications
            </SectionTitle>
            <FieldList
              columns={3}
              fields={[
                { label: "Year", value: vehicle.year, mono: true },
                { label: "Make", value: vehicle.make },
                { label: "Model", value: vehicle.model },
                { label: "Trim", value: vehicle.trim },
                { label: "VIN", value: vehicle.vin, mono: true },
                { label: "Stock number", value: vehicle.stockNumber, mono: true },
                { label: "Mileage", value: `${vehicle.mileage.toLocaleString("en-US")} mi`, mono: true },
                { label: "Exterior colour", value: vehicle.exteriorColor },
                { label: "Interior colour", value: vehicle.interiorColor },
                { label: "Engine", value: vehicle.engine },
                { label: "Transmission", value: vehicle.transmission },
                { label: "Drivetrain", value: vehicle.drivetrain },
                { label: "Fuel type", value: vehicle.fuelType },
                { label: "Body type", value: vehicle.bodyType },
                { label: "Doors", value: vehicle.doors, mono: true },
                { label: "Seats", value: vehicle.seats, mono: true },
                { label: "Title status", value: vehicle.titleStatus },
                {
                  label: "Equipment / features",
                  value: vehicle.features.length > 0 ? vehicle.features.join(", ") : null,
                },
              ]}
            />
          </section>

          <section className={`${CARD} space-y-4`}>
            <SectionTitle icon={<Clock className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
              Lifecycle &amp; listing
            </SectionTitle>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={vehicle.status} size="md" />
              <span className="font-mono text-xs text-slate-500">{vehicle.listingStatus}</span>
              <span
                className={`${CHIP} ${
                  detail.publiclyVisible
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                {detail.publiclyVisible ? "Visible on the public catalog" : "Not publicly visible"}
              </span>
            </div>

            <FieldList
              columns={2}
              fields={[
                { label: "Lifecycle status", value: STATUS_LABELS[vehicle.status] ?? vehicle.status, note: vehicle.status },
                { label: "Listing status", value: vehicle.listingStatus },
                { label: "Location", value: vehicle.location },
                {
                  label: "Days in inventory",
                  value: vehicle.daysInInventory,
                  mono: true,
                },
              ]}
            />

            {canWriteInventory ? (
              transitions.length > 0 ? (
                <ActionForm
                  action={transitionVehicleStatusAction}
                  submitLabel="Transition lifecycle status"
                  successMessage="Vehicle status updated."
                  buttonVariant="primary"
                  buttonSize="md"
                  className="border-t border-slate-100 pt-4"
                >
                  <input type="hidden" name="vehicleId" value={vehicle.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field id="transition-toStatus" label="Target status">
                      <select
                        id="transition-toStatus"
                        name="toStatus"
                        required
                        defaultValue=""
                        className={INPUT}
                      >
                        <option value="" disabled>
                          Select next status
                        </option>
                        {transitions.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]} ({status})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id="transition-note" label="Status note" hint="Recorded on the vehicle history.">
                      <input
                        id="transition-note"
                        name="note"
                        placeholder="e.g. Completed recon inspection"
                        className={INPUT}
                      />
                    </Field>
                  </div>
                </ActionForm>
              ) : (
                <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">
                  No further lifecycle transitions are available from {STATUS_LABELS[vehicle.status] ?? vehicle.status}.
                </p>
              )
            ) : (
              <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">
                Changing the lifecycle status requires inventory write authority.
              </p>
            )}

            {canPrice ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                {vehicle.listingStatus === "ACTIVE" ? (
                  <ActionForm
                    action={unpublishVehicleAction}
                    submitLabel="Unpublish listing"
                    successMessage="Unpublished from the public catalog."
                    buttonVariant="outline"
                    buttonSize="sm"
                  >
                    <input type="hidden" name="vehicleId" value={vehicle.id} />
                  </ActionForm>
                ) : (
                  <ActionForm
                    action={publishVehicleAction}
                    submitLabel="Publish to storefront"
                    successMessage="Published to the public catalog."
                    buttonVariant="success"
                    buttonSize="sm"
                  >
                    <input type="hidden" name="vehicleId" value={vehicle.id} />
                  </ActionForm>
                )}
                <p className="text-[11px] text-slate-500">
                  Publishing sets the LISTED lifecycle state and needs a positive asking price.
                </p>
              </div>
            ) : null}
          </section>

          <section className={`${CARD} space-y-4`}>
            <SectionTitle icon={<FileText className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
              Description &amp; internal notes
            </SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <span className={FIELD_LABEL}>Public description</span>
                {vehicle.description ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{vehicle.description}</p>
                ) : (
                  <p className="text-sm text-slate-400">Not recorded</p>
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <span className={FIELD_LABEL}>Internal operator notes</span>
                {vehicle.notes ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{vehicle.notes}</p>
                ) : (
                  <p className="text-sm text-slate-400">Not recorded</p>
                )}
              </div>
            </div>
          </section>

          {canWriteInventory ? (
            <section className={`${CARD} space-y-4`}>
              <SectionTitle icon={<FileText className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
                Edit descriptive details
              </SectionTitle>

              <ActionForm
                action={updateVehicleDetailsAction}
                submitLabel="Save vehicle details"
                successMessage="Vehicle details updated."
                buttonVariant="secondary"
                buttonSize="md"
              >
                <input type="hidden" name="vehicleId" value={vehicle.id} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="vd-trim" label="Trim">
                    <input id="vd-trim" name="trim" defaultValue={vehicle.trim ?? ""} className={INPUT} />
                  </Field>
                  <Field id="vd-mileage" label="Mileage">
                    <input
                      id="vd-mileage"
                      name="mileage"
                      defaultValue={vehicle.mileage}
                      inputMode="numeric"
                      className={MONO_INPUT}
                    />
                  </Field>
                  <Field id="vd-exteriorColor" label="Exterior colour">
                    <input
                      id="vd-exteriorColor"
                      name="exteriorColor"
                      defaultValue={vehicle.exteriorColor ?? ""}
                      className={INPUT}
                    />
                  </Field>
                  <Field id="vd-interiorColor" label="Interior colour">
                    <input
                      id="vd-interiorColor"
                      name="interiorColor"
                      defaultValue={vehicle.interiorColor ?? ""}
                      className={INPUT}
                    />
                  </Field>
                  <Field id="vd-engine" label="Engine">
                    <input id="vd-engine" name="engine" defaultValue={vehicle.engine ?? ""} className={INPUT} />
                  </Field>
                  <Field id="vd-transmission" label="Transmission">
                    <input
                      id="vd-transmission"
                      name="transmission"
                      defaultValue={vehicle.transmission ?? ""}
                      className={INPUT}
                    />
                  </Field>
                  <Field id="vd-drivetrain" label="Drivetrain">
                    <input
                      id="vd-drivetrain"
                      name="drivetrain"
                      defaultValue={vehicle.drivetrain ?? ""}
                      className={INPUT}
                    />
                  </Field>
                  <Field id="vd-fuelType" label="Fuel type">
                    <input id="vd-fuelType" name="fuelType" defaultValue={vehicle.fuelType ?? ""} className={INPUT} />
                  </Field>
                  <Field id="vd-bodyType" label="Body type">
                    <input id="vd-bodyType" name="bodyType" defaultValue={vehicle.bodyType ?? ""} className={INPUT} />
                  </Field>
                  <Field id="vd-location" label="Location">
                    <input id="vd-location" name="location" defaultValue={vehicle.location ?? ""} className={INPUT} />
                  </Field>
                  <Field id="vd-doors" label="Doors">
                    <input
                      id="vd-doors"
                      name="doors"
                      defaultValue={vehicle.doors ?? ""}
                      inputMode="numeric"
                      className={MONO_INPUT}
                    />
                  </Field>
                  <Field id="vd-seats" label="Seats">
                    <input
                      id="vd-seats"
                      name="seats"
                      defaultValue={vehicle.seats ?? ""}
                      inputMode="numeric"
                      className={MONO_INPUT}
                    />
                  </Field>
                  <Field id="vd-titleStatus" label="Title status">
                    <select
                      id="vd-titleStatus"
                      name="titleStatus"
                      defaultValue={vehicle.titleStatus}
                      className={INPUT}
                    >
                      {TITLE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="vd-features" label="Equipment / features (comma separated)">
                    <input
                      id="vd-features"
                      name="features"
                      defaultValue={vehicle.features.join(", ")}
                      placeholder="Sunroof, Heated seats, Backup camera"
                      className={INPUT}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field id="vd-description" label="Public description">
                      <textarea
                        id="vd-description"
                        name="description"
                        defaultValue={vehicle.description ?? ""}
                        rows={3}
                        className={INPUT}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field id="vd-notes" label="Internal operator notes">
                      <textarea
                        id="vd-notes"
                        name="notes"
                        defaultValue={vehicle.notes ?? ""}
                        rows={2}
                        className={INPUT}
                      />
                    </Field>
                  </div>
                </div>
              </ActionForm>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* ECONOMICS                                                         */}
      {/* ---------------------------------------------------------------- */}
      {tab === "economics" ? (
        <div className="space-y-5">
          <section className={`${CARD} space-y-4`}>
            <SectionTitle icon={<DollarSign className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
              Performance metrics
            </SectionTitle>

            {!canSeeFinance ? (
              <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                <span>
                  Cost, margin and ROI figures are withheld for your role. The server does not send them to this
                  page.
                </span>
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <MoneyMetric
                label="Landed cost"
                valueCents={vehicle.landedCostCents}
                masked={!canSeeFinance}
                size="md"
              />
              <MoneyMetric
                label="Estimated gross"
                valueCents={vehicle.estimatedGrossProfitCents}
                masked={!canSeeFinance}
                accent="green"
                size="md"
              />
              <MoneyMetric
                label="Actual gross"
                valueCents={vehicle.actualGrossProfitCents}
                masked={!canSeeFinance}
                accent="green"
                size="md"
              />
              <MoneyMetric
                label="Estimated ROI"
                valueCents={null}
                roiBasisPoints={vehicle.estimatedRoiBasisPoints}
                masked={!canSeeFinance}
                size="md"
              />
              <MoneyMetric
                label="Actual ROI"
                valueCents={null}
                roiBasisPoints={vehicle.actualRoiBasisPoints}
                masked={!canSeeFinance}
                size="md"
              />
              <MoneyMetric
                label="Front-end margin"
                valueCents={vehicle.frontEndMarginCents}
                masked={!canSeeFinance}
                size="md"
              />
              <MoneyMetric
                label="Negotiating room"
                valueCents={vehicle.negotiatingRoomCents}
                masked={!canSeeFinance}
                size="md"
              />
            </div>

            <FieldList
              columns={2}
              fields={[{ label: "Days in inventory", value: vehicle.daysInInventory, mono: true }]}
            />
          </section>

          {canPrice ? (
            <>
              <section className={`${CARD} space-y-4`}>
                <SectionTitle icon={<Tag className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
                  Pricing strategy
                </SectionTitle>

                <ActionForm
                  action={updateVehiclePricingAction}
                  submitLabel="Save pricing"
                  successMessage="Vehicle pricing updated."
                  buttonVariant="primary"
                  buttonSize="md"
                >
                  <input type="hidden" name="vehicleId" value={vehicle.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field id="pricing-askingPrice" label="Asking price ($)">
                      <input
                        id="pricing-askingPrice"
                        name="askingPrice"
                        inputMode="decimal"
                        defaultValue={
                          vehicle.askingPriceCents === null
                            ? ""
                            : centsToDecimalString(vehicle.askingPriceCents)
                        }
                        className={MONO_INPUT}
                      />
                    </Field>
                    <Field id="pricing-targetRetail" label="Target retail ($)">
                      <input
                        id="pricing-targetRetail"
                        name="targetRetail"
                        inputMode="decimal"
                        defaultValue={
                          vehicle.targetRetailPriceCents === null
                            ? ""
                            : centsToDecimalString(vehicle.targetRetailPriceCents)
                        }
                        className={MONO_INPUT}
                      />
                    </Field>
                    <Field id="pricing-minimumApproved" label="Minimum approved ($)">
                      <input
                        id="pricing-minimumApproved"
                        name="minimumApproved"
                        inputMode="decimal"
                        defaultValue={
                          vehicle.minimumApprovedCents === null
                            ? ""
                            : centsToDecimalString(vehicle.minimumApprovedCents)
                        }
                        className={MONO_INPUT}
                      />
                    </Field>
                  </div>
                </ActionForm>
              </section>

              <section className={`${CARD} space-y-4`}>
                <SectionTitle icon={<DollarSign className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
                  Acquisition cost
                </SectionTitle>

                <ActionForm
                  action={updateVehicleAcquisitionAction}
                  submitLabel="Save acquisition cost"
                  successMessage="Acquisition cost updated."
                  buttonVariant="secondary"
                  buttonSize="md"
                >
                  <input type="hidden" name="vehicleId" value={vehicle.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field id="acq-source" label="Acquisition source">
                      <select
                        id="acq-source"
                        name="acquisitionSource"
                        defaultValue={vehicle.acquisitionSource ?? ""}
                        className={INPUT}
                      >
                        <option value="">Not recorded</option>
                        {ACQUISITION_SOURCES.map((source) => (
                          <option key={source} value={source}>
                            {source}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id="acq-date" label="Acquisition date">
                      <input
                        id="acq-date"
                        type="date"
                        name="acquisitionDate"
                        defaultValue={vehicle.acquisitionDate ? formatDateOnly(vehicle.acquisitionDate) : ""}
                        className={INPUT}
                      />
                    </Field>
                    <Field id="acq-price" label="Acquisition price ($)">
                      <input
                        id="acq-price"
                        name="acquisitionPrice"
                        inputMode="decimal"
                        defaultValue={
                          vehicle.acquisitionPriceCents === null
                            ? ""
                            : centsToDecimalString(vehicle.acquisitionPriceCents)
                        }
                        className={MONO_INPUT}
                      />
                    </Field>
                    <Field id="acq-auctionFees" label="Auction fees ($)">
                      <input
                        id="acq-auctionFees"
                        name="auctionFees"
                        inputMode="decimal"
                        defaultValue={
                          vehicle.auctionFeesCents === null ? "" : centsToDecimalString(vehicle.auctionFeesCents)
                        }
                        className={MONO_INPUT}
                      />
                    </Field>
                    <Field id="acq-transport" label="Transport ($)">
                      <input
                        id="acq-transport"
                        name="transport"
                        inputMode="decimal"
                        defaultValue={
                          vehicle.transportationCents === null
                            ? ""
                            : centsToDecimalString(vehicle.transportationCents)
                        }
                        className={MONO_INPUT}
                      />
                    </Field>
                    <Field id="acq-inspection" label="Inspection ($)">
                      <input
                        id="acq-inspection"
                        name="inspection"
                        inputMode="decimal"
                        defaultValue={
                          vehicle.inspectionCents === null ? "" : centsToDecimalString(vehicle.inspectionCents)
                        }
                        className={MONO_INPUT}
                      />
                    </Field>
                    <Field id="acq-otherCosts" label="Other costs ($)">
                      <input
                        id="acq-otherCosts"
                        name="otherCosts"
                        inputMode="decimal"
                        defaultValue={
                          vehicle.otherAcquisitionCents === null
                            ? ""
                            : centsToDecimalString(vehicle.otherAcquisitionCents)
                        }
                        className={MONO_INPUT}
                      />
                    </Field>
                    <Field
                      id="acq-reconOverride"
                      label="Recon override ($)"
                      hint="Leave blank to let the system total the recon items."
                    >
                      <input
                        id="acq-reconOverride"
                        name="reconOverride"
                        inputMode="decimal"
                        defaultValue={
                          vehicle.reconOverrideCents === null
                            ? ""
                            : centsToDecimalString(vehicle.reconOverrideCents)
                        }
                        className={MONO_INPUT}
                      />
                    </Field>
                  </div>
                </ActionForm>
              </section>
            </>
          ) : (
            <section className={`${CARD} space-y-4`}>
              <SectionTitle icon={<Tag className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
                Pricing &amp; acquisition (read only)
              </SectionTitle>
              <FieldList
                columns={2}
                fields={[
                  {
                    label: "Asking price",
                    value: vehicle.askingPriceCents === null ? null : formatCents(vehicle.askingPriceCents),
                    mono: true,
                  },
                  {
                    label: "Target retail",
                    value:
                      vehicle.targetRetailPriceCents === null
                        ? null
                        : formatCents(vehicle.targetRetailPriceCents),
                    mono: true,
                  },
                  ...(canSeeFinance
                    ? [
                        {
                          label: "Minimum approved",
                          value:
                            vehicle.minimumApprovedCents === null
                              ? null
                              : formatCents(vehicle.minimumApprovedCents),
                          mono: true,
                        },
                      ]
                    : []),
                ]}
              />
              <p className="text-xs text-slate-500">
                Editing prices and acquisition cost requires pricing write authority.
                {canSeeFinance ? "" : " Acquisition cost is withheld for your role."}
              </p>
            </section>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* RECON                                                             */}
      {/* ---------------------------------------------------------------- */}
      {tab === "recon" ? (
        <div className="space-y-5">
          {detail.reconItems ? (
            <>
              <section className={`${CARD} space-y-4`}>
                <SectionTitle icon={<Wrench className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
                  Reconditioning items ({detail.reconItems.length})
                </SectionTitle>

                {detail.reconItems.length === 0 ? (
                  <p className="text-xs text-slate-400">No reconditioning items logged for this vehicle.</p>
                ) : (
                  <ul className="space-y-3">
                    {detail.reconItems.map((item) => (
                      <li key={item.id} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">{item.issue}</p>
                          <StatusBadge status={item.status} size="sm" />
                        </div>

                        <FieldList
                          columns={2}
                          fields={[
                            { label: "Vendor", value: item.vendor },
                            { label: "Estimate", value: formatCents(item.estimateCents), mono: true },
                            {
                              label: "Actual cost",
                              value: item.actualCostCents === null ? null : formatCents(item.actualCostCents),
                              mono: true,
                            },
                            { label: "Approved by staff", value: item.approvedByStaff ? "Yes" : "No" },
                            {
                              label: "Started",
                              value: item.startedAt ? formatDateTime(item.startedAt) : null,
                              mono: true,
                            },
                            {
                              label: "Completed",
                              value: item.completedAt ? formatDateTime(item.completedAt) : null,
                              mono: true,
                            },
                          ]}
                        />

                        {item.notes ? <p className="text-xs text-slate-600">{item.notes}</p> : null}

                        {canRecon ? (
                          <ActionForm
                            action={updateReconItemAction}
                            submitLabel="Save recon update"
                            successMessage="Recon item updated."
                            buttonVariant="secondary"
                            buttonSize="sm"
                            className="rounded-lg border border-slate-200 bg-white p-3"
                          >
                            <input type="hidden" name="reconItemId" value={item.id} />
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <Field id={`recon-status-${item.id}`} label="Status">
                                <select
                                  id={`recon-status-${item.id}`}
                                  name="status"
                                  defaultValue={item.status}
                                  className={INPUT}
                                >
                                  {RECON_STATUSES.map((status) => (
                                    <option key={status} value={status}>
                                      {status}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field
                                id={`recon-actual-${item.id}`}
                                label="Actual cost ($)"
                                hint="Record what the work actually cost."
                              >
                                <input
                                  id={`recon-actual-${item.id}`}
                                  name="actualCost"
                                  inputMode="decimal"
                                  defaultValue={
                                    item.actualCostCents === null
                                      ? ""
                                      : centsToDecimalString(item.actualCostCents)
                                  }
                                  className={MONO_INPUT}
                                />
                              </Field>
                            </div>
                          </ActionForm>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {canRecon ? (
                <section className={`${CARD} space-y-4`}>
                  <SectionTitle icon={<Wrench className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
                    Log a new recon item
                  </SectionTitle>

                  <ActionForm
                    action={recordReconItemAction}
                    submitLabel="Add recon item"
                    successMessage="Recon item added."
                    buttonVariant="secondary"
                    buttonSize="sm"
                  >
                    <input type="hidden" name="vehicleId" value={vehicle.id} />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Field id="recon-issue" label="Issue">
                          <input
                            id="recon-issue"
                            name="issue"
                            required
                            placeholder="e.g. Replace front brake pads"
                            className={INPUT}
                          />
                        </Field>
                      </div>
                      <Field id="recon-vendor" label="Vendor">
                        <input
                          id="recon-vendor"
                          name="vendor"
                          placeholder="e.g. Main Street Brake"
                          className={INPUT}
                        />
                      </Field>
                      <Field id="recon-status" label="Status">
                        <select id="recon-status" name="status" defaultValue="ESTIMATED" className={INPUT}>
                          {RECON_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id="recon-estimate" label="Estimated cost ($)">
                        <input
                          id="recon-estimate"
                          name="estimate"
                          inputMode="decimal"
                          placeholder="250.00"
                          className={MONO_INPUT}
                        />
                      </Field>
                      <Field id="recon-actual" label="Actual cost ($)">
                        <input
                          id="recon-actual"
                          name="actualCost"
                          inputMode="decimal"
                          placeholder="240.00"
                          className={MONO_INPUT}
                        />
                      </Field>
                    </div>
                  </ActionForm>
                </section>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="Reconditioning detail is not shared with your role"
              body="The server did not return recon items for this account, so none are shown. A vehicle with no recon items looks the same from here."
            />
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* EXPENSES                                                          */}
      {/* ---------------------------------------------------------------- */}
      {tab === "expenses" ? (
        <div className="space-y-5">
          {detail.expenses ? (
            <>
              <section className={`${CARD} space-y-4`}>
                <SectionTitle icon={<DollarSign className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
                  Vehicle expenses ({detail.expenses.length})
                </SectionTitle>

                {detail.expenses.length === 0 ? (
                  <p className="text-xs text-slate-400">No expenses recorded against this vehicle.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.expenses.map((expense) => (
                      <li
                        key={expense.id}
                        className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-semibold text-slate-900">{expense.category}</p>
                          <p className="font-mono text-[11px] text-slate-500">
                            {expense.vendor ?? "No vendor"} • {formatDateOnly(expense.incurredOn)}
                          </p>
                          {expense.description ? (
                            <p className="text-xs leading-relaxed text-slate-600">{expense.description}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-slate-900">
                            {formatCents(expense.amountCents)}
                          </span>
                          <span
                            className={`${CHIP} ${
                              expense.paid
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-amber-200 bg-amber-50 text-amber-800"
                            }`}
                          >
                            {expense.paid ? "Paid" : "Unpaid"}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {canExpense ? (
                <section className={`${CARD} space-y-4`}>
                  <SectionTitle icon={<DollarSign className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
                    Record an expense
                  </SectionTitle>

                  <ActionForm
                    action={recordVehicleExpenseAction}
                    submitLabel="Record expense"
                    successMessage="Expense logged."
                    buttonVariant="secondary"
                    buttonSize="sm"
                  >
                    <input type="hidden" name="vehicleId" value={vehicle.id} />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field id="exp-category" label="Category">
                        <select id="exp-category" name="category" required defaultValue="PARTS" className={INPUT}>
                          {EXPENSE_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id="exp-amount" label="Amount ($)">
                        <input
                          id="exp-amount"
                          name="amount"
                          inputMode="decimal"
                          required
                          placeholder="150.00"
                          className={MONO_INPUT}
                        />
                      </Field>
                      <Field id="exp-vendor" label="Vendor">
                        <input id="exp-vendor" name="vendor" placeholder="AutoZone" className={INPUT} />
                      </Field>
                      <Field id="exp-incurredOn" label="Incurred on">
                        <input id="exp-incurredOn" type="date" name="incurredOn" className={INPUT} />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field id="exp-description" label="Description">
                          <input
                            id="exp-description"
                            name="description"
                            placeholder="e.g. Front pads and rotors"
                            className={INPUT}
                          />
                        </Field>
                      </div>
                    </div>
                  </ActionForm>
                </section>
              ) : (
                <p className="text-xs text-slate-500">
                  Recording expenses requires expense write authority.
                </p>
              )}
            </>
          ) : (
            <EmptyState
              title="Expense detail is not shared with your role"
              body="The server did not return expense rows for this account, so none are shown. A vehicle with no expenses looks the same from here."
            />
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* PHOTOS                                                            */}
      {/* ---------------------------------------------------------------- */}
      {tab === "photos" ? (
        <div className="space-y-5">
          <section className={`${CARD} space-y-4`}>
            <SectionTitle icon={<Camera className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
              Gallery ({detail.photos.length})
            </SectionTitle>
            <VehiclePhotoGallery photos={detail.photos} vehicleTitle={title} />
          </section>

          {canWriteInventory ? (
            <section className={`${CARD} space-y-4`}>
              <SectionTitle icon={<Camera className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
                Upload &amp; manage photos
              </SectionTitle>

              <ActionForm
                action={uploadVehiclePhotoAction}
                submitLabel="Upload photo"
                successMessage="Photo uploaded."
                buttonVariant="secondary"
                buttonSize="sm"
              >
                <input type="hidden" name="vehicleId" value={vehicle.id} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="photo-file" label="Image file">
                    <input
                      id="photo-file"
                      type="file"
                      name="file"
                      accept="image/jpeg,image/png,image/webp"
                      required
                      className="w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
                    />
                  </Field>
                  <Field id="photo-alt" label="Alt description">
                    <input
                      id="photo-alt"
                      name="alt"
                      placeholder="e.g. Front three-quarter view"
                      className={INPUT}
                    />
                  </Field>
                </div>
              </ActionForm>

              {detail.photos.length > 0 ? (
                <div className="space-y-2 border-t border-slate-100 pt-4">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                    Uploaded photos
                  </span>
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    {detail.photos.map((photo) => (
                      <li key={photo.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                        <span className="min-w-0 max-w-xs truncate font-mono text-xs text-slate-700">
                          {photo.alt || photo.url}
                        </span>
                        <div className="flex items-center gap-2">
                          {photo.isPrimary ? (
                            <span className="rounded bg-orange-100 px-2 py-0.5 font-mono text-[10px] font-bold text-orange-800">
                              Primary
                            </span>
                          ) : (
                            <ActionForm
                              action={setPrimaryVehiclePhotoAction}
                              submitLabel="Make primary"
                              successMessage="Primary photo updated."
                              buttonVariant="outline"
                              buttonSize="sm"
                            >
                              <input type="hidden" name="photoId" value={photo.id} />
                            </ActionForm>
                          )}
                          <ActionForm
                            action={deleteVehiclePhotoAction}
                            submitLabel="Delete"
                            successMessage="Photo deleted."
                            buttonVariant="danger"
                            buttonSize="sm"
                          >
                            <input type="hidden" name="photoId" value={photo.id} />
                          </ActionForm>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : (
            <p className="text-xs text-slate-500">Managing photos requires inventory write authority.</p>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* DEAL                                                              */}
      {/* ---------------------------------------------------------------- */}
      {tab === "deal" ? (
        <div className="space-y-5">
          {deal ? (
            <section className={`${CARD} space-y-4`}>
              <SectionTitle icon={<FileText className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
                Live deal
              </SectionTitle>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={deal.status} size="md" />
              </div>

              <FieldList
                columns={3}
                fields={[
                  { label: "Buyer", value: deal.customerName },
                  { label: "Deal id", value: deal.dealId, mono: true },
                  { label: "Payment mode", value: deal.financeType.replace(/_/g, " ") },
                  {
                    label: "Sale price",
                    value: deal.salePriceCents === null ? null : formatCents(deal.salePriceCents),
                    mono: true,
                  },
                  { label: "Lender", value: deal.lenderName },
                  {
                    label: "Rate",
                    value: deal.aprBasisPoints === null ? null : `${formatBasisPoints(deal.aprBasisPoints, 2)} APR`,
                    mono: true,
                  },
                  { label: "Term", value: deal.termMonths === null ? null : `${deal.termMonths} months`, mono: true },
                  {
                    label: "Payment",
                    value: deal.paymentAmountCents === null ? null : formatCents(deal.paymentAmountCents),
                    mono: true,
                    note: deal.numberOfPayments === null ? null : `${deal.numberOfPayments} payments`,
                  },
                  {
                    label: "Amount financed",
                    value: deal.amountFinancedCents === null ? null : formatCents(deal.amountFinancedCents),
                    mono: true,
                  },
                  {
                    label: "Down payment",
                    value: deal.downPaymentCents === null ? null : formatCents(deal.downPaymentCents),
                    mono: true,
                  },
                  {
                    label: "Trade-in",
                    value:
                      deal.tradeInAllowanceCents === null ? null : formatCents(deal.tradeInAllowanceCents),
                    mono: true,
                    note:
                      deal.tradeInPayoffCents === null
                        ? null
                        : `payoff ${formatCents(deal.tradeInPayoffCents)}`,
                  },
                  { label: "Title work", value: deal.titleWorkStatus.replace(/_/g, " ") },
                  { label: "Registration", value: deal.registrationStatus.replace(/_/g, " ") },
                  {
                    label: "Delivered",
                    value: deal.deliveryDateIso === null ? null : deal.deliveryDateIso.slice(0, 10),
                    mono: true,
                  },
                  {
                    label: "Remaining balance",
                    value:
                      deal.remainingBalanceCents === null ? null : formatCents(deal.remainingBalanceCents),
                    mono: true,
                  },
                ]}
              />

              {/*
                The recorded rate-policy check. This is an audit record of the
                CONFIGURED policy that applied when the deal was written — it is
                not a statement that the contract is legally compliant.
              */}
              {deal.ratePolicyId !== null ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
                  Configured rate policy <span className="font-mono">{deal.ratePolicyId}</span> was applied, with a
                  ceiling of{" "}
                  <span className="font-mono">
                    {deal.ratePolicyCeilingBasisPoints === null
                      ? "—"
                      : `${formatBasisPoints(deal.ratePolicyCeilingBasisPoints, 2)}`}
                  </span>
                  . A configured-policy check is not a legal determination.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/sales/desk?vehicleId=${vehicle.id}`}
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700"
                >
                  <span>Open the Deal Desk</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
                <Link
                  href="/sales"
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <span>Open the SALES workspace</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>

              {canWriteDeals ? (
                <ActionForm
                  action={cancelDealAction}
                  submitLabel="Unwind / cancel deal"
                  successMessage="Deal cancelled and the vehicle released."
                  buttonVariant="danger"
                  buttonSize="md"
                  className="border-t border-slate-100 pt-4"
                >
                  <input type="hidden" name="dealId" value={deal.dealId} />
                  <Field id="deal-cancel-reason" label="Cancellation reason (optional)">
                    <input
                      id="deal-cancel-reason"
                      name="reason"
                      placeholder="e.g. Financing fell through"
                      className={INPUT}
                    />
                  </Field>
                </ActionForm>
              ) : (
                <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">
                  Unwinding a deal requires deal write authority.
                </p>
              )}
            </section>
          ) : canReadDeals ? (
            <EmptyState
              title="No live deal on this vehicle"
              body="No uncontracted or contracted deal is attached right now. Deals are opened and completed in the SALES workspace."
            />
          ) : (
            <EmptyState
              title="Deal data is not available to your role"
              body="Reading deals requires the deals read capability, which this account does not hold, so this section stays empty rather than guessing."
            />
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* DOCUMENTS                                                         */}
      {/* ---------------------------------------------------------------- */}
      {tab === "documents" ? (
        <div className="space-y-5">
          {/*
            PHASE 9B GAP: there is no document operation on the boundary. The
            `documents:read` / `documents:write` capabilities exist in the role
            matrix and `DealDocument` exists in the schema, but nothing in
            `src/lib/operations` reads or writes vehicle documents, so no list,
            upload or download can be offered without faking one.
          */}
          <EmptyState
            title="Document tracking is not available yet."
            body="No backend operation reads or writes vehicle documents, so nothing can be listed, uploaded or downloaded here. This section will stay empty until that boundary exists."
          />
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* HISTORY                                                           */}
      {/* ---------------------------------------------------------------- */}
      {tab === "history" ? (
        <div className="space-y-5">
          <section className={`${CARD} space-y-4`}>
            <SectionTitle icon={<History className="h-4 w-4 text-orange-600" aria-hidden="true" />}>
              Lifecycle history ({detail.statusEvents.length})
            </SectionTitle>
            <Timeline entries={timelineEntries} emptyLabel="No lifecycle events recorded yet." />
          </section>
        </div>
      ) : null}
    </div>
  );
}
