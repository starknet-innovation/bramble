/**
 * Opt-in mainnet Playwright configuration for the multisig privacy round. It
 * shares the wallet suite's gates: CI, a missing acknowledgement, a shared RPC
 * and an account this wallet cannot import all stop it before a browser
 * starts. Recording is off so nothing typed into a wallet reaches a trace.
 * Retries stay at 0 so a submitted transaction is never sent again.
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
  testDir: "./tests/mainnet/multisig",
  testMatch: "**/*.mainnet.ts",
  // Two proofs per relayed action, four Nostr round trips per signature set,
  // and an indexer that can take minutes to show each new balance.
  timeout: 75 * 60_000,
  use: {
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  workers: 1,
});
