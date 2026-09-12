import type { DealerSettings, PrismaClient } from "@/generated/prisma";
import { isPrismaUniqueViolation } from "@/lib/action-result";

/**
 * Dealer settings singleton.
 *
 * `dealer_settings` is a single-row table holding the configuration every
 * pricing and sourcing decision leans on: minimum gross-profit floor, minimum
 * ROI, financing defaults, reservation policy and the demo-data honesty switch.
 *
 * The schema carries `@default(...)` for every column, so the row is created
 * lazily the first time it is read. That keeps a fresh database usable without
 * requiring a seed run, while still giving one authoritative source for the
 * numbers — no configuration is duplicated in application code.
 *
 * The client is a required parameter on purpose: this module stays free of
 * `@/lib/db`, so it can be unit-tested and called from inside a transaction.
 */

export const DEALER_SETTINGS_ID = "singleton";

/** The slice of Prisma this module needs, so a transaction client fits too. */
export type SettingsClient = Pick<PrismaClient, "dealerSettings">;

export async function getDealerSettings(client: SettingsClient): Promise<DealerSettings> {
  const existing = await client.dealerSettings.findUnique({ where: { id: DEALER_SETTINGS_ID } });
  if (existing) return existing;

  try {
    return await client.dealerSettings.create({ data: { id: DEALER_SETTINGS_ID } });
  } catch (error) {
    // Two concurrent first reads can both miss and both insert; the loser
    // re-reads rather than failing the request.
    if (isPrismaUniqueViolation(error)) {
      const raced = await client.dealerSettings.findUnique({ where: { id: DEALER_SETTINGS_ID } });
      if (raced) return raced;
    }
    throw error;
  }
}
