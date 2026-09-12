import { z } from "zod";
import type {
  ContactMethod,
  Lead,
  LeadActivity,
  LeadActivityType,
  LeadSource,
  LeadStatus,
  Prisma,
} from "@/generated/prisma";
import { ActionError } from "@/lib/action-result";
import { ConflictError, NotFoundError } from "@/lib/domain-errors";
import {
  ALL_LEAD_STATUSES,
  assertLeadTransition,
  leadStatusLabel,
  touchesCustomerOnTransition,
} from "@/lib/lead-status";
import { assertCapability, type OperationContext } from "./context";
import { recordIdSchema, requiredText } from "./schemas";

/**
 * LEADS — a deliberately small CRM.
 *
 * Scope is intentional: capture a lead, keep its contact details correct, walk
 * it along the approved lifecycle, attach it to a car, leave a note. There is
 * no scoring, no campaign, no automation and no messaging integration — those
 * are Phase 10 concerns and the database does not need them yet.
 *
 * Every status change writes a `LeadActivity` with `fromStatus`/`toStatus`, so
 * the history exists without a second timeline system.
 */

export const LEAD_SOURCES = [
  "WEBSITE_INQUIRY",
  "PHONE",
  "WALK_IN",
  "REFERRAL",
  "MARKETPLACE",
  "TRADE_IN",
  "AUCTION",
  "REPEAT_CUSTOMER",
  "OTHER",
] as const satisfies readonly LeadSource[];

export const CONTACT_METHODS = ["PHONE", "EMAIL", "TEXT", "ANY"] as const satisfies readonly ContactMethod[];

export const LEAD_ACTIVITY_TYPES = [
  "NOTE",
  "CALL",
  "EMAIL",
  "TEXT",
  "APPOINTMENT",
  "STATUS_CHANGE",
  "TASK",
  "DOCUMENT",
] as const satisfies readonly LeadActivityType[];

/** Customer details, shared by create-lead and update-contact. */
const customerFields = {
  firstName: requiredText(80),
  lastName: requiredText(80).nullable(),
  email: z.email().max(200).nullable(),
  phone: requiredText(40).nullable(),
  preferredContact: z.enum(CONTACT_METHODS),
  addressLine1: requiredText(200).nullable(),
  city: requiredText(80).nullable(),
  state: requiredText(40).nullable(),
  postalCode: requiredText(20).nullable(),
  notes: z.string().trim().max(5_000).nullable(),
};

export const newCustomerSchema = z.object({
  firstName: customerFields.firstName,
  lastName: customerFields.lastName.optional(),
  email: customerFields.email.optional(),
  phone: customerFields.phone.optional(),
  preferredContact: customerFields.preferredContact.optional(),
  addressLine1: customerFields.addressLine1.optional(),
  city: customerFields.city.optional(),
  state: customerFields.state.optional(),
  postalCode: customerFields.postalCode.optional(),
  notes: customerFields.notes.optional(),
});

/** Every field optional; used to edit an existing customer's details. */
export const customerPatchSchema = z.object(customerFields).partial().strict();

export type NewCustomerInput = z.input<typeof newCustomerSchema>;
export type CustomerPatch = z.input<typeof customerPatchSchema>;

/**
 * `customers_has_contact` requires a phone or an email. Checked here so the
 * operator gets a sentence instead of a constraint violation.
 */
function assertContactable(customer: { phone?: string | null; email?: string | null }): void {
  const hasPhone = typeof customer.phone === "string" && customer.phone.trim() !== "";
  const hasEmail = typeof customer.email === "string" && customer.email.trim() !== "";
  if (!hasPhone && !hasEmail) {
    throw new ActionError("A customer needs a phone number or an email address.", {
      phone: ["Enter a phone number or an email address."],
    });
  }
}

export const createLeadSchema = z.object({
  /** Use an existing customer… */
  customerId: recordIdSchema.optional(),
  /** …or create one from these details. Exactly one of the two. */
  customer: newCustomerSchema.optional(),
  vehicleId: recordIdSchema.optional(),
  source: z.enum(LEAD_SOURCES).default("WEBSITE_INQUIRY"),
  assignedToId: recordIdSchema.optional(),
  summary: z.string().trim().max(2_000).optional(),
  nextFollowUpAt: z.coerce.date().optional(),
});

export type CreateLeadInput = z.input<typeof createLeadSchema>;

export interface LeadWithCustomer extends Lead {
  customer: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    preferredContact: ContactMethod;
  };
}

const LEAD_INCLUDE = {
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      preferredContact: true,
    },
  },
} satisfies Prisma.LeadInclude;

/**
 * Capability: `crm:write` (OWNER, MANAGER, SALES).
 *
 * Customer and lead are created in one transaction: a lead without its customer
 * is not a record, it is litter.
 */
export async function createLead(
  ctx: OperationContext,
  rawInput: CreateLeadInput,
): Promise<LeadWithCustomer> {
  assertCapability(ctx, "crm:write");

  const input = createLeadSchema.parse(rawInput);
  if (input.customerId && input.customer) {
    throw new ActionError("Provide either an existing customer or new customer details, not both.");
  }
  if (!input.customerId && !input.customer) {
    throw new ActionError("Provide an existing customer or the new customer's details.");
  }
  if (input.customer) assertContactable(input.customer);

  return ctx.db.$transaction(async (tx) => {
    let customerId = input.customerId;

    if (customerId) {
      const existing = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!existing) throw new NotFoundError("That customer no longer exists.");
    } else if (input.customer) {
      const created = await tx.customer.create({
        data: {
          firstName: input.customer.firstName,
          lastName: input.customer.lastName ?? null,
          email: input.customer.email ?? null,
          phone: input.customer.phone ?? null,
          preferredContact: input.customer.preferredContact ?? "ANY",
          addressLine1: input.customer.addressLine1 ?? null,
          city: input.customer.city ?? null,
          state: input.customer.state ?? null,
          postalCode: input.customer.postalCode ?? null,
          notes: input.customer.notes ?? null,
        },
        select: { id: true },
      });
      customerId = created.id;
    }
    if (!customerId) {
      // Unreachable: the validation above guarantees one of the two branches.
      throw new ActionError("Provide an existing customer or the new customer's details.");
    }

    if (input.vehicleId) {
      const vehicle = await tx.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true } });
      if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");
    }
    if (input.assignedToId) {
      const assignee = await tx.user.findUnique({ where: { id: input.assignedToId }, select: { id: true } });
      if (!assignee) throw new NotFoundError("That staff member no longer exists.");
    }

    return tx.lead.create({
      data: {
        customerId,
        vehicleId: input.vehicleId ?? null,
        source: input.source,
        assignedToId: input.assignedToId ?? null,
        summary: input.summary ?? null,
        nextFollowUpAt: input.nextFollowUpAt ?? null,
      },
      include: LEAD_INCLUDE,
    });
  });
}

export const leadListFilterSchema = z.object({
  status: z.enum(ALL_LEAD_STATUSES).optional(),
  /** Only leads that still need attention. */
  openOnly: z.boolean().default(false),
  assignedToId: recordIdSchema.optional(),
  vehicleId: recordIdSchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type LeadListFilter = z.input<typeof leadListFilterSchema>;

export interface LeadListResult {
  items: LeadWithCustomer[];
  total: number;
}

/** Capability: `crm:read`. */
export async function listLeads(
  ctx: OperationContext,
  rawFilter: LeadListFilter = {},
): Promise<LeadListResult> {
  assertCapability(ctx, "crm:read");

  const filter = leadListFilterSchema.parse(rawFilter);
  const search = filter.search;
  const statusWhere: Prisma.LeadWhereInput = filter.status
    ? { status: filter.status }
    : filter.openOnly
      ? { status: { notIn: ["WON", "LOST"] satisfies LeadStatus[] } }
      : {};

  const where: Prisma.LeadWhereInput = {
    ...statusWhere,
    ...(filter.assignedToId ? { assignedToId: filter.assignedToId } : {}),
    ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
    ...(search
      ? {
          customer: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" as const } },
              { lastName: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    ctx.db.lead.findMany({
      where,
      include: LEAD_INCLUDE,
      orderBy: [{ createdAt: "desc" }],
      take: filter.limit,
      skip: filter.offset,
    }),
    ctx.db.lead.count({ where }),
  ]);

  return { items, total };
}

export interface LeadDetail {
  lead: LeadWithCustomer;
  activities: LeadActivity[];
}

/** Capability: `crm:read`. */
export async function getLead(ctx: OperationContext, leadId: string): Promise<LeadDetail> {
  assertCapability(ctx, "crm:read");

  const id = recordIdSchema.parse(leadId);
  const lead = await ctx.db.lead.findUnique({ where: { id }, include: LEAD_INCLUDE });
  if (!lead) throw new NotFoundError("That lead no longer exists.");

  const activities = await ctx.db.leadActivity.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return { lead, activities };
}

/**
 * Updates the customer's contact details for a lead.
 *
 * The merged result must still satisfy `customers_has_contact`: removing the
 * last phone number from a customer with no email is refused rather than left
 * to the database.
 *
 * Capability: `crm:write`.
 */
export async function updateLeadContact(
  ctx: OperationContext,
  leadId: string,
  patch: CustomerPatch,
): Promise<LeadWithCustomer> {
  assertCapability(ctx, "crm:write");

  const id = recordIdSchema.parse(leadId);
  const parsed = customerPatchSchema.parse(patch);
  if (Object.keys(parsed).length === 0) throw new ActionError("Nothing to update.");

  const lead = await ctx.db.lead.findUnique({ where: { id }, select: { id: true, customerId: true } });
  if (!lead) throw new NotFoundError("That lead no longer exists.");

  const customer = await ctx.db.customer.findUnique({ where: { id: lead.customerId } });
  if (!customer) throw new NotFoundError("That customer no longer exists.");

  assertContactable({
    phone: parsed.phone === undefined ? customer.phone : parsed.phone,
    email: parsed.email === undefined ? customer.email : parsed.email,
  });

  await ctx.db.customer.update({ where: { id: customer.id }, data: parsed });

  const updated = await ctx.db.lead.findUnique({ where: { id }, include: LEAD_INCLUDE });
  if (!updated) throw new NotFoundError("That lead no longer exists.");
  return updated;
}

export const updateLeadStatusSchema = z.object({
  leadId: recordIdSchema,
  status: z.enum(ALL_LEAD_STATUSES),
  /** Required by `leads_lost_has_reason` when moving to LOST. */
  lostReason: z.string().trim().max(1_000).optional(),
  note: z.string().trim().max(2_000).optional(),
});

export type UpdateLeadStatusInput = z.input<typeof updateLeadStatusSchema>;

/**
 * Moves a lead along the lifecycle and records the change.
 *
 * Capability: `crm:write`.
 */
export async function updateLeadStatus(
  ctx: OperationContext,
  rawInput: UpdateLeadStatusInput,
): Promise<LeadWithCustomer> {
  assertCapability(ctx, "crm:write");

  const input = updateLeadStatusSchema.parse(rawInput);
  const lead = await ctx.db.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) throw new NotFoundError("That lead no longer exists.");
  if (lead.status === input.status) {
    throw new ConflictError(`That lead is already ${leadStatusLabel(input.status)}.`);
  }

  // Legality comes from the lead state machine; an illegal move throws
  // InvalidLeadTransitionError, which the error translator renders verbatim.
  assertLeadTransition(lead.status, input.status);

  if (input.status === "LOST") {
    if (!input.lostReason || input.lostReason.trim() === "") {
      throw new ActionError("A lost lead needs a reason.", {
        lostReason: ["Explain why the lead was lost."],
      });
    }
  }

  return ctx.db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: input.status,
        // A reopened lead must not keep a stale loss reason.
        lostReason: input.status === "LOST" ? (input.lostReason ?? null) : null,
        ...(touchesCustomerOnTransition(input.status) ? { lastContactedAt: new Date() } : {}),
      },
    });

    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "STATUS_CHANGE",
        body: input.note ?? `Status changed from ${leadStatusLabel(lead.status)} to ${leadStatusLabel(input.status)}.`,
        fromStatus: lead.status,
        toStatus: input.status,
        createdById: ctx.actor.id,
      },
    });

    const updated = await tx.lead.findUnique({ where: { id: lead.id }, include: LEAD_INCLUDE });
    if (!updated) throw new NotFoundError("That lead no longer exists.");
    return updated;
  });
}

export const leadDetailsSchema = z
  .object({
    summary: z.string().trim().max(2_000).nullable().optional(),
    /** Attach (or detach) the vehicle this lead is about. */
    vehicleId: recordIdSchema.nullable().optional(),
    assignedToId: recordIdSchema.nullable().optional(),
    nextFollowUpAt: z.coerce.date().nullable().optional(),
    source: z.enum(LEAD_SOURCES).optional(),
  })
  .strict();

export type LeadDetailsPatch = z.input<typeof leadDetailsSchema>;

/** Capability: `crm:write`. */
export async function updateLeadDetails(
  ctx: OperationContext,
  leadId: string,
  patch: LeadDetailsPatch,
): Promise<LeadWithCustomer> {
  assertCapability(ctx, "crm:write");

  const id = recordIdSchema.parse(leadId);
  const parsed = leadDetailsSchema.parse(patch);
  if (Object.keys(parsed).length === 0) throw new ActionError("Nothing to update.");

  const lead = await ctx.db.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) throw new NotFoundError("That lead no longer exists.");

  if (parsed.vehicleId) {
    const vehicle = await ctx.db.vehicle.findUnique({ where: { id: parsed.vehicleId }, select: { id: true } });
    if (!vehicle) throw new NotFoundError("That vehicle no longer exists.");
  }
  if (parsed.assignedToId) {
    const assignee = await ctx.db.user.findUnique({ where: { id: parsed.assignedToId }, select: { id: true } });
    if (!assignee) throw new NotFoundError("That staff member no longer exists.");
  }

  return ctx.db.lead.update({ where: { id }, data: parsed, include: LEAD_INCLUDE });
}

export const leadNoteSchema = z.object({
  leadId: recordIdSchema,
  body: requiredText(2_000),
});

export type AddLeadNoteInput = z.input<typeof leadNoteSchema>;

/**
 * Capability: `crm:write`.
 *
 * A note is a `LeadActivity` of type NOTE — the same table the status history
 * uses, so there is exactly one timeline.
 */
export async function addLeadNote(
  ctx: OperationContext,
  rawInput: AddLeadNoteInput,
): Promise<LeadActivity> {
  assertCapability(ctx, "crm:write");

  const input = leadNoteSchema.parse(rawInput);
  const lead = await ctx.db.lead.findUnique({ where: { id: input.leadId }, select: { id: true } });
  if (!lead) throw new NotFoundError("That lead no longer exists.");

  return ctx.db.leadActivity.create({
    data: {
      leadId: input.leadId,
      type: "NOTE",
      body: input.body,
      createdById: ctx.actor.id,
    },
  });
}

export type { Lead, LeadActivity };
