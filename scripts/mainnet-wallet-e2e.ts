/**
 * Entry point for `bun run test:e2e:mainnet:wallet` and, with `multisig` as
 * its argument, `bun run test:e2e:mainnet:multisig`. With no account
 * configured it prints the skip and exits 0. A partial or unsafe
 * configuration exits 1 before Chromium starts. A ready account runs the
 * Playwright suite, which still re-checks the same gates.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadLocalMainnetFromProcess } from "../tests/mainnet/local-mainnet-account";

const playwrightBin = join(process.cwd(), "node_modules", ".bin", "playwright");

// The suites this entry point may start. Anything else is refused, so an
// argument can never point Playwright at an arbitrary config.
const SUITE_CONFIGS: Readonly<Record<string, string>> = {
  multisig: "playwright.mainnet-multisig.config.ts",
  wallet: "playwright.mainnet-wallet.config.ts",
};

const runPlaywright = (config: string): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(playwrightBin, ["test", "--config", config], {
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
  });

const main = async (): Promise<number> => {
  const suite = process.argv[2] ?? "wallet";
  const config = Object.hasOwn(SUITE_CONFIGS, suite) ? SUITE_CONFIGS[suite] : undefined;
  if (config === undefined) {
    console.error("Unknown suite. Use wallet or multisig.");
    return 1;
  }
  const loaded = await loadLocalMainnetFromProcess();
  if (loaded.kind === "skip") {
    console.log(loaded.message);
    return 0;
  }
  if (loaded.kind === "error") {
    console.error(loaded.message);
    return 1;
  }
  if (!existsSync(join(process.cwd(), "dist", "manifest.json"))) {
    console.error("dist/manifest.json is missing; run bun run build first");
    return 1;
  }
  console.log(`Using ${loaded.account.label}`);
  return runPlaywright(config);
};

if (import.meta.main) {
  process.exit(await main());
}
