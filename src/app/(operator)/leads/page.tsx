import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import { addLeadNoteAction, createLeadAction, updateLeadStatusAction } from "@/app/actions/leads";
import { hasCapability } from "@/lib/auth/roles";
import { allowedLeadTransitions, LEAD_STATUS_LABELS } from "@/lib/lead-status";
import { listInventory, listLeads } from "@/lib/operations";
import { pageOperationContext } from "@/lib/operations/runtime";

/**
 * LEADS — the small CRM surface.
 *
 * Deliberately a list plus two forms: capture, advance, note. No pipelines, no
 * campaigns, no scoring. Only transitions the lead state machine allows are
 * offered, and the operation refuses the rest regardless of what is posted.
 */

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const ctx = await pageOperationContext("crm:read");

  const { items } = await listLeads(ctx, { limit: 100 });
  const canWrite = hasCapability(ctx.actor.role, "crm:write");
  // The vehicle picker needs inventory visibility, which is a separate capability.
  const inventory = hasCapability(ctx.actor.role, "inventory:read")
    ? (await listInventory(ctx, { listingStatus: "ACTIVE", limit: 100 })).items
    : [];

  return (
    <>
      <h1>LEADS</h1>
      <p className="muted">{items.length} lead{items.length === 1 ? "" : "s"} on file.</p>

      {canWrite ? (
        <fieldset>
          <legend>New lead</legend>
          <ActionForm action={createLeadAction} submitLabel="Create lead">
            <label>
              First name
              <input name="firstName" required size={12} />
            </label>
            <label>
              Last name
              <input name="lastName" size={12} />
            </label>
            <label>
              Phone
              <input name="phone" size={12} />
            </label>
            <label>
              Email
              <input type="email" name="email" size={16} />
            </label>
            {inventory.length > 0 ? (
              <label>
                Vehicle of interest
                <select name="vehicleId" defaultValue="">
                  <option value="">—</option>
                  {inventory.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.year} {vehicle.make} {vehicle.model} ({vehicle.stockNumber})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Summary
              <input name="summary" size={28} />
            </label>
          </ActionForm>
          <p className="muted">A phone number or an email address is required — the database enforces it.</p>
        </fieldset>
      ) : (
        <p className="muted">Your role can read leads but not change them.</p>
      )}

      {items.length === 0 ? (
        <p className="muted">No leads yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Status</th>
              <th>Vehicle</th>
              <th>Last contact</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((lead) => (
              <tr key={lead.id}>
                <td>
                  {lead.customer.firstName} {lead.customer.lastName ?? ""}
                  <div className="muted">{lead.customer.phone ?? lead.customer.email ?? "No contact on file"}</div>
                </td>
                <td>
                  {LEAD_STATUS_LABELS[lead.status]}
                  {lead.lostReason ? <div className="muted">{lead.lostReason}</div> : null}
                </td>
                <td>
                  {lead.vehicleId ? <Link href={`/cars/${lead.vehicleId}`}>Vehicle</Link> : <span className="muted">—</span>}
                </td>
                <td>{lead.lastContactedAt ? lead.lastContactedAt.toISOString().slice(0, 10) : "—"}</td>
                <td>
                  {canWrite ? (
                    <div className="row">
                      {allowedLeadTransitions(lead.status).map((status) => (
                        <ActionForm key={status} action={updateLeadStatusAction} submitLabel={LEAD_STATUS_LABELS[status]}>
                          <input type="hidden" name="leadId" value={lead.id} />
                          <input type="hidden" name="status" value={status} />
                          {status === "LOST" ? (
                            <label>
                              Reason
                              <input name="lostReason" required size={14} />
                            </label>
                          ) : null}
                        </ActionForm>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}

                  {canWrite ? (
                    <ActionForm action={addLeadNoteAction} submitLabel="Add note">
                      <input type="hidden" name="leadId" value={lead.id} />
                      <label>
                        Note
                        <input name="body" required size={24} />
                      </label>
                    </ActionForm>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
