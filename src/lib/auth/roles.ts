import type { UserRole } from "@/generated/prisma";

/**
 * Role capability matrix.
 *
 * Two rules drive the design:
 *   1. Least privilege. A salesperson does not need the dealership's cost
 *      basis, and a recon tech does not need deal paperwork.
 *   2. Financial data is a capability, not a column. `finance:read` gates
 *      acquisition cost, landed cost, gross profit and ROI everywhere —
 *      including the JSON a server component hands to a client component.
 *
 * (Concept adapted from the RBAC + field-masking approach studied in the
 * car-dealer-crm donor. Reimplemented here; see docs/DONOR_AUDIT.md.)
 */

export const CAPABILITIES = [
  "inventory:read",
  "inventory:write",
  "pricing:read",
  "pricing:write",
  "finance:read",
  "acquisition:read",
  "recon:write",
  "expenses:read",
  "expenses:write",
  "crm:read",
  "crm:write",
  "deals:read",
  "deals:write",
  "reservations:read",
  "reservations:write",
  "documents:read",
  "documents:write",
  "sourcing:read",
  "sourcing:write",
  "reports:read",
  "settings:read",
  "settings:write",
  "users:manage",
  "audit:read",
  "tracker:read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const SALES: Capability[] = [
  "inventory:read",
  "pricing:read",
  "crm:read",
  "crm:write",
  "deals:read",
  "deals:write",
  "reservations:read",
  "reservations:write",
  "documents:read",
  "documents:write",
  "sourcing:read",
  "reports:read",
  "settings:read",
];

const RECON: Capability[] = [
  "inventory:read",
  "inventory:write",
  "pricing:read",
  "recon:write",
  "expenses:read",
  "expenses:write",
  "reports:read",
  "settings:read",
];

const VIEWER: Capability[] = [
  "inventory:read",
  "pricing:read",
  "crm:read",
  "deals:read",
  "reservations:read",
  "documents:read",
  "reports:read",
  "settings:read",
];

/** OWNER and MANAGER differ only in user management and settings writes. */
const MANAGER: Capability[] = [
  "inventory:read",
  "inventory:write",
  "pricing:read",
  "pricing:write",
  "finance:read",
  "acquisition:read",
  "recon:write",
  "expenses:read",
  "expenses:write",
  "crm:read",
  "crm:write",
  "deals:read",
  "deals:write",
  "reservations:read",
  "reservations:write",
  "documents:read",
  "documents:write",
  "sourcing:read",
  "sourcing:write",
  "reports:read",
  "settings:read",
  "audit:read",
  "tracker:read",
];

const OWNER: Capability[] = [...CAPABILITIES];

const MATRIX: Record<UserRole, readonly Capability[]> = {
  OWNER,
  MANAGER,
  SALES,
  RECON,
  VIEWER,
};

export function capabilitiesFor(role: UserRole): readonly Capability[] {
  return MATRIX[role] ?? VIEWER;
}

export function hasCapability(role: UserRole, capability: Capability): boolean {
  return capabilitiesFor(role).includes(capability);
}

export function hasAnyCapability(role: UserRole, capabilities: readonly Capability[]): boolean {
  return capabilities.some((capability) => hasCapability(role, capability));
}

/** Gate for every money, cost and margin figure in the product. */
export function canViewFinancials(role: UserRole): boolean {
  return hasCapability(role, "finance:read");
}

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  SALES: "Sales",
  RECON: "Recon",
  VIEWER: "Viewer",
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role] ?? role;
}
