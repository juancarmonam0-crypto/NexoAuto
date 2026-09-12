import Link from "next/link";
import {
  addLeadNoteAction,
  updateLeadContactAction,
  updateLeadDetailsAction,
  updateLeadStatusAction,
} from "@/app/actions/leads";
import { ActionForm } from "@/app/_components/ActionForm";
import { FieldList } from "@/app/_components/FieldList";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { Timeline, type TimelineEntry } from "@/app/_components/Timeline";
import { hasCapability } from "@/lib/auth/roles";
import {
  ALL_LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  allowedLeadTransitions,
  isLeadClosed,
} from "@/lib/lead-status";
import { CONTACT_METHODS, getLead } from "@/lib/operations/leads";
import { pageOperationContext } from "@/lib/operations/runtime";
import type { LeadActivity, LeadActivityType, LeadStatus } from "@/generated/prisma";
import { ArrowLeft, Calculator, Car, MessageSquare, Plus, User } from "lucide-react";

/**
 * LEAD WORKSPACE — one prospect, everything the operations layer exposes.
 *
 * Reads come from `getLead` (already role-masked); writes go through the four
 * lead actions only, and every form field name below matches what that action
 * reads. The lifecycle is never re-derived here: the status select is built from
 * `allowedLeadTransitions(lead.status)`, the same state machine the operation
 * enforces.
 *
 * ── PHASE 9B GAP: test drives and the linked deal are NOT rendered. ──────────
 * `Lead.testDrives` and `Lead.deals` exist in the schema, but no operation in
 * `src/lib/operations` exposes them on a lead, so this page cannot show a
 * TestDriveRequest list or the deal a WON lead became without bypassing the
 * boundary. Do not query them here: add a read to the operation layer first.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ leadId: string }>;
}

/** Labels used below the contract line — presentation only, no business rules. */
const LABEL_CLASS = "font-mono text-[11px] font-medium uppercase tracking-wider text-slate-600";
const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500";

/** Pre-formatted on the server; `Timeline` receives strings, never dates. */
function formatTimestamp(value: Date): string {
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

/** `datetime-local` wants exactly `YYYY-MM-DDTHH:mm`. */
function formatDateTimeLocal(value: Date): string {
  return new Date(value).toISOString().slice(0, 16);
}

function activityTitle(activity: LeadActivity): string {
  const from = activity.fromStatus;
  const to = activity.toStatus;

  switch (activity.type as LeadActivityType) {
    case "NOTE":
      return "Note";
    case "CALL":
      return "Call logged";
    case "EMAIL":
      return "Email";
    case "TEXT":
      return "Text message";
    case "APPOINTMENT":
      return "Appointment";
    case "STATUS_CHANGE":
      return from && to
        ? `Status: ${LEAD_STATUS_LABELS[from as LeadStatus]} → ${LEAD_STATUS_LABELS[to as LeadStatus]}`
        : "Status changed";
    case "TASK":
      return "Task";
    case "DOCUMENT":
      return "Document";
    default:
      return String(activity.type);
  }
}

function activityTone(activity: LeadActivity): TimelineEntry["tone"] {
  if (activity.toStatus === "WON") return "success";
  if (activity.toStatus === "LOST") return "danger";
  if (activity.type === "STATUS_CHANGE") return "progress";
  return "neutral";
}

export default async function LeadWorkspacePage({ params }: PageProps) {
  const { leadId } = await params;

  const ctx = await pageOperationContext("crm:read");
  // A missing lead throws NotFoundError from the operation layer — let it
  // propagate to the app's error page rather than inventing a placeholder.
  const { lead, activities } = await getLead(ctx, leadId);

  const canWrite = hasCapability(ctx.actor.role, "crm:write");
  const customer = lead.customer;
  const customerName = `${customer.firstName} ${customer.lastName ?? ""}`.trim();
  const transitions = allowedLeadTransitions(lead.status);
  const closed = isLeadClosed(lead.status);

  const timelineEntries: TimelineEntry[] = activities.map((activity) => ({
    id: activity.id,
    title: activityTitle(activity),
    timestamp: formatTimestamp(activity.createdAt),
    body: activity.body,
    tone: activityTone(activity),
  }));

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div className="space-y-3">
        <Link
          href="/leads"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-orange-600 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to leads</span>
        </Link>

        <div className="border-b border-slate-200 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              {customerName}
            </h1>
            <StatusBadge status={lead.status} size="md" />
          </div>
          <p className="mt-1 text-xs text-slate-500 font-mono">
            Lead {lead.id} · Source {lead.source.replace(/_/g, " ")} · Last contacted{" "}
            {lead.lastContactedAt ? formatTimestamp(lead.lastContactedAt) : "never"} · Next follow-up{" "}
            {lead.nextFollowUpAt ? formatTimestamp(lead.nextFollowUpAt) : "not set"}
          </p>

          {/* Contextual entry into the Deal Desk, carrying this lead. */}
          <div className="mt-3">
            <Link
              href={`/sales/desk?leadId=${lead.id}${lead.vehicleId ? `&vehicleId=${lead.vehicleId}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700"
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>Structure a deal for this lead</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Identity, assignment, vehicle, summary */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
          <User className="w-4 h-4 text-orange-600" />
          <span>Lead record</span>
        </h2>

        <FieldList
          fields={[
            { label: "Lead source", value: lead.source.replace(/_/g, " ") },
            {
              label: "Status",
              value: `${LEAD_STATUS_LABELS[lead.status]}${closed ? " (closed)" : ""}`,
            },
            {
              label: "Last contacted",
              value: lead.lastContactedAt ? formatTimestamp(lead.lastContactedAt) : null,
              mono: true,
            },
            {
              label: "Next follow-up",
              value: lead.nextFollowUpAt ? formatTimestamp(lead.nextFollowUpAt) : null,
              mono: true,
            },
            {
              label: "Assigned staff",
              // PHASE 9B GAP: only `assignedToId` is exposed on the lead — no
              // operation resolves a staff id to a name, so the id is shown
              // verbatim rather than guessed.
              value: lead.assignedToId ?? "unassigned",
              mono: true,
            },
            { label: "Created", value: formatTimestamp(lead.createdAt), mono: true },
          ]}
          columns={2}
        />

        {/* PHASE 9B GAP: only the vehicle id is exposed on the lead, so no
            year/make/model or stock number is shown — resolving them would need
            a vehicle read the operation layer does not offer for a lead. */}
        {lead.vehicleId ? (
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 p-2.5 rounded-lg bg-orange-50/60 border border-orange-100">
            <Car className="w-4 h-4 text-orange-600 shrink-0" />
            <span className="text-slate-500 font-normal">Linked vehicle</span>
            <Link
              href={`/cars/${lead.vehicleId}`}
              className="font-mono text-orange-700 hover:text-orange-800 underline decoration-orange-300 underline-offset-2 truncate"
            >
              {lead.vehicleId}
            </Link>
          </div>
        ) : (
          <p className="text-xs text-slate-500">No vehicle linked to this lead yet.</p>
        )}

        <div className="space-y-1">
          <p className={LABEL_CLASS}>Summary</p>
          <p className="text-sm leading-relaxed text-slate-700">
            {lead.summary && lead.summary.trim() !== "" ? (
              lead.summary
            ) : (
              <span className="text-slate-400">Not recorded</span>
            )}
          </p>
        </div>

        {/* PHASE 9B GAP: a WON lead becomes a Deal, and a lead has
            TestDriveRequest rows, but neither is exposed on `getLead`; the
            linked deal and the test-drive history are omitted rather than
            queried directly. */}
        <p className="text-[11px] leading-relaxed text-slate-500 border-t border-slate-100 pt-3">
          Not shown yet: linked deal and test-drive requests — no operation exposes them on a lead
          (Phase 9B gap).
        </p>
      </section>

      {/* Contact details */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
          <MessageSquare className="w-4 h-4 text-orange-600" />
          <span>Contact details</span>
        </h2>

        <FieldList
          fields={[
            { label: "Phone", value: customer.phone, mono: true },
            { label: "Email", value: customer.email },
            { label: "Preferred contact", value: customer.preferredContact },
          ]}
          columns={2}
        />

        {/* PHASE 9B GAP: `getLead` includes only the customer's contact core
            (name, phone, email, preferredContact). Address, city/state and
            customer notes are NOT part of `LeadWithCustomer`, so they are
            neither displayed nor prefilled here — the contact form still sends
            them when provided. */}
        <p className="text-[11px] leading-relaxed text-slate-500">
          Address, city/state/postal code and customer notes are not returned by the lead read
          (`LeadWithCustomer` carries the contact core only), so they are not shown or prefilled
          (Phase 9B gap). Entering them in the contact form below still updates the customer.
        </p>
      </section>

      {/* Timeline */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b border-slate-100 pb-3">
          Activity timeline
        </h2>
        <Timeline entries={timelineEntries} emptyLabel="No activity recorded yet." />
      </section>

      {canWrite ? (
        <>
          {/* Status progression */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b border-slate-100 pb-3">
              Move this lead
            </h2>

            {transitions.length === 0 ? (
              <p className="text-xs text-slate-500">
                A won lead is closed — corrections happen on the resulting deal. No further status
                changes are available.
              </p>
            ) : (
              <ActionForm
                action={updateLeadStatusAction}
                submitLabel="Update status"
                successMessage="Lead status updated."
                buttonVariant="primary"
                buttonSize="md"
              >
                <input type="hidden" name="leadId" value={lead.id} />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="status" className={LABEL_CLASS}>
                      New status <span className="text-orange-600">*</span>
                    </label>
                    <select id="status" name="status" required defaultValue="" className={INPUT_CLASS}>
                      <option value="" disabled>
                        Choose the next status…
                      </option>
                      {transitions.map((status) => (
                        <option key={status} value={status}>
                          {LEAD_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-500">
                      Current: {LEAD_STATUS_LABELS[lead.status]}. Only legal moves from the lead
                      lifecycle are listed.
                    </p>
                  </div>

                  <div className="space-y-1">
                    {/* Always rendered: LOST is reachable from every open
                        status, and both `leads_lost_has_reason` and the
                        operation reject a loss without a reason. */}
                    <label htmlFor="lostReason" className={LABEL_CLASS}>
                      Lost reason
                    </label>
                    <input
                      id="lostReason"
                      name="lostReason"
                      required={transitions.includes("LOST")}
                      placeholder="e.g. Bought elsewhere / financing declined"
                      className={INPUT_CLASS}
                    />
                    <p className="text-[11px] text-slate-500">
                      Required when the new status is Lost — a lost lead needs a reason.
                    </p>
                  </div>

                  <div className="sm:col-span-2 space-y-1">
                    <label htmlFor="statusNote" className={LABEL_CLASS}>
                      Note (optional)
                    </label>
                    <input
                      id="statusNote"
                      name="note"
                      placeholder="Context recorded on the timeline"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
              </ActionForm>
            )}
          </section>

          {/* Add note */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
              <Plus className="w-4 h-4 text-orange-600" />
              <span>Add note</span>
            </h2>

            <ActionForm
              action={addLeadNoteAction}
              submitLabel="Add note to timeline"
              successMessage="Note added to the timeline."
              buttonVariant="secondary"
              buttonSize="md"
            >
              <input type="hidden" name="leadId" value={lead.id} />
              <div className="space-y-1">
                <label htmlFor="body" className={LABEL_CLASS}>
                  Note <span className="text-orange-600">*</span>
                </label>
                <textarea
                  id="body"
                  name="body"
                  required
                  rows={3}
                  placeholder="What happened on this contact?"
                  className={INPUT_CLASS}
                />
              </div>
            </ActionForm>
          </section>

          {/* Contact details */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b border-slate-100 pb-3">
              Edit contact details
            </h2>

            <ActionForm
              action={updateLeadContactAction}
              submitLabel="Save contact details"
              successMessage="Customer contact details updated."
              buttonVariant="secondary"
              buttonSize="md"
            >
              <input type="hidden" name="leadId" value={lead.id} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="firstName" className={LABEL_CLASS}>
                    First name <span className="text-orange-600">*</span>
                  </label>
                  <input
                    id="firstName"
                    name="firstName"
                    required
                    defaultValue={customer.firstName}
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="lastName" className={LABEL_CLASS}>
                    Last name
                  </label>
                  <input
                    id="lastName"
                    name="lastName"
                    defaultValue={customer.lastName ?? ""}
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="email" className={LABEL_CLASS}>
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    defaultValue={customer.email ?? ""}
                    placeholder="customer@example.com"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="phone" className={LABEL_CLASS}>
                    Phone
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    defaultValue={customer.phone ?? ""}
                    placeholder="(512) 555-0144"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="preferredContact" className={LABEL_CLASS}>
                    Preferred contact
                  </label>
                  <select
                    id="preferredContact"
                    name="preferredContact"
                    defaultValue={customer.preferredContact}
                    className={INPUT_CLASS}
                  >
                    {CONTACT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="addressLine1" className={LABEL_CLASS}>
                    Address
                  </label>
                  <input
                    id="addressLine1"
                    name="addressLine1"
                    placeholder="Street address"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="city" className={LABEL_CLASS}>
                    City
                  </label>
                  <input id="city" name="city" className={INPUT_CLASS} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="state" className={LABEL_CLASS}>
                      State
                    </label>
                    <input id="state" name="state" className={INPUT_CLASS} />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="postalCode" className={LABEL_CLASS}>
                      Postal code
                    </label>
                    <input id="postalCode" name="postalCode" className={`${INPUT_CLASS} font-mono`} />
                  </div>
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <label htmlFor="notes" className={LABEL_CLASS}>
                    Customer notes
                  </label>
                  <textarea
                    id="notes"
                    name="notes"
                    rows={3}
                    placeholder="Preferences, budget, trade-in, history…"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                A customer must keep a phone number or an email address — clearing the last one is
                refused. Blank fields are ignored, so only what you fill in is changed.
              </p>
            </ActionForm>
          </section>

          {/* Lead details */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b border-slate-100 pb-3">
              Edit lead details
            </h2>

            <ActionForm
              action={updateLeadDetailsAction}
              submitLabel="Save lead details"
              successMessage="Lead details updated."
              buttonVariant="secondary"
              buttonSize="md"
            >
              <input type="hidden" name="leadId" value={lead.id} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-1">
                  <label htmlFor="summary" className={LABEL_CLASS}>
                    Summary
                  </label>
                  <textarea
                    id="summary"
                    name="summary"
                    rows={3}
                    defaultValue={lead.summary ?? ""}
                    placeholder="What this buyer wants"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="vehicleId" className={LABEL_CLASS}>
                    Linked vehicle id
                  </label>
                  <input
                    id="vehicleId"
                    name="vehicleId"
                    defaultValue={lead.vehicleId ?? ""}
                    placeholder="Vehicle record id"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                  <p className="text-[11px] text-slate-500">
                    Paste a vehicle record id to (re)link this lead.
                  </p>
                </div>

                <div className="space-y-1">
                  <label htmlFor="nextFollowUpAt" className={LABEL_CLASS}>
                    Next follow-up
                  </label>
                  <input
                    id="nextFollowUpAt"
                    name="nextFollowUpAt"
                    type="datetime-local"
                    defaultValue={lead.nextFollowUpAt ? formatDateTimeLocal(lead.nextFollowUpAt) : ""}
                    className={`${INPUT_CLASS} font-mono`}
                  />
                </div>
              </div>

              {/* PHASE 9B GAP: an assignee control is deliberately absent —
                  the form fields `updateLeadDetailsAction` reads are leadId,
                  summary, vehicleId and nextFollowUpAt only; `assignedToId` is
                  not accepted by the action, and no operation lists staff to
                  choose from. */}
              <p className="text-[11px] text-slate-500">
                Reassigning the lead is not available here (Phase 9B gap): the action accepts only
                summary, vehicle and follow-up, and no operation lists staff.
                {lead.assignedToId ? (
                  <>
                    {" "}
                    Currently assigned to <span className="font-mono">{lead.assignedToId}</span>.
                  </>
                ) : (
                  " This lead is unassigned."
                )}
              </p>
            </ActionForm>
          </section>
        </>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <p className="text-xs text-slate-500">
            Your role can read this lead but not change it — status moves, notes and detail edits
            require the <span className="font-mono">crm:write</span> capability. The server enforces
            this regardless of what is rendered.
          </p>
        </section>
      )}

      {/* ALL_LEAD_STATUSES is the canonical lifecycle order; keep it imported so
          the vocabulary shown here can never drift from the enum the operation
          validates against. */}
      <p className="text-[11px] font-mono text-slate-400">
        Lifecycle order: {ALL_LEAD_STATUSES.map((status) => LEAD_STATUS_LABELS[status]).join(" → ")}
      </p>
    </div>
  );
}
