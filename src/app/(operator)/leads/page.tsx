import Link from "next/link";
import {
  ArrowRight,
  Car,
  Clock,
  ListFilter,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Users,
} from "lucide-react";

import { ActionForm } from "@/app/_components/ActionForm";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { createLeadAction, updateLeadStatusAction } from "@/app/actions/leads";
import { hasCapability } from "@/lib/auth/roles";
import { ALL_LEAD_STATUSES, allowedLeadTransitions, leadStatusLabel } from "@/lib/lead-status";
import { listInventory } from "@/lib/operations/inventory";
import { CONTACT_METHODS, LEAD_SOURCES, listLeads } from "@/lib/operations/leads";
import { pageOperationContext } from "@/lib/operations/runtime";

export const dynamic = "force-dynamic";

/**
 * LEADS — the pipeline.
 *
 * The list is for SCANNING: who is waiting, what they asked about, and the one
 * click that moves them forward. Everything deeper (full history, contact
 * edits, losing a lead with a reason) lives in the lead workspace at
 * `/leads/<id>`, which is where the lifecycle actually belongs.
 *
 * The status buttons come from `allowedLeadTransitions` — the SAME state
 * machine the operation enforces — so the UI can no longer offer a move the
 * server will refuse. LOST is deliberately absent here: it requires a written
 * reason, so it is offered only in the workspace where that field exists.
 */

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500";
const labelClass = "block font-mono text-[11px] font-medium uppercase tracking-wider text-slate-600";

function listHref(params: { view?: string; status?: string; q?: string }): string {
  const search = new URLSearchParams();
  if (params.view && params.view !== "open") search.set("view", params.view);
  if (params.status) search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  const query = search.toString();
  return query ? `/leads?${query}` : "/leads";
}

function Chip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string; q?: string }>;
}) {
  const ctx = await pageOperationContext("crm:read");
  const params = await searchParams;

  const search = params.q?.trim() ?? "";
  const status = ALL_LEAD_STATUSES.find((value) => value === params.status);
  const openOnly = !status && params.view !== "all";

  const [{ items: leads, total }, { items: vehicles }] = await Promise.all([
    // `search`, `status` and `openOnly` are the operation's own filters.
    listLeads(ctx, { limit: 100, status, openOnly, search: search || undefined }),
    listInventory(ctx, { limit: 100 }),
  ]);

  const canWrite = hasCapability(ctx.actor.role, "crm:write");
  const filtering = Boolean(search || status || params.view === "all");

  /*
   * PHASE 9B GAP: "which follow-ups are late" is not answerable here.
   * `leadListFilterSchema` exposes no dueBefore/overdue filter, so the backend
   * never tells this page which follow-ups have passed and the page will not
   * decide that for itself. The follow-up DATE is shown as a fact; ranking or
   * flagging leads as overdue needs a backend filter.
   */

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-orange-700">
            <Users className="h-4 w-4 text-orange-600" />
            <span>Customer Pipeline</span>
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            LEADS — Inquiry &amp; CRM
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Every buyer inquiry, what they want, and when they are due a follow-up.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 shadow-xs">
            {openOnly ? "Open" : "Matching"}: <span className="font-bold text-slate-900">{total}</span>
          </span>
        </div>
      </div>

      {/* Intake */}
      {canWrite ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-900">
              <Plus className="h-4 w-4 text-orange-600" />
              <span>Log a new inquiry</span>
            </h2>
            <span className="font-mono text-[11px] text-slate-500">Customer record is created with it</span>
          </div>

          <ActionForm
            action={createLeadAction}
            submitLabel="Create prospect"
            successMessage="Lead created in the pipeline."
            buttonVariant="primary"
            buttonSize="md"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <label htmlFor="lead-firstName" className={labelClass}>
                  First name <span className="text-orange-600">*</span>
                </label>
                <input id="lead-firstName" name="firstName" required placeholder="e.g. Jane" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label htmlFor="lead-lastName" className={labelClass}>
                  Last name
                </label>
                <input id="lead-lastName" name="lastName" placeholder="e.g. Doe" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label htmlFor="lead-phone" className={labelClass}>
                  Phone
                </label>
                <input
                  id="lead-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="(512) 555-0144"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="lead-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="lead-email"
                  name="email"
                  type="email"
                  placeholder="customer@example.com"
                  className={inputClass}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="lead-preferredContact" className={labelClass}>
                  Preferred contact
                </label>
                <select id="lead-preferredContact" name="preferredContact" defaultValue="ANY" className={inputClass}>
                  {CONTACT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="lead-source" className={labelClass}>
                  Lead source
                </label>
                <select id="lead-source" name="source" defaultValue="WEBSITE_INQUIRY" className={inputClass}>
                  {LEAD_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {source.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="lead-vehicleId" className={labelClass}>
                  Vehicle of interest
                </label>
                <select id="lead-vehicleId" name="vehicleId" defaultValue="" className={inputClass}>
                  <option value="">No specific vehicle</option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.year} {vehicle.make} {vehicle.model} (#{vehicle.stockNumber})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="lead-nextFollowUpAt" className={labelClass}>
                  Next follow-up
                </label>
                <input id="lead-nextFollowUpAt" name="nextFollowUpAt" type="datetime-local" className={`${inputClass} font-mono`} />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label htmlFor="lead-summary" className={labelClass}>
                  What do they want
                </label>
                <input
                  id="lead-summary"
                  name="summary"
                  placeholder="Wants a test drive, needs a clean title…"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor="lead-notes" className={labelClass}>
                  Customer notes
                </label>
                <input id="lead-notes" name="notes" placeholder="Trade-in, budget, timing…" className={inputClass} />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              A phone number or an email address is required — a customer record with neither is rejected.
            </p>
          </ActionForm>
        </section>
      ) : null}

      {/* Filters */}
      <section className="space-y-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          {params.view && params.view !== "open" ? <input type="hidden" name="view" value={params.view} /> : null}
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <div className="min-w-[220px] flex-1 space-y-1">
            <label htmlFor="lead-search" className={labelClass}>
              Search name, phone or email
            </label>
            <div className="flex gap-2">
              <input
                id="lead-search"
                name="q"
                type="search"
                defaultValue={search}
                placeholder="e.g. Doe, 555-0144, jane@…"
                className={inputClass}
              />
              <button
                type="submit"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Search className="h-3.5 w-3.5" />
                Search
              </button>
            </div>
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-slate-500">
            <ListFilter className="h-3.5 w-3.5" />
            Show
          </span>
          <Chip href={listHref({ view: "open", q: search })} label="Open pipeline" active={openOnly} />
          <Chip href={listHref({ view: "all", q: search })} label="All leads" active={params.view === "all"} />
          {ALL_LEAD_STATUSES.map((value) => (
            <Chip
              key={value}
              href={listHref({ status: value, q: search })}
              label={leadStatusLabel(value)}
              active={status === value}
            />
          ))}
          {filtering ? (
            <Link href="/leads" className="ml-1 text-[11px] font-semibold text-slate-500 underline hover:text-slate-700">
              Clear
            </Link>
          ) : null}
        </div>
      </section>

      {/* Pipeline */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          {status ? `${leadStatusLabel(status)} leads` : openOnly ? "Open pipeline" : "All leads"} ({leads.length})
        </h2>

        {leads.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs sm:p-12">
            <Users className="mx-auto h-10 w-10 text-slate-400" />
            <h3 className="text-base font-bold text-slate-900">
              {filtering ? "No leads match this view" : "No leads yet"}
            </h3>
            <p className="mx-auto max-w-sm text-xs text-slate-500">
              {filtering
                ? "Try a different status, or clear the filters."
                : "Log an inquiry above and it will appear here with its follow-up date."}
            </p>
            {filtering ? (
              <Link
                href="/leads"
                className="inline-block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear filters
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {leads.map((lead) => {
              const name = `${lead.customer.firstName} ${lead.customer.lastName ?? ""}`.trim();
              const vehicle = vehicles.find((item) => item.id === lead.vehicleId);
              // Same state machine as the server: only legal moves, minus LOST.
              const quickMoves = allowedLeadTransitions(lead.status).filter((next) => next !== "LOST");

              return (
                <article
                  key={lead.id}
                  className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition-all hover:border-slate-300"
                >
                  <div className="space-y-3">
                    <header className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-bold text-slate-900">
                          <Link href={`/leads/${lead.id}`} className="hover:text-orange-700">
                            {name}
                          </Link>
                        </h3>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                          {lead.source.replace(/_/g, " ")} · added {lead.createdAt.toISOString().slice(0, 10)}
                        </p>
                      </div>
                      <StatusBadge status={leadStatusLabel(lead.status)} size="sm" />
                    </header>

                    {lead.customer.phone || lead.customer.email ? (
                      <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-600">
                        {lead.customer.phone ? (
                          <p className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="font-mono">{lead.customer.phone}</span>
                            <span className="ml-auto font-mono text-[10px] uppercase text-slate-400">
                              {lead.customer.preferredContact}
                            </span>
                          </p>
                        ) : null}
                        {lead.customer.email ? (
                          <p className="flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="truncate">{lead.customer.email}</span>
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                        No contact method on file.
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {lead.nextFollowUpAt ? (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-slate-600">
                          <Clock className="h-3.5 w-3.5" />
                          Follow up {lead.nextFollowUpAt.toISOString().slice(0, 10)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">No follow-up scheduled</span>
                      )}
                      {lead.lastContactedAt ? (
                        <span className="font-mono text-[11px] text-slate-500">
                          last contact {lead.lastContactedAt.toISOString().slice(0, 10)}
                        </span>
                      ) : null}
                    </div>

                    {vehicle ? (
                      <div className="flex items-center gap-2 rounded-lg border border-orange-100 bg-orange-50/60 p-2 text-xs font-semibold text-slate-800">
                        <Car className="h-4 w-4 shrink-0 text-orange-600" />
                        <span className="truncate">
                          {vehicle.year} {vehicle.make} {vehicle.model} (#{vehicle.stockNumber})
                        </span>
                      </div>
                    ) : null}

                    {lead.summary ? (
                      <p className="flex items-start gap-1.5 text-xs text-slate-600">
                        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="line-clamp-2">{lead.summary}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 transition-colors hover:text-orange-600"
                    >
                      <span>Open lead workspace</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>

                    {canWrite && quickMoves.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {quickMoves.map((next) => (
                          <ActionForm
                            key={next}
                            action={updateLeadStatusAction}
                            submitLabel={leadStatusLabel(next)}
                            successMessage={`Lead moved to ${leadStatusLabel(next)}.`}
                            buttonVariant="outline"
                            buttonSize="sm"
                          >
                            <input type="hidden" name="leadId" value={lead.id} />
                            <input type="hidden" name="status" value={next} />
                          </ActionForm>
                        ))}
                      </div>
                    ) : null}

                    {canWrite ? (
                      <p className="text-[11px] text-slate-500">
                        Marking a lead lost needs a written reason — open the workspace for that.
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
