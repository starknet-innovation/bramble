/**
 * Playwright configuration for the Speculos Ledger suite (issue 861). Run it
 * through `bun run test:e2e:ledger`, which starts a pinned Speculos per model
 * and sets the BRAMBLE_SPECULOS_* endpoints. The default E2E config never
 * matches these `*.speculos.ts` files, and here a missing emulator fails the
 * run: there is no skipped or vacuous pass.
 */
import { defineConfig } from "@playwright/test";

const MODEL = process.env["BRAMBLE_SPECULOS_MODEL"] ?? "unset";

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  globalSetup: "./tests/e2e/global-setup.ts",
  // One folder per model: the runner starts Playwright once per model, and
  // each start empties its output folder, so a shared one would lose the
  // first model's failure traces before CI uploads them.
  outputDir: `test-results/ledger-${MODEL}`,
  // The JSON report lets CI prove tests ran and passed, not just that the
  // process exited 0 (scripts/ledger-e2e-results.ts).
  reporter: [["list"], ["json", { outputFile: `test-results/ledger-${MODEL}.json` }]],
  retries: 0,
  testDir: "./tests/e2e/ledger",
  testMatch: "**/*.speculos.ts",
  timeout: 180_000,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  workers: 1,
});
