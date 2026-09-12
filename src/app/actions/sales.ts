"use server";

import { type ActionResult, runOperation } from "@/lib/action-result";
import type { DealCancelledContract, SaleCompletedContract } from "@/lib/boundary/contracts";
import {
  enumField,
  optionalFormCents,
  optionalFormDate,
  optionalFormString,
  requireFormCents,
  requireFormString,
} from "@/lib/forms";
import {
  CONTACT_METHODS,
  FINANCE_TYPES,
  cancelDeal,
  completeVehicleSale,
} from "@/lib/operations";
import { operationContext } from "@/lib/operations/runtime";

/**
 * SALES — completing and unwinding a deal.
 *
 * `completeVehicleSale` is the single most consequential operation in the
 * product, and this boundary adds nothing to it: no price validation, no profit
 * calculation, no state juggling. It reports the economics the operation
 * computed, already masked for the acting role (a salesperson receives `null`
 * for cost and profit).
 */

/** Capability: `deals:write`. */
export async function completeVehicleSaleAction(
  formData: FormData,
): Promise<ActionResult<SaleCompletedContract>> {
  return runOperation("sales.completeVehicleSale", async () => {
    const ctx = await operationContext("deals:write");
    const customerId = optionalFormString(formData, "customerId");

    const sale = await completeVehicleSale(ctx, {
      vehicleId: requireFormString(formData, "vehicleId", "Vehicle"),
      customerId,
      customer: customerId
        ? undefined
        : {
            firstName: requireFormString(formData, "firstName", "First name"),
            lastName: optionalFormString(formData, "lastName"),
            email: optionalFormString(formData, "email"),
            phone: optionalFormString(formData, "phone"),
            preferredContact: enumField(formData, "preferredContact", CONTACT_METHODS, "ANY", "Preferred contact"),
          },
      leadId: optionalFormString(formData, "leadId"),
      salePriceCents: requireFormCents(formData, "salePrice", "Sale price"),
      dealerFeesCents: optionalFormCents(formData, "dealerFees", "Dealer fees"),
      financeType: enumField(formData, "financeType", FINANCE_TYPES, "UNDECIDED", "Finance type"),
      saleDate: optionalFormDate(formData, "saleDate", "Sale date"),
      notes: optionalFormString(formData, "notes"),
    });

    return {
      dealId: sale.dealId,
      vehicleId: sale.vehicleId,
      customerId: sale.customerId,
      dealStatus: sale.dealStatus,
      vehicleStatus: sale.vehicleStatus,
      finalSalePriceCents: sale.finalSalePriceCents,
      // Dates cross the boundary as ISO strings, never as Date objects.
      saleDateIso: sale.saleDate.toISOString(),
      daysInInventory: sale.daysInInventory,
      landedCostCents: sale.landedCostCents,
      actualGrossProfitCents: sale.actualGrossProfitCents,
      actualRoiBasisPoints: sale.actualRoiBasisPoints,
    };
  });
}

/**
 * Cancels a live deal and releases the vehicle. Capability: `deals:write`.
 *
 * This is the sanctioned way to unwind a sale; the inventory operations refuse
 * to republish a vehicle that still carries a recorded sale.
 */
export async function cancelDealAction(
  formData: FormData,
): Promise<ActionResult<DealCancelledContract>> {
  return runOperation("sales.cancelDeal", async () => {
    const ctx = await operationContext("deals:write");
    const cancelled = await cancelDeal(ctx, {
      dealId: requireFormString(formData, "dealId", "Deal"),
      reason: optionalFormString(formData, "reason"),
    });
    return {
      dealId: cancelled.dealId,
      status: cancelled.status,
      vehicleId: cancelled.vehicleId,
      vehicleStatus: cancelled.vehicleStatus,
    };
  });
}
