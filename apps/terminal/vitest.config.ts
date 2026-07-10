/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Test config kept separate from vite.config.ts so the app build config stays
// untouched. Tests mock `fetch` and the Starknet RPC provider with realistic
// sample payloads — the live API hosts (Avnu / CoinGecko / RPC) are 403-blocked
// in the sandbox, so mocked-response tests are how the parsing + wiring is
// verified here.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
