import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Real-PostgreSQL integration tests. Run with `npm run test:db`.
 *
 * These execute against a live database that already has the migration chain
 * applied, and they are deliberately excluded from the default `npm test` run
 * (see vitest.config.ts) so ordinary development never needs a database.
 *
 * Point them at a disposable database, for example:
 *   DATABASE_URL=postgresql://user:pass@127.0.0.1:55432/dealer_proof npm run test:db
 *
 * If DATABASE_URL is not set the suites skip themselves instead of failing.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The database is shared mutable state; never run these files in parallel.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
