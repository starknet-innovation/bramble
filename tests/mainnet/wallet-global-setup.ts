/**
 * Global setup for the opt-in mainnet wallet suite. CI and a missing build
 * fail closed. An unconfigured machine is rejected here too: the npm script
 * exits 0 before Playwright starts, so this path is only a direct invocation.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalMainnetFromProcess } from "./local-mainnet-account";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const globalSetup = async (): Promise<void> => {
  const loaded = await loadLocalMainnetFromProcess();
  if (loaded.kind === "skip") {
    throw new Error(
      `${loaded.message}\nThe Playwright config refuses to start until that configuration is present.`,
    );
  }
  if (loaded.kind === "error") {
    throw new Error(loaded.message);
  }
  if (!existsSync(resolve(repoRoot, "dist/manifest.json"))) {
    throw new Error("dist/manifest.json is missing; run bun run build first");
  }
};

export default globalSetup;
