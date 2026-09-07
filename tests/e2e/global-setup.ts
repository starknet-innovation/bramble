/**
 * Playwright global setup: E2E tests load the built extension from dist/.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = resolve(repoRoot, "dist/manifest.json");

const globalSetup = (): void => {
  if (!existsSync(manifestPath)) {
    throw new Error(
      "dist/manifest.json is missing; run bun run build or bun run test:e2e:build before E2E tests",
    );
  }
  // Fail closed: a stray flag would silently put this offline suite on production.
  if (process.env["BRAMBLE_E2E_LIVE_NETWORK"] !== undefined) {
    throw new Error(
      "BRAMBLE_E2E_LIVE_NETWORK is set; this suite is offline-only. Unset it, or use test:e2e:mainnet",
    );
  }
};

export default globalSetup;
