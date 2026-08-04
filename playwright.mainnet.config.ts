/**
 * Explicit live-mainnet Playwright configuration. Recording is disabled so a
 * signing key entered into the extension cannot reach a trace, screenshot, or
 * video artifact. This suite is never matched by the default E2E config.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: true,
  fullyParallel: false,
  globalSetup: "./tests/mainnet/global-setup.ts",
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
