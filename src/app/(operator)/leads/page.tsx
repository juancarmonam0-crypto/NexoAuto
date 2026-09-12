import { ActionForm } from "@/app/_components/ActionForm";
import { createLeadAction, updateLeadStatusAction } from "@/app/actions/leads";
import { hasCapability } from "@/lib/auth/roles";
import { ALL_LEAD_STATUSES } from "@/lib/lead-status";
import { LEAD_SOURCES, listLeads } from "@/lib/operations/leads";
import { listInventory } from "@/lib/operations/inventory";
import { pageOperationContext } from "@/lib/operations/runtime";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { Users, Plus, Phone, Mail, Car, MessageSquare, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const ctx = await pageOperationContext("crm:read");

  const [{ items: leads, total }, { items: vehicles }] = await Promise.all([
    listLeads(ctx, { limit: 100 }),
    listInventory(ctx, { limit: 100 }),
  ]);

  const canWrite = hasCapability(ctx.actor.role, "crm:write");

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-orange-700 uppercase tracking-widest">
            <Users className="w-4 h-4 text-orange-600" />
            <span>Customer Pipeline</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-0.5">
            LEADS — Inquiry & CRM
          </h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Manage buyer inquiries, vehicle interest matching, test drives, and sales follow-ups.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 shadow-xs">
          <span className="text-slate-400">Total Pipeline:</span>
          <span className="font-bold text-slate-900">{total} prospects</span>
        </div>
      </div>

      {/* New Lead Intake Form */}
      {canWrite ? (
        <section className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Plus className="w-4 h-4 text-orange-600" />
              <span>Log New Lead / Prospect</span>
            </h2>
            <span className="text-[11px] font-mono text-slate-500">Inbound buyer record</span>
          </div>

          <ActionForm
            action={createLeadAction}
            submitLabel="Create Prospect Record"
            successMessage="Lead created in pipeline!"
            buttonVariant="primary"
            buttonSize="md"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  First Name <span className="text-orange-600">*</span>
                </label>
                <input
                  name="firstName"
                  required
                  placeholder="e.g. Jane"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Last Name
                </label>
                <input
                  name="lastName"
                  placeholder="e.g. Doe"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">Phone</label>
                <input
                  name="phone"
                  placeholder="(512) 555-0144"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">Email</label>
                <input
                  type="email"
                  name="email"
                  placeholder="customer@example.com"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Associated Vehicle
                </label>
                <select
                  name="vehicleId"
                  defaultValue=""
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                >
                  <option value="">No specific vehicle</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.year} {v.make} {v.model} (#{v.stockNumber})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Lead Source
                </label>
                <select
                  name="source"
                  defaultValue="WEBSITE_INQUIRY"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                >
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Initial Summary / Notes
                </label>
                <input
                  name="summary"
                  placeholder="Interested in test drive, looking for clean title..."
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>
            </div>
          </ActionForm>
        </section>
      ) : null}

      {/* Leads Pipeline Cards */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          Active Leads ({leads.length})
        </h2>

        {leads.length === 0 ? (
          <div className="p-8 sm:p-12 text-center rounded-xl bg-white border border-slate-200 space-y-3 shadow-xs">
            <Users className="w-10 h-10 text-slate-400 mx-auto" />
            <h3 className="text-base font-bold text-slate-900">No active leads</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Inbound inquiries and customer contacts will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {leads.map((lead) => {
              const customerName = `${lead.customer.firstName} ${lead.customer.lastName ?? ""}`.trim();
              const matchedVehicle = vehicles.find((v) => v.id === lead.vehicleId);

              return (
                <div
                  key={lead.id}
                  className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-all"
                >
                  <div className="space-y-3">
                    {/* Lead Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">{customerName}</h3>
                        <span className="text-[11px] font-mono text-slate-500 block">
                          Source: {lead.source.replace(/_/g, " ")}
                        </span>
                      </div>

                      <StatusBadge status={lead.status} size="sm" />
                    </div>

                    {/* Contact Info */}
                    <div className="space-y-1 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      {lead.customer.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-mono">{lead.customer.phone}</span>
                        </div>
                      )}
                      {lead.customer.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          <span>{lead.customer.email}</span>
                        </div>
                      )}
                    </div>

                    {/* Vehicle of Interest */}
                    {matchedVehicle && (
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 p-2 rounded-lg bg-orange-50/60 border border-orange-100">
                        <Car className="w-4 h-4 text-orange-600 shrink-0" />
                        <span className="truncate">
                          {matchedVehicle.year} {matchedVehicle.make} {matchedVehicle.model} (#{matchedVehicle.stockNumber})
                        </span>
                      </div>
                    )}

                    {/* Summary */}
                    {lead.summary && (
                      <div className="flex items-start gap-1.5 text-xs text-slate-600">
                        <MessageSquare className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                        <p className="line-clamp-2">{lead.summary}</p>
                      </div>
                    )}
                  </div>

                  {/* Status Transition Control */}
                  {canWrite && (
                    <div className="pt-3 border-t border-slate-100">
                      <ActionForm
                        action={updateLeadStatusAction}
                        submitLabel="Update Status"
                        successMessage="Lead status updated."
                        buttonVariant="outline"
                        buttonSize="sm"
                      >
                        <input type="hidden" name="leadId" value={lead.id} />
                        <div className="flex items-center gap-2">
                          <select
                            name="status"
                            defaultValue={lead.status}
                            className="w-full px-2 py-1 rounded bg-white border border-slate-300 text-xs text-slate-900"
                          >
                            {ALL_LEAD_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>
                      </ActionForm>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
