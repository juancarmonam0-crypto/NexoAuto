"use server";

import { ActionError, type ActionResult, runOperation } from "@/lib/action-result";
import type {
  ExpenseRecordedContract,
  PhotoContract,
  ReconItemContract,
  VehicleMutationContract,
} from "@/lib/boundary/contracts";
import {
  enumField,
  optionalFormCents,
  optionalFormDate,
  optionalFormInt,
  optionalFormString,
  requireFormCents,
  requireFormInt,
  requireFormString,
  suppliedOnly,
} from "@/lib/forms";
import {
  ACQUISITION_SOURCES,
  EXPENSE_CATEGORIES,
  RECON_STATUSES,
  TITLE_STATUSES,
  deleteVehiclePhoto,
  publishVehicle,
  recordReconItem,
  recordVehicleExpense,
  setPrimaryVehiclePhoto,
  transitionVehicleStatus,
  unpublishVehicle,
  updateReconItem,
  updateVehicleAcquisition,
  updateVehicleDetails,
  updateVehiclePricing,
  uploadVehiclePhoto,
} from "@/lib/operations";
import { operationContext } from "@/lib/operations/runtime";
import { ALL_VEHICLE_STATUSES } from "@/lib/vehicle-status";

/**
 * CARS — the inventory boundary.
 *
 * Each call resolves the actor from the session and delegates. Note what is NOT
 * here: no profit maths, no field masking, no lifecycle rules. `updateVehiclePricing`
 * returns the already-masked view, so a salesperson's response carries `null`
 * for landed cost without this file knowing anything about roles.
 */

function vehicleMutationContract(vehicle: {
  id: string;
  status: string;
  listingStatus: string;
  askingPriceCents: number | null;
  landedCostCents: number | null;
}): VehicleMutationContract {
  return {
    vehicleId: vehicle.id,
    status: vehicle.status,
    listingStatus: vehicle.listingStatus,
    askingPriceCents: vehicle.askingPriceCents,
    landedCostCents: vehicle.landedCostCents,
  };
}

/** Descriptive fields only. Capability: `inventory:write`. */
export async function updateVehicleDetailsAction(
  formData: FormData,
): Promise<ActionResult<VehicleMutationContract>> {
  return runOperation("cars.updateVehicleDetails", async () => {
    const ctx = await operationContext("inventory:write");
    const vehicleId = requireFormString(formData, "vehicleId", "Vehicle");
    const patch = suppliedOnly({
      trim: optionalFormString(formData, "trim"),
      exteriorColor: optionalFormString(formData, "exteriorColor"),
      interiorColor: optionalFormString(formData, "interiorColor"),
      transmission: optionalFormString(formData, "transmission"),
      drivetrain: optionalFormString(formData, "drivetrain"),
      engine: optionalFormString(formData, "engine"),
      fuelType: optionalFormString(formData, "fuelType"),
      bodyType: optionalFormString(formData, "bodyType"),
      doors: optionalFormInt(formData, "doors", "Doors"),
      seats: optionalFormInt(formData, "seats", "Seats"),
      mileage: optionalFormInt(formData, "mileage", "Mileage"),
      location: optionalFormString(formData, "location"),
      notes: optionalFormString(formData, "notes"),
      description: optionalFormString(formData, "description"),
      // Title status and the equipment list are accepted by the operation
      // (`vehicleDetailsSchema`) and shown publicly, but were never forwarded
      // from the boundary — parsing only, no business rule added here.
      titleStatus: optionalFormString(formData, "titleStatus")
        ? enumField(formData, "titleStatus", TITLE_STATUSES, undefined, "Title status")
        : undefined,
      features: optionalFormString(formData, "features")
        ?.split(",")
        .map((feature) => feature.trim())
        .filter((feature) => feature !== ""),
    });
    if (Object.keys(patch).length === 0) throw new ActionError("Nothing to update.");
    return vehicleMutationContract(await updateVehicleDetails(ctx, vehicleId, patch));
  });
}

/** Target, asking and minimum approved prices. Capability: `pricing:write`. */
export async function updateVehiclePricingAction(
  formData: FormData,
): Promise<ActionResult<VehicleMutationContract>> {
  return runOperation("cars.updateVehiclePricing", async () => {
    const ctx = await operationContext("pricing:write");
    const vehicleId = requireFormString(formData, "vehicleId", "Vehicle");
    const patch = suppliedOnly({
      targetRetailPriceCents: optionalFormCents(formData, "targetRetail", "Target retail"),
      askingPriceCents: optionalFormCents(formData, "askingPrice", "Asking price"),
      minimumApprovedCents: optionalFormCents(formData, "minimumApproved", "Minimum approved"),
    });
    if (Object.keys(patch).length === 0) throw new ActionError("Nothing to update.");
    return vehicleMutationContract(await updateVehiclePricing(ctx, vehicleId, patch));
  });
}

/** Acquisition cost block. Capability: `pricing:write`. */
export async function updateVehicleAcquisitionAction(
  formData: FormData,
): Promise<ActionResult<VehicleMutationContract>> {
  return runOperation("cars.updateVehicleAcquisition", async () => {
    const ctx = await operationContext("pricing:write");
    const vehicleId = requireFormString(formData, "vehicleId", "Vehicle");
    const patch = suppliedOnly({
      acquisitionSource: optionalFormString(formData, "acquisitionSource")
        ? enumField(formData, "acquisitionSource", ACQUISITION_SOURCES, undefined, "Acquisition source")
        : undefined,
      acquisitionDate: optionalFormDate(formData, "acquisitionDate", "Acquisition date"),
      acquisitionPriceCents: optionalFormCents(formData, "acquisitionPrice", "Acquisition price"),
      auctionFeesCents: optionalFormCents(formData, "auctionFees", "Auction fees"),
      transportationCents: optionalFormCents(formData, "transport", "Transport"),
      inspectionCents: optionalFormCents(formData, "inspection", "Inspection"),
      otherAcquisitionCents: optionalFormCents(formData, "otherCosts", "Other costs"),
      reconOverrideCents: optionalFormCents(formData, "reconOverride", "Recon override"),
    });
    if (Object.keys(patch).length === 0) throw new ActionError("Nothing to update.");
    return vehicleMutationContract(await updateVehicleAcquisition(ctx, vehicleId, patch));
  });
}

/** Capability: `expenses:write`. */
export async function recordVehicleExpenseAction(
  formData: FormData,
): Promise<ActionResult<ExpenseRecordedContract>> {
  return runOperation("cars.recordVehicleExpense", async () => {
    const ctx = await operationContext("expenses:write");
    const expense = await recordVehicleExpense(ctx, {
      vehicleId: requireFormString(formData, "vehicleId", "Vehicle"),
      category: enumField(formData, "category", EXPENSE_CATEGORIES, undefined, "Category"),
      amountCents: requireFormCents(formData, "amount", "Amount"),
      vendor: optionalFormString(formData, "vendor"),
      incurredOn: optionalFormDate(formData, "incurredOn", "Incurred on"),
      description: optionalFormString(formData, "description"),
    });
    return {
      expenseId: expense.id,
      vehicleId: expense.vehicleId,
      category: expense.category,
      amountCents: expense.amountCents,
      incurredOnIso: expense.incurredOn.toISOString(),
    };
  });
}

function reconContract(item: {
  id: string;
  vehicleId: string;
  status: string;
  estimateCents: number;
  actualCostCents: number | null;
}): ReconItemContract {
  return {
    reconItemId: item.id,
    vehicleId: item.vehicleId,
    status: item.status,
    estimateCents: item.estimateCents,
    actualCostCents: item.actualCostCents,
  };
}

/** Capability: `recon:write`. */
export async function recordReconItemAction(
  formData: FormData,
): Promise<ActionResult<ReconItemContract>> {
  return runOperation("cars.recordReconItem", async () => {
    const ctx = await operationContext("recon:write");
    const item = await recordReconItem(ctx, {
      vehicleId: requireFormString(formData, "vehicleId", "Vehicle"),
      issue: requireFormString(formData, "issue", "Issue"),
      vendor: optionalFormString(formData, "vendor"),
      estimateCents: optionalFormCents(formData, "estimate", "Estimate"),
      actualCostCents: optionalFormCents(formData, "actualCost", "Actual cost"),
      status: enumField(formData, "status", RECON_STATUSES, "ESTIMATED", "Status"),
    });
    return reconContract(item);
  });
}

/** Capability: `recon:write`. */
export async function updateReconItemAction(
  formData: FormData,
): Promise<ActionResult<ReconItemContract>> {
  return runOperation("cars.updateReconItem", async () => {
    const ctx = await operationContext("recon:write");
    const item = await updateReconItem(ctx, requireFormString(formData, "reconItemId", "Recon item"), {
      status: enumField(formData, "status", RECON_STATUSES, undefined, "Status"),
      actualCostCents: optionalFormCents(formData, "actualCost", "Actual cost"),
    });
    return reconContract(item);
  });
}

/** Lifecycle move. Capability: `inventory:write` (managers only for disposal). */
export async function transitionVehicleStatusAction(
  formData: FormData,
): Promise<ActionResult<VehicleMutationContract>> {
  return runOperation("cars.transitionVehicleStatus", async () => {
    const ctx = await operationContext("inventory:write");
    const vehicle = await transitionVehicleStatus(ctx, {
      vehicleId: requireFormString(formData, "vehicleId", "Vehicle"),
      toStatus: enumField(formData, "toStatus", ALL_VEHICLE_STATUSES, undefined, "Status"),
      note: optionalFormString(formData, "note"),
    });
    return vehicleMutationContract(vehicle);
  });
}

/** Capability: `pricing:write`. */
export async function publishVehicleAction(
  formData: FormData,
): Promise<ActionResult<VehicleMutationContract>> {
  return runOperation("cars.publishVehicle", async () => {
    const ctx = await operationContext("pricing:write");
    return vehicleMutationContract(
      await publishVehicle(ctx, requireFormString(formData, "vehicleId", "Vehicle")),
    );
  });
}

/** Capability: `pricing:write`. */
export async function unpublishVehicleAction(
  formData: FormData,
): Promise<ActionResult<VehicleMutationContract>> {
  return runOperation("cars.unpublishVehicle", async () => {
    const ctx = await operationContext("pricing:write");
    return vehicleMutationContract(
      await unpublishVehicle(ctx, requireFormString(formData, "vehicleId", "Vehicle")),
    );
  });
}

/**
 * Photo upload through the existing storage boundary. Capability: `inventory:write`.
 *
 * The bytes are validated server-side by magic number before they are stored;
 * the declared MIME type from the browser is never trusted.
 */
export async function uploadVehiclePhotoAction(
  formData: FormData,
): Promise<ActionResult<PhotoContract>> {
  return runOperation("cars.uploadVehiclePhoto", async () => {
    const ctx = await operationContext("inventory:write");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ActionError("Choose an image to upload.");
    }
    const photo = await uploadVehiclePhoto(ctx, {
      vehicleId: requireFormString(formData, "vehicleId", "Vehicle"),
      fileName: file.name,
      declaredMimeType: file.type,
      alt: optionalFormString(formData, "alt"),
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return { photoId: photo.id, vehicleId: photo.vehicleId, url: photo.url, isPrimary: photo.isPrimary };
  });
}

/** Capability: `inventory:write`. */
export async function deleteVehiclePhotoAction(
  formData: FormData,
): Promise<ActionResult<{ photoId: string }>> {
  return runOperation("cars.deleteVehiclePhoto", async () => {
    const ctx = await operationContext("inventory:write");
    const photoId = requireFormString(formData, "photoId", "Photo");
    await deleteVehiclePhoto(ctx, photoId);
    return { photoId };
  });
}

/** Capability: `inventory:write`. */
export async function setPrimaryVehiclePhotoAction(
  formData: FormData,
): Promise<ActionResult<PhotoContract>> {
  return runOperation("cars.setPrimaryVehiclePhoto", async () => {
    const ctx = await operationContext("inventory:write");
    const photo = await setPrimaryVehiclePhoto(ctx, requireFormString(formData, "photoId", "Photo"));
    return { photoId: photo.id, vehicleId: photo.vehicleId, url: photo.url, isPrimary: photo.isPrimary };
  });
}
