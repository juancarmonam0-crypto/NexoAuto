import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import { cancelDealAction, completeVehicleSaleAction } from "@/app/actions/sales";
import { hasCapability } from "@/lib/auth/roles";
import { formatBasisPoints, formatCents } from "@/lib/money";
import { listInventory, listLeads, liveDealForVehicle } from "@/lib/operations";
import { pageOperationContext } from "@/lib/operations/runtime";

/**
 * SALES — completing and unwinding a deal.
 *
 * Actual profit shown here is the figure the economics engine persisted at sale
 * time; nothing on this page recalculates it. A salesperson sees the sale price
 * and a null profit, by capability.
 */

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const ctx = await pageOperationContext("deals:read");
  const canWrite = hasCapability(ctx.actor.role, "deals:write");

  const [available, sold] = await Promise.all([
    listInventory(ctx, { listingStatus: "ACTIVE", limit: 100 }),
    listInventory(ctx, { listingStatus: "SOLD", limit: 25 }),
  ]);

  const openLeads = hasCapability(ctx.actor.role, "crm:read")
    ? (await listLeads(ctx, { openOnly: true, limit: 100 })).items
    : [];

  const liveDeals = new Map(
    await Promise.all(
      available.items.map(async (vehicle) => [vehicle.id, await liveDealForVehicle(ctx, vehicle.id)] as const),
    ),
  );

  return (
    <>
      <h1>SALES</h1>

      {canWrite ? (
        <fieldset>
          <legend>Complete a sale to a known lead</legend>
          {openLeads.length === 0 ? (
            <p className="muted">No open leads. Create one in LEADS, or use the walk-in form below.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Sell</th>
                </tr>
              </thead>
              <tbody>
                {openLeads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      {lead.customer.firstName} {lead.customer.lastName ?? ""}
                      <div className="muted">{lead.customer.phone ?? lead.customer.email ?? "No contact"}</div>
                    </td>
                    <td>
                      <ActionForm action={completeVehicleSaleAction} submitLabel="Complete sale">
                        <input type="hidden" name="customerId" value={lead.customerId} />
                        <input type="hidden" name="leadId" value={lead.id} />
                        <label>
                          Vehicle
                          <select name="vehicleId" required defaultValue="">
                            <option value="" disabled>
                              Choose
                            </option>
                            {available.items.map((vehicle) => (
                              <option key={vehicle.id} value={vehicle.id}>
                                {vehicle.year} {vehicle.make} {vehicle.model} — {formatCents(vehicle.askingPriceCents)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Sale price
                          <input name="salePrice" inputMode="decimal" required size={9} />
                        </label>
                        <label>
                          Finance
                          <select name="financeType" defaultValue="CASH">
                            <option value="CASH">CASH</option>
                            <option value="FINANCE">FINANCE</option>
                            <option value="LEASE">LEASE</option>
                            <option value="BUY_HERE_PAY_HERE">BUY_HERE_PAY_HERE</option>
                            <option value="UNDECIDED">UNDECIDED</option>
                          </select>
                        </label>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </fieldset>
      ) : null}

      {canWrite ? (
        <fieldset>
          <legend>Walk-in sale (new customer)</legend>
          <ActionForm action={completeVehicleSaleAction} submitLabel="Complete sale">
            <label>
              Vehicle
              <select name="vehicleId" required defaultValue="">
                <option value="" disabled>
                  Choose
                </option>
                {available.items.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.year} {vehicle.make} {vehicle.model} — {formatCents(vehicle.askingPriceCents)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              First name
              <input name="firstName" required size={12} />
            </label>
            <label>
              Phone
              <input name="phone" size={12} />
            </label>
            <label>
              Email
              <input type="email" name="email" size={16} />
            </label>
            <label>
              Sale price
              <input name="salePrice" inputMode="decimal" required size={9} />
            </label>
            <label>
              Finance
              <select name="financeType" defaultValue="CASH">
                <option value="CASH">CASH</option>
                <option value="FINANCE">FINANCE</option>
              </select>
            </label>
          </ActionForm>
        </fieldset>
      ) : null}

      <h2>On the lot ({available.items.length})</h2>
      {available.items.length === 0 ? (
        <p className="muted">Nothing is published for sale.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Asking</th>
              <th>Live deal</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {available.items.map((vehicle) => {
              const deal = liveDeals.get(vehicle.id) ?? null;
              return (
                <tr key={vehicle.id}>
                  <td>
                    <Link href={`/cars/${vehicle.id}`}>
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </Link>
                    <div className="muted">{vehicle.stockNumber}</div>
                  </td>
                  <td>{formatCents(vehicle.askingPriceCents)}</td>
                  <td>{deal ? `${deal.status}` : <span className="muted">—</span>}</td>
                  <td>
                    {canWrite && deal ? (
                      <ActionForm action={cancelDealAction} submitLabel="Cancel deal">
                        <input type="hidden" name="dealId" value={deal.id} />
                        <label>
                          Reason
                          <input name="reason" size={18} />
                        </label>
                      </ActionForm>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Sold ({sold.total})</h2>
      {sold.items.length === 0 ? (
        <p className="muted">Nothing sold yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Sale price</th>
              <th>Sold</th>
              <th>Actual gross</th>
              <th>ROI</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody>
            {sold.items.map((vehicle) => (
              <tr key={vehicle.id}>
                <td>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                  <div className="muted">{vehicle.stockNumber}</div>
                </td>
                <td>{formatCents(vehicle.finalSalePriceCents)}</td>
                <td>{vehicle.dateSold ? vehicle.dateSold.toISOString().slice(0, 10) : "—"}</td>
                <td>{formatCents(vehicle.actualGrossProfitCents)}</td>
                <td>{formatBasisPoints(vehicle.actualRoiBasisPoints, 1)}</td>
                <td>{vehicle.daysInInventory ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
