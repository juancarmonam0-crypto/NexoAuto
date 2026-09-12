import type { VehicleStatus } from "@/generated/prisma";

/**
 * Vehicle lifecycle state machine.
 *
 * The database stores a status; this module decides which status changes are
 * legal. Enforcing transitions in one place is what keeps the inventory honest:
 * a car cannot be marked LISTED before it is READY, and a car cannot skip from
 * SOURCING straight to SOLD.
 *
 *   SOURCING -> PURCHASED -> IN_TRANSIT -> INSPECTION -> RECONDITIONING
 *            -> READY -> LISTED -> RESERVED -> SOLD -> DELIVERED
 *   side exits: REJECTED (never bought / failed inspection), WHOLESALE
 *   (disposed without retailing).
 */

export const ALL_VEHICLE_STATUSES = [
  "SOURCING",
  "PURCHASED",
  "IN_TRANSIT",
  "INSPECTION",
  "RECONDITIONING",
  "READY",
  "LISTED",
  "RESERVED",
  "SOLD",
  "DELIVERED",
  "WHOLESALE",
  "REJECTED",
] as const satisfies readonly VehicleStatus[];

const TRANSITIONS: Record<VehicleStatus, readonly VehicleStatus[]> = {
  SOURCING: ["PURCHASED", "REJECTED"],
  PURCHASED: ["IN_TRANSIT", "INSPECTION", "RECONDITIONING", "WHOLESALE", "REJECTED"],
  IN_TRANSIT: ["INSPECTION", "RECONDITIONING", "WHOLESALE", "REJECTED"],
  INSPECTION: ["RECONDITIONING", "READY", "WHOLESALE", "REJECTED"],
  RECONDITIONING: ["READY", "INSPECTION", "WHOLESALE", "REJECTED"],
  READY: ["LISTED", "RECONDITIONING", "WHOLESALE", "REJECTED"],
  LISTED: ["RESERVED", "SOLD", "READY", "WHOLESALE", "REJECTED"],
  // A reservation that falls through returns the car to the public catalog.
  RESERVED: ["LISTED", "SOLD", "WHOLESALE"],
  // A deal can be unwound after it is marked sold; the car goes back on sale.
  SOLD: ["DELIVERED", "LISTED", "WHOLESALE"],
  DELIVERED: [],
  WHOLESALE: [],
  // Reopening a rejected unit is an explicit correction path.
  REJECTED: ["SOURCING"],
};

export class InvalidVehicleTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";
  constructor(
    readonly from: VehicleStatus,
    readonly to: VehicleStatus,
    message?: string,
  ) {
    super(message ?? `A vehicle cannot move from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.`);
    this.name = "InvalidVehicleTransitionError";
  }
}

export function allowedTransitions(from: VehicleStatus): readonly VehicleStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: VehicleStatus, to: VehicleStatus): boolean {
  if (from === to) return false;
  return allowedTransitions(from).includes(to);
}

export function assertTransition(from: VehicleStatus, to: VehicleStatus): void {
  if (!canTransition(from, to)) throw new InvalidVehicleTransitionError(from, to);
}

export const STATUS_LABELS: Record<VehicleStatus, string> = {
  SOURCING: "Sourcing",
  PURCHASED: "Purchased",
  IN_TRANSIT: "In transit",
  INSPECTION: "Inspection",
  RECONDITIONING: "Reconditioning",
  READY: "Ready",
  LISTED: "Listed",
  RESERVED: "Reserved",
  SOLD: "Sold",
  DELIVERED: "Delivered",
  WHOLESALE: "Wholesale",
  REJECTED: "Rejected",
};

export const TERMINAL_STATUSES: readonly VehicleStatus[] = ["DELIVERED", "WHOLESALE"];

/** Statuses whose vehicles belong in the public catalog. */
export const PUBLICLY_VISIBLE_STATUSES: readonly VehicleStatus[] = ["LISTED", "RESERVED"];

/** Vehicles still costing money but not yet sellable. */
export const IN_PROGRESS_STATUSES: readonly VehicleStatus[] = [
  "SOURCING",
  "PURCHASED",
  "IN_TRANSIT",
  "INSPECTION",
  "RECONDITIONING",
];

export const IN_RECON_STATUSES: readonly VehicleStatus[] = ["INSPECTION", "RECONDITIONING"];

export function isPubliclyVisible(status: VehicleStatus): boolean {
  return PUBLICLY_VISIBLE_STATUSES.includes(status);
}

export function isSoldStatus(status: VehicleStatus): boolean {
  return status === "SOLD" || status === "DELIVERED";
}

export function isTerminal(status: VehicleStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * The listing status a vehicle should carry for a given lifecycle status.
 * Keeps listing_status from drifting out of sync with status.
 */
export function deriveListingStatus(status: VehicleStatus): "UNLISTED" | "ACTIVE" | "PAUSED" | "SOLD" | "ARCHIVED" {
  switch (status) {
    case "LISTED":
    case "RESERVED":
      return "ACTIVE";
    case "SOLD":
    case "DELIVERED":
      return "SOLD";
    case "WHOLESALE":
    case "REJECTED":
      return "ARCHIVED";
    case "READY":
      return "UNLISTED";
    default:
      return "PAUSED";
  }
}

export type StatusTone = "neutral" | "progress" | "ready" | "sold" | "danger";

export function statusTone(status: VehicleStatus): StatusTone {
  switch (status) {
    case "SOURCING":
    case "PURCHASED":
    case "IN_TRANSIT":
      return "progress";
    case "INSPECTION":
    case "RECONDITIONING":
      return "progress";
    case "READY":
    case "LISTED":
      return "ready";
    case "RESERVED":
      return "progress";
    case "SOLD":
    case "DELIVERED":
    case "WHOLESALE":
      return "sold";
    case "REJECTED":
      return "danger";
    default:
      return "neutral";
  }
}

export function statusLabel(status: VehicleStatus): string {
  return STATUS_LABELS[status] ?? status;
}
