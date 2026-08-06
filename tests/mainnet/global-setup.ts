/**
 * Global setup for the explicit live-mainnet suite: require a current extension
 * build and validate every write gate before Chromium starts.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStrk20MainnetEnvironment } from "./strk20-mainnet-env";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const globalSetup = (): void => {
  if (!existsSync(resolve(repoRoot, "dist/manifest.json"))) {
    throw new Error("dist/manifest.json is missing; run bun run build first");
  }
  readStrk20MainnetEnvironment(process.env);
};

export default globalSetup;
