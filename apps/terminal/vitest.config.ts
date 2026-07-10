/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Test config kept separate from vite.config.ts so the app build config stays
// untouched. Tests mock `fetch` and the Starknet RPC provider with realistic
// sample payloads; the separate check:api command covers live upstream shape
// and availability without making the deterministic unit suite depend on them.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
