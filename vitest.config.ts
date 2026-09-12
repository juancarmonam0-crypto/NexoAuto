import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // tests/db/** holds real-PostgreSQL integration tests. They need a live,
    // migrated database, so they run via `npm run test:db` and never as part of
    // the ordinary unit suite.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/db/**"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
