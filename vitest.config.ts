import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Minimal Vitest config for unit-testing pure server-side modules. Lives
// alongside vite.config.ts rather than merging into it because the React
// Router plugin is not test-friendly (it expects a server runtime). We
// only run pure-function tests today; if we ever need component tests
// we'll add a separate jsdom-environment config.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // PR-2.2-mech.3: scripts/ added to cover the report-backfill.ts
    // classifier helper. The reporter is a tsx-invoked script, but
    // its pure helpers are imported into vitest like any other
    // module — test-discovery just needs to look there.
    include: ["app/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
