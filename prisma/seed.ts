/**
 * Local operator provisioning — `npm run db:seed`.
 *
 * WHY THIS EXISTS
 * A dealership cannot sign in until at least one operator row exists, and Phase 6
 * deliberately does not build a user-management UI. This script is tooling, not
 * a product feature: it creates ONE operator account and the settings singleton,
 * and nothing else. No vehicles, no customers, no demo inventory — seeding
 * inventory would be a product decision.
 *
 * SAFETY
 *   - refuses to run with NODE_ENV=production
 *   - requires an explicit password; there are no default credentials anywhere
 *     in this repository
 *   - re-running it RESETS that operator's password, which is the documented way
 *     to recover an account
 *
 * NOTE ON IMPORTS
 * This file runs under Node's native TypeScript stripping, which does not rewrite
 * import specifiers. Only real files and packages can be imported, and the app's
 * `@/...` alias does not exist outside the bundler — hence the relative path to
 * the generated client and a direct bcrypt call at the same cost as
 * `src/lib/auth/password.ts`.
 */

import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/index.js";

const BCRYPT_COST = 12;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production environment.");
  }

  const email = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_OWNER_PASSWORD;
  const name = process.env.SEED_OWNER_NAME?.trim() || "Dealer Owner";

  if (!email || !password) {
    throw new Error("Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD before running the seed.");
  }
  if (password.length < 10) {
    throw new Error("SEED_OWNER_PASSWORD must be at least 10 characters.");
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, name, role: "OWNER", isActive: true },
      create: { email, name, passwordHash, role: "OWNER" },
      select: { email: true, role: true },
    });

    // The settings singleton, so the app has dealership configuration to read.
    await prisma.dealerSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });

    console.log(`Seeded operator ${user.email} (${user.role}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
