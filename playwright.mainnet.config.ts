/**
 * Explicit live-mainnet Playwright configuration. Recording is disabled so a
 * signing key entered into the extension cannot reach a trace, screenshot, or
 * video artifact. This suite is never matched by the default E2E config.
 *
 * The CI opt-in leaves the STRK20 lifecycle out unless that lifecycle is
 * opted in on its own: its pool fee does not fit the standard hot-wallet cap.
 * New `*.mainnet.ts` specs are still picked up. An empty CI match exits 0 so
 * the gasless script can run before those specs land.
 */
import { defineConfig } from "@playwright/test";
import { strk20LifecycleExcluded } from "./scripts/mainnet-e2e-guard";

// The shared fixture blocks egress; this suite must reach mainnet. Set here so
// every process loading this config sets it, not just the runner.
process.env["BRAMBLE_E2E_LIVE_NETWORK"] = "1";

const excludeStrk20 = strk20LifecycleExcluded(process.env);

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: true,
  fullyParallel: false,
  globalSetup: "./tests/mainnet/global-setup.ts",
  ...(excludeStrk20 ? { passWithNoTests: true, testIgnore: "**/strk20-lifecycle.mainnet.ts" } : {}),
  reporter: "list",
  retries: 0,
  testDir: "./tests/mainnet",
  testMatch: "**/*.mainnet.ts",
  timeout: 15 * 60_000,
  use: {
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  workers: 1,
});
