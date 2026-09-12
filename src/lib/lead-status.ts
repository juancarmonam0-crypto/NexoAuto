import type { LeadStatus } from "@/generated/prisma";

/**
 * Lead lifecycle state machine.
 *
 * Deliberately mirrors `vehicle-status.ts`: one module decides which status
 * changes are legal, so no route handler, server action or future screen can
 * invent its own rules.
 *
 * The MVP operator path is the spine:
 *
 *   NEW -> CONTACTED -> APPOINTMENT -> WON / LOST
 *
 * `QUALIFYING`, `NEGOTIATING`, `FINANCING` and `DOCUMENTS` already exist in the
 * database enum and are kept reachable, because a real deal does pass through
 * them. They are refinements of the spine, never a shortcut around it.
 */

export const ALL_LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFYING",
  "APPOINTMENT",
  "NEGOTIATING",
  "FINANCING",
  "DOCUMENTS",
  "WON",
  "LOST",
] as const satisfies readonly LeadStatus[];

const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ["CONTACTED", "LOST"],
  CONTACTED: ["QUALIFYING", "APPOINTMENT", "NEGOTIATING", "WON", "LOST"],
  QUALIFYING: ["APPOINTMENT", "NEGOTIATING", "WON", "LOST"],
  APPOINTMENT: ["NEGOTIATING", "FINANCING", "DOCUMENTS", "WON", "LOST"],
  NEGOTIATING: ["FINANCING", "DOCUMENTS", "WON", "LOST"],
  FINANCING: ["DOCUMENTS", "WON", "LOST"],
  DOCUMENTS: ["WON", "LOST"],
  // Terminal: a won lead has become a deal. Corrections happen on the deal.
  WON: [],
  // A lost lead can be reopened when a customer comes back.
  LOST: ["CONTACTED"],
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFYING: "Qualifying",
  APPOINTMENT: "Appointment",
  NEGOTIATING: "Negotiating",
  FINANCING: "Financing",
  DOCUMENTS: "Documents",
  WON: "Won",
  LOST: "Lost",
};

/** Statuses that still need operator attention. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "QUALIFYING",
  "APPOINTMENT",
  "NEGOTIATING",
  "FINANCING",
  "DOCUMENTS",
];

/** Statuses that close a lead. */
export const CLOSED_LEAD_STATUSES: readonly LeadStatus[] = ["WON", "LOST"];

export function leadStatusLabel(status: LeadStatus): string {
  return LEAD_STATUS_LABELS[status] ?? status;
}

export function allowedLeadTransitions(from: LeadStatus): readonly LeadStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return false;
  return allowedLeadTransitions(from).includes(to);
}

export class InvalidLeadTransitionError extends Error {
  readonly code = "INVALID_LEAD_TRANSITION";
  constructor(
    readonly from: LeadStatus,
    readonly to: LeadStatus,
    message?: string,
  ) {
    super(message ?? `A lead cannot move from ${leadStatusLabel(from)} to ${leadStatusLabel(to)}.`);
    this.name = "InvalidLeadTransitionError";
  }
}

export function assertLeadTransition(from: LeadStatus, to: LeadStatus): void {
  if (!canTransitionLead(from, to)) throw new InvalidLeadTransitionError(from, to);
}

export function isLeadOpen(status: LeadStatus): boolean {
  return OPEN_LEAD_STATUSES.includes(status);
}

export function isLeadClosed(status: LeadStatus): boolean {
  return CLOSED_LEAD_STATUSES.includes(status);
}

/**
 * Moving a lead forward is a contact event; recording it keeps
 * `lastContactedAt` honest without asking the operator twice.
 */
export function touchesCustomerOnTransition(to: LeadStatus): boolean {
  return to !== "LOST";
}
