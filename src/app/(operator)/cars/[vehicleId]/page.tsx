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
import { formatBasisPoints, formatCents } from "@/lib/money";
import { EXPENSE_CATEGORIES, getVehicleDetail } from "@/lib/operations";
import { pageOperationContext } from "@/lib/operations/runtime";
import { allowedTransitions, STATUS_LABELS } from "@/lib/vehicle-status";

/**
 * CARS — vehicle detail and the inventory mutations.
 *
 * Every form posts to a server action that re-authorizes and delegates. The
 * capability checks below decide what to RENDER; they are not the security
 * boundary. The expense and recon sections are absent entirely for a role that
 * may not read them, because the operation omits those rows rather than masking
 * them field by field.
 */

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

  return (
    <>
      <p>
        <Link href="/cars">← CARS</Link>
      </p>
      <h1>
        {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim ?? ""}
      </h1>
      <p className="muted">
        {vehicle.stockNumber} · VIN {vehicle.vin} · {vehicle.status} / {vehicle.listingStatus}
        {detail.publiclyVisible ? " · publicly visible" : ""}
      </p>

      <div className="card">
        <div className="row">
          <span>Asking {formatCents(vehicle.askingPriceCents)}</span>
          <span>Target {formatCents(vehicle.targetRetailPriceCents)}</span>
          <span>Minimum {formatCents(vehicle.minimumApprovedCents)}</span>
          <span>Landed {formatCents(vehicle.landedCostCents)}</span>
          <span>Est. gross {formatCents(vehicle.estimatedGrossProfitCents)}</span>
          <span>Actual gross {formatCents(vehicle.actualGrossProfitCents)}</span>
          <span>ROI {formatBasisPoints(vehicle.actualRoiBasisPoints ?? vehicle.estimatedRoiBasisPoints, 1)}</span>
          <span>Days {vehicle.daysInInventory ?? "—"}</span>
        </div>
        <p className="muted">
          A dash means either &ldquo;not recorded&rdquo; or &ldquo;not visible to your role&rdquo;. Cost, floor and
          margin are withheld unless your role holds finance:read.
        </p>
      </div>

      {canPrice ? (
        <fieldset>
          <legend>Pricing</legend>
          <ActionForm action={updateVehiclePricingAction} submitLabel="Save pricing">
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <label>
              Target retail
              <input
                name="targetRetail"
                defaultValue={vehicle.targetRetailPriceCents !== null ? (vehicle.targetRetailPriceCents / 100).toFixed(2) : ""}
                inputMode="decimal"
                size={9}
              />
            </label>
            <label>
              Asking price
              <input
                name="askingPrice"
                defaultValue={vehicle.askingPriceCents !== null ? (vehicle.askingPriceCents / 100).toFixed(2) : ""}
                inputMode="decimal"
                size={9}
              />
            </label>
            <label>
              Minimum approved
              <input
                name="minimumApproved"
                defaultValue={vehicle.minimumApprovedCents !== null ? (vehicle.minimumApprovedCents / 100).toFixed(2) : ""}
                inputMode="decimal"
                size={9}
              />
            </label>
          </ActionForm>
          <div className="row">
            {vehicle.listingStatus === "ACTIVE" ? (
              <ActionForm action={unpublishVehicleAction} submitLabel="Unpublish">
                <input type="hidden" name="vehicleId" value={vehicle.id} />
              </ActionForm>
            ) : (
              <ActionForm action={publishVehicleAction} submitLabel="Publish">
                <input type="hidden" name="vehicleId" value={vehicle.id} />
              </ActionForm>
            )}
          </div>
        </fieldset>
      ) : null}

      {canWriteInventory ? (
        <fieldset>
          <legend>Listing details</legend>
          <ActionForm action={updateVehicleDetailsAction} submitLabel="Save details">
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <label>
              Mileage
              <input name="mileage" defaultValue={vehicle.mileage} inputMode="numeric" size={7} />
            </label>
            <label>
              Exterior colour
              <input name="exteriorColor" defaultValue={vehicle.exteriorColor ?? ""} size={12} />
            </label>
            <label>
              Interior colour
              <input name="interiorColor" defaultValue={vehicle.interiorColor ?? ""} size={12} />
            </label>
            <label>
              Location
              <input name="location" defaultValue={vehicle.location ?? ""} size={12} />
            </label>
            <label>
              Description
              <textarea name="description" defaultValue={vehicle.description ?? ""} rows={3} cols={40} />
            </label>
            <label>
              Internal notes
              <textarea name="notes" defaultValue={vehicle.notes ?? ""} rows={2} cols={40} />
            </label>
          </ActionForm>
        </fieldset>
      ) : null}

      {canWriteInventory ? (
        <fieldset>
          <legend>Lifecycle</legend>
          <ActionForm action={transitionVehicleStatusAction} submitLabel="Move status">
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <label>
              New status
              <select name="toStatus" required defaultValue="">
                <option value="" disabled>
                  Choose
                </option>
                {allowedTransitions(vehicle.status).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <input name="note" size={24} />
            </label>
          </ActionForm>
          <p className="muted">
            Only transitions the lifecycle allows are listed. SOLD, DELIVERED and RESERVED are set by their own
            workflows.
          </p>
        </fieldset>
      ) : null}

      {canExpense ? (
        <fieldset>
          <legend>Expenses</legend>
          <ActionForm action={recordVehicleExpenseAction} submitLabel="Record expense">
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <label>
              Category
              <select name="category" required defaultValue="PARTS">
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input name="amount" inputMode="decimal" required size={9} />
            </label>
            <label>
              Vendor
              <input name="vendor" size={14} />
            </label>
            <label>
              Date
              <input type="date" name="incurredOn" />
            </label>
          </ActionForm>
          {detail.expenses && detail.expenses.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Vendor</th>
                  <th>Incurred</th>
                </tr>
              </thead>
              <tbody>
                {detail.expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{expense.category}</td>
                    <td>{formatCents(expense.amountCents)}</td>
                    <td>{expense.vendor ?? "—"}</td>
                    <td>{expense.incurredOn.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No expenses recorded.</p>
          )}
        </fieldset>
      ) : null}

      {canRecon ? (
        <fieldset>
          <legend>Reconditioning</legend>
          <ActionForm action={recordReconItemAction} submitLabel="Add recon item">
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <label>
              Issue
              <input name="issue" required size={28} />
            </label>
            <label>
              Estimate
              <input name="estimate" inputMode="decimal" size={9} />
            </label>
            <label>
              Actual cost
              <input name="actualCost" inputMode="decimal" size={9} />
            </label>
            <label>
              Status
              <select name="status" defaultValue="ESTIMATED">
                <option value="ESTIMATED">ESTIMATED</option>
                <option value="APPROVED">APPROVED</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </label>
          </ActionForm>
          {detail.reconItems && detail.reconItems.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Status</th>
                  <th>Estimate</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
                {detail.reconItems.map((item) => (
                  <tr key={item.id}>
                    <td>{item.issue}</td>
                    <td>{item.status}</td>
                    <td>{formatCents(item.estimateCents)}</td>
                    <td>{formatCents(item.actualCostCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No reconditioning items recorded.</p>
          )}
        </fieldset>
      ) : null}

      {canWriteInventory ? (
        <fieldset>
          <legend>Photos</legend>
          <ActionForm action={uploadVehiclePhotoAction} submitLabel="Upload photo">
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <label>
              Image (JPEG, PNG or WebP)
              <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required />
            </label>
            <label>
              Alt text
              <input name="alt" size={24} />
            </label>
          </ActionForm>
          {detail.photos.length === 0 ? (
            <p className="muted">No photos uploaded.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Primary</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.photos.map((photo) => (
                  <tr key={photo.id}>
                    <td>{photo.alt ?? photo.url}</td>
                    <td>{photo.isPrimary ? "Yes" : "No"}</td>
                    <td>
                      <div className="row">
                        {!photo.isPrimary ? (
                          <ActionForm action={setPrimaryVehiclePhotoAction} submitLabel="Make primary">
                            <input type="hidden" name="photoId" value={photo.id} />
                          </ActionForm>
                        ) : null}
                        <ActionForm action={deleteVehiclePhotoAction} submitLabel="Delete">
                          <input type="hidden" name="photoId" value={photo.id} />
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </fieldset>
      ) : null}

      <h2>History</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>From</th>
            <th>To</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {detail.statusEvents.map((event) => (
            <tr key={event.id}>
              <td>{event.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              <td>{event.fromStatus ?? "—"}</td>
              <td>{event.toStatus}</td>
              <td>{event.note ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
