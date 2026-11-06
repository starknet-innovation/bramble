/**
 * Opt-in mainnet Playwright configuration for the wallet UI suite. Recording
 * is disabled so a signing key typed into the extension cannot reach a trace,
 * screenshot, or video. Retries stay at 0 so a submitted transaction is not
 * sent again. This file is not the mocked CI suite and not the STRK20 suite.
 */
import { defineConfig } from "@playwright/test";

// The shared fixture blocks egress unless this is set. The mocked suite's
// global setup rejects the variable, so it never leaks into `bun run test:e2e`.
process.env["BRAMBLE_E2E_LIVE_NETWORK"] = "1";

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: true,
  fullyParallel: false,
  globalSetup: "./tests/mainnet/wallet-global-setup.ts",
  reporter: "list",
  retries: 0,
  testDir: "./tests/mainnet/wallet",
  testMatch: "**/*.mainnet.ts",
  timeout: 12 * 60_000,
  use: {
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  workers: 1,
});
