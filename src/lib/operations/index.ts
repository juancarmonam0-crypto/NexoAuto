/**
 * Nexo Auto — Phase 4 operational backend.
 *
 * BUY -> CARS -> LEADS -> SALES, expressed as authorized, validated, atomic
 * operations over the canonical Prisma schema. The frontend calls these; it
 * must never re-implement the business rules they enforce.
 *
 * Import from here:
 *
 *   import { operationContext } from "@/lib/operations/runtime";
 *   import { completeVehicleSale } from "@/lib/operations";
 *
 * `runtime.ts` is deliberately NOT re-exported: it imports the Next.js request
 * runtime, and this barrel stays importable from a unit test.
 */

export * from "./context";
export * from "./schemas";
export * from "./db-errors";

// BUY
export * from "./sourcing";

// OPPORTUNITY -> INVENTORY
export * from "./acquisition";

// CARS
export * from "./inventory";

// LEADS
export * from "./leads";

// SALES
export * from "./sales";
