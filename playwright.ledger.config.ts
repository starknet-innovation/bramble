/**
 * Playwright configuration for the Speculos Ledger suite (issue 861). Run it
 * through `bun run test:e2e:ledger`, which starts a pinned Speculos per model
 * and sets the BRAMBLE_SPECULOS_* endpoints. The default E2E config never
 * matches these `*.speculos.ts` files, and here a missing emulator fails the
 * run: there is no skipped or vacuous pass.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  globalSetup: "./tests/e2e/global-setup.ts",
  reporter: "list",
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
