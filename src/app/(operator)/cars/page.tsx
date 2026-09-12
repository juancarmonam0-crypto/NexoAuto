import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import { publishVehicleAction, unpublishVehicleAction } from "@/app/actions/cars";
import { hasCapability } from "@/lib/auth/roles";
import { formatCents } from "@/lib/money";
import { listInventory } from "@/lib/operations";
import { pageOperationContext } from "@/lib/operations/runtime";

/**
 * CARS — inventory list.
 *
 * The cost column is the visible proof of masking: `listInventory` returns
 * `landedCostCents: null` for a role without `finance:read`, so a salesperson
 * sees the sticker and not the dealer's cost basis.
 */

export const dynamic = "force-dynamic";

export default async function CarsPage() {
  const ctx = await pageOperationContext("inventory:read");
  const { items, total } = await listInventory(ctx, { limit: 100 });

  // UX only; the actions re-check on the server.
  const canPrice = hasCapability(ctx.actor.role, "pricing:write");

  return (
    <>
      <h1>CARS</h1>
      <p className="muted">
        {total} vehicle{total === 1 ? "" : "s"} on the books. Landed cost is shown only when your role may see it.
      </p>

      {items.length === 0 ? (
        <p className="muted">No inventory yet. Acquire a vehicle from BUY.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Status</th>
              <th>Listing</th>
              <th>Mileage</th>
              <th>Asking</th>
              <th>Landed</th>
              <th>Days</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((vehicle) => (
              <tr key={vehicle.id}>
                <td>
                  <Link href={`/cars/${vehicle.id}`}>
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </Link>
                  <div className="muted">{vehicle.stockNumber}</div>
                </td>
                <td>{vehicle.status}</td>
                <td>{vehicle.listingStatus}</td>
                <td>{vehicle.mileage.toLocaleString("en-US")}</td>
                <td>{formatCents(vehicle.askingPriceCents)}</td>
                <td>{formatCents(vehicle.landedCostCents)}</td>
                <td>{vehicle.daysInInventory ?? "—"}</td>
                <td>
                  {canPrice ? (
                    vehicle.listingStatus === "ACTIVE" ? (
                      <ActionForm action={unpublishVehicleAction} submitLabel="Unpublish">
                        <input type="hidden" name="vehicleId" value={vehicle.id} />
                      </ActionForm>
                    ) : (
                      <ActionForm action={publishVehicleAction} submitLabel="Publish">
                        <input type="hidden" name="vehicleId" value={vehicle.id} />
                      </ActionForm>
                    )
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
