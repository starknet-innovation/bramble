/**
 * Playwright configuration for MV3 extension end-to-end tests.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  retries: process.env.CI ? 2 : 0,
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 45_000,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  workers: 1,
});
