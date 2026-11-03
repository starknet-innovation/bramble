/**
 * Global setup for the explicit live-mainnet suite: require a current extension
 * build and validate every write gate before Chromium starts.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLiveMainnetAllowed, strk20LifecycleExcluded } from "../../scripts/mainnet-e2e-guard";
import { readStrk20MainnetEnvironment } from "./strk20-mainnet-env";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const globalSetup = (): void => {
  if (!existsSync(resolve(repoRoot, "dist/manifest.json"))) {
    throw new Error("dist/manifest.json is missing; run bun run build first");
  }
  assertLiveMainnetAllowed(process.env);
  // The STRK20 lifecycle's pool fee sits above the standard hot-wallet cap.
  // CI runs that file only with BRAMBLE_STRK20_E2E_CI=1. Local runs still
  // validate the STRK20 environment before Chromium starts.
  if (strk20LifecycleExcluded(process.env)) return;
  readStrk20MainnetEnvironment(process.env);
};

export default globalSetup;
