/**
 * Entry point for `bun run test:e2e:mainnet:wallet`. With no account
 * configured it prints the skip and exits 0. A partial or unsafe
 * configuration exits 1 before Chromium starts. A ready account runs the
 * Playwright suite, which still re-checks the same gates.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadLocalMainnetFromProcess } from "../tests/mainnet/local-mainnet-account";

const playwrightBin = join(process.cwd(), "node_modules", ".bin", "playwright");

const runPlaywright = (): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(
      playwrightBin,
      ["test", "--config", "playwright.mainnet-wallet.config.ts"],
      {
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
  });

const main = async (): Promise<number> => {
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
  return runPlaywright();
};

if (import.meta.main) {
  process.exit(await main());
}
