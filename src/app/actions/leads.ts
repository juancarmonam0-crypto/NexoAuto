"use server";

import { type ActionResult, runOperation } from "@/lib/action-result";
import type { LeadContract, LeadNoteContract } from "@/lib/boundary/contracts";
import {
  enumField,
  optionalFormDate,
  optionalFormString,
  requireFormString,
  suppliedOnly,
} from "@/lib/forms";
import { ALL_LEAD_STATUSES } from "@/lib/lead-status";
import {
  CONTACT_METHODS,
  LEAD_SOURCES,
  addLeadNote,
  createLead,
  updateLeadContact,
  updateLeadDetails,
  updateLeadStatus,
} from "@/lib/operations";
import { operationContext } from "@/lib/operations/runtime";

/**
 * LEADS — the small CRM boundary.
 *
 * Status legality lives in `lead-status.ts` and is enforced by the operation;
 * this file only validates the form and reports the outcome.
 */

function leadContract(lead: {
  id: string;
  customerId: string;
  status: string;
  vehicleId: string | null;
}): LeadContract {
  return {
    leadId: lead.id,
    customerId: lead.customerId,
    status: lead.status,
    vehicleId: lead.vehicleId,
  };
}

/** Capability: `crm:write`. Creates the customer too when no id is supplied. */
export async function createLeadAction(formData: FormData): Promise<ActionResult<LeadContract>> {
  return runOperation("leads.createLead", async () => {
    const ctx = await operationContext("crm:write");
    const customerId = optionalFormString(formData, "customerId");
    const lead = await createLead(ctx, {
      customerId,
      customer: customerId
        ? undefined
        : {
            firstName: requireFormString(formData, "firstName", "First name"),
            lastName: optionalFormString(formData, "lastName"),
            email: optionalFormString(formData, "email"),
            phone: optionalFormString(formData, "phone"),
            preferredContact: enumField(formData, "preferredContact", CONTACT_METHODS, "ANY", "Preferred contact"),
            notes: optionalFormString(formData, "notes"),
          },
      vehicleId: optionalFormString(formData, "vehicleId"),
      source: enumField(formData, "source", LEAD_SOURCES, "WEBSITE_INQUIRY", "Source"),
      summary: optionalFormString(formData, "summary"),
      nextFollowUpAt: optionalFormDate(formData, "nextFollowUpAt", "Next follow-up"),
    });
    return leadContract(lead);
  });
}

/** Contact details. Capability: `crm:write`. */
export async function updateLeadContactAction(
  formData: FormData,
): Promise<ActionResult<LeadContract>> {
  return runOperation("leads.updateLeadContact", async () => {
    const ctx = await operationContext("crm:write");
    const lead = await updateLeadContact(
      ctx,
      requireFormString(formData, "leadId", "Lead"),
      suppliedOnly({
        firstName: optionalFormString(formData, "firstName"),
        lastName: optionalFormString(formData, "lastName"),
        email: optionalFormString(formData, "email"),
        phone: optionalFormString(formData, "phone"),
        preferredContact: optionalFormString(formData, "preferredContact")
          ? enumField(formData, "preferredContact", CONTACT_METHODS, "ANY", "Preferred contact")
          : undefined,
        addressLine1: optionalFormString(formData, "addressLine1"),
        city: optionalFormString(formData, "city"),
        state: optionalFormString(formData, "state"),
        postalCode: optionalFormString(formData, "postalCode"),
        notes: optionalFormString(formData, "notes"),
      }),
    );
    return leadContract(lead);
  });
}

/**
 * Lifecycle move. Capability: `crm:write`.
 *
 * An illegal move is refused by the state machine, and a LOST lead without a
 * reason is refused by the operation — both surface as `INVALID_STATE` or
 * `VALIDATION_ERROR`, never as a 500.
 */
export async function updateLeadStatusAction(
  formData: FormData,
): Promise<ActionResult<LeadContract>> {
  return runOperation("leads.updateLeadStatus", async () => {
    const ctx = await operationContext("crm:write");
    const lead = await updateLeadStatus(ctx, {
      leadId: requireFormString(formData, "leadId", "Lead"),
      status: enumField(formData, "status", ALL_LEAD_STATUSES, undefined, "Status"),
      lostReason: optionalFormString(formData, "lostReason"),
      note: optionalFormString(formData, "note"),
    });
    return leadContract(lead);
  });
}

/** Summary, vehicle link, assignee, follow-up. Capability: `crm:write`. */
export async function updateLeadDetailsAction(
  formData: FormData,
): Promise<ActionResult<LeadContract>> {
  return runOperation("leads.updateLeadDetails", async () => {
    const ctx = await operationContext("crm:write");
    const lead = await updateLeadDetails(
      ctx,
      requireFormString(formData, "leadId", "Lead"),
      suppliedOnly({
        summary: optionalFormString(formData, "summary"),
        vehicleId: optionalFormString(formData, "vehicleId"),
        nextFollowUpAt: optionalFormDate(formData, "nextFollowUpAt", "Next follow-up"),
      }),
    );
    return leadContract(lead);
  });
}

/** A note on the lead timeline. Capability: `crm:write`. */
export async function addLeadNoteAction(
  formData: FormData,
): Promise<ActionResult<LeadNoteContract>> {
  return runOperation("leads.addLeadNote", async () => {
    const ctx = await operationContext("crm:write");
    const note = await addLeadNote(ctx, {
      leadId: requireFormString(formData, "leadId", "Lead"),
      body: requireFormString(formData, "body", "Note"),
    });
    return { leadId: note.leadId, activityId: note.id, createdAtIso: note.createdAt.toISOString() };
  });
}
