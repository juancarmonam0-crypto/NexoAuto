import { ActionForm } from "@/app/_components/ActionForm";
import {
  acquireVehicleAction,
  createSourcingCandidateAction,
  recordSourcingDecisionAction,
} from "@/app/actions/buy";
import { hasCapability } from "@/lib/auth/roles";
import { formatBasisPoints, formatCents } from "@/lib/money";
import { listSourcingCandidates } from "@/lib/operations";
import { pageOperationContext } from "@/lib/operations/runtime";

/**
 * BUY — sourcing inbox.
 *
 * The page READS through the operation layer in a server component (no action
 * needed for a read) and MUTATES through server actions. Every economic figure
 * shown here is the snapshot the sourcing engine produced; this file does no
 * arithmetic of its own.
 */

export const dynamic = "force-dynamic";

export default async function BuyPage() {
  const ctx = await pageOperationContext("sourcing:read");
  const { items } = await listSourcingCandidates(ctx, { limit: 50 });

  // UX only. The action enforces the capability again on the server.
  const canWrite = hasCapability(ctx.actor.role, "sourcing:write");

  return (
    <>
      <h1>BUY</h1>
      <p className="muted">
        Score an opportunity against the dealership&apos;s floors, record the decision, then convert an approved
        opportunity into inventory.
      </p>

      {canWrite ? (
        <fieldset>
          <legend>New opportunity</legend>
          <ActionForm action={createSourcingCandidateAction} submitLabel="Save opportunity">
            <label>
              VIN
              <input name="vin" placeholder="17 characters" size={18} />
            </label>
            <label>
              Year
              <input name="year" inputMode="numeric" size={5} />
            </label>
            <label>
              Make
              <input name="make" size={10} />
            </label>
            <label>
              Model
              <input name="model" size={10} />
            </label>
            <label>
              Mileage
              <input name="mileage" inputMode="numeric" size={7} />
            </label>
            <label>
              Asking price
              <input name="askingPrice" inputMode="decimal" required size={9} />
            </label>
            <label>
              Auction fees
              <input name="auctionFees" inputMode="decimal" size={8} />
            </label>
            <label>
              Transport
              <input name="transport" inputMode="decimal" size={8} />
            </label>
            <label>
              Estimated recon
              <input name="estimatedRecon" inputMode="decimal" size={8} />
            </label>
            <label>
              Estimated retail
              <input name="estimatedRetail" inputMode="decimal" required size={9} />
            </label>
          </ActionForm>
          <p className="muted">
            The verdict comes from the canonical sourcing engine using the floors configured in dealer settings.
          </p>
        </fieldset>
      ) : (
        <p className="muted">Your role can review opportunities but not create or decide them.</p>
      )}

      <h2>Candidates ({items.length})</h2>
      {items.length === 0 ? (
        <p className="muted">No opportunities yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Status</th>
              <th>Verdict</th>
              <th>Landed</th>
              <th>Expected profit</th>
              <th>Max purchase</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {items.map((candidate) => (
              <tr key={candidate.id}>
                <td>
                  {[candidate.year, candidate.make, candidate.model].filter(Boolean).join(" ") || "Unidentified"}
                  <div className="muted">{candidate.vin ?? "No VIN on file"}</div>
                </td>
                <td>{candidate.status}</td>
                <td>
                  {candidate.recommendation ?? "—"}
                  {candidate.expectedRoiBasisPoints !== null ? (
                    <div className="muted">
                      ROI {formatBasisPoints(candidate.expectedRoiBasisPoints, 1)} · max bid{" "}
                      {formatCents(candidate.maxBidCents)}
                    </div>
                  ) : null}
                  {candidate.recommendationReasons[0] ? (
                    <div className="muted">{candidate.recommendationReasons[0]}</div>
                  ) : null}
                </td>
                <td>{formatCents(candidate.landedCostCents)}</td>
                <td>{formatCents(candidate.expectedProfitCents)}</td>
                <td>{formatCents(candidate.maxPurchasePriceCents)}</td>
                <td>
                  {canWrite && candidate.status !== "PURCHASED" ? (
                    <div className="row">
                      <ActionForm action={recordSourcingDecisionAction} submitLabel="Approve to buy">
                        <input type="hidden" name="candidateId" value={candidate.id} />
                        <input type="hidden" name="status" value="APPROVED_TO_BUY" />
                      </ActionForm>
                      <ActionForm action={recordSourcingDecisionAction} submitLabel="Pass">
                        <input type="hidden" name="candidateId" value={candidate.id} />
                        <input type="hidden" name="status" value="PASSED" />
                      </ActionForm>
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}

                  {canWrite && candidate.status === "APPROVED_TO_BUY" ? (
                    <fieldset>
                      <legend>Acquire</legend>
                      <ActionForm action={acquireVehicleAction} submitLabel="Create vehicle">
                        <input type="hidden" name="candidateId" value={candidate.id} />
                        <label>
                          VIN
                          <input name="vin" defaultValue={candidate.vin ?? ""} required size={18} />
                        </label>
                        <label>
                          Year
                          <input name="year" defaultValue={candidate.year ?? ""} required inputMode="numeric" size={5} />
                        </label>
                        <label>
                          Make
                          <input name="make" defaultValue={candidate.make ?? ""} required size={10} />
                        </label>
                        <label>
                          Model
                          <input name="model" defaultValue={candidate.model ?? ""} required size={10} />
                        </label>
                        <label>
                          Mileage
                          <input
                            name="mileage"
                            defaultValue={candidate.mileage ?? ""}
                            required
                            inputMode="numeric"
                            size={7}
                          />
                        </label>
                        <label>
                          Purchase price
                          <input
                            name="purchasePrice"
                            defaultValue={(candidate.askingPriceCents / 100).toFixed(2)}
                            required
                            inputMode="decimal"
                            size={9}
                          />
                        </label>
                        <label>
                          Auction fees
                          <input
                            name="auctionFees"
                            defaultValue={(candidate.expectedAuctionFeesCents / 100).toFixed(2)}
                            inputMode="decimal"
                            size={8}
                          />
                        </label>
                        <label>
                          Transport
                          <input
                            name="transport"
                            defaultValue={(candidate.transportEstimateCents / 100).toFixed(2)}
                            inputMode="decimal"
                            size={8}
                          />
                        </label>
                        <label>
                          Asking price
                          <input
                            name="askingPrice"
                            defaultValue={(candidate.estimatedRetailCents / 100).toFixed(2)}
                            inputMode="decimal"
                            size={9}
                          />
                        </label>
                      </ActionForm>
                    </fieldset>
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
