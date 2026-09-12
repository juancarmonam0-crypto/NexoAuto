import { PrismaClient } from "@/generated/prisma";

/**
 * Single Prisma client for the process.
 *
 * Next.js hot-reloads server modules in development, which would otherwise open
 * a new connection pool on every edit and exhaust Postgres connections.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** True when a database is configured and reachable enough to attempt a query. */
export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return typeof url === "string" && url.length > 0;
}
