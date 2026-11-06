/**
 * Builds the Ledger Starknet app binaries the offline Ledger E2E suite runs in
 * Speculos (issue 861). Mirrors `vendor:argent`: fetch one pinned commit, never
 * a branch, then build it inside the digest-pinned `ledger-app-builder` image
 * with the app's own `Cargo.lock` (`--locked`). Nothing here ships.
 *
 * Needs Docker and network access. Prints each binary's SHA-256 and compares it
 * with `LEDGER_APP_BINARIES` in `scripts/ledger-app-pins.ts`; an unrecorded
 * hash is reported for a reviewed commit to record, and a mismatch fails.
 *
 * Usage: `bun run vendor:ledger-app [nanosp|flex|stax ...]` (default: all).
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  APP_STARKNET_REPOSITORY,
  APP_STARKNET_REVISION,
  LEDGER_APP_BIN_DIR,
  LEDGER_APP_BINARIES,
  LEDGER_APP_BUILDER_IMAGE,
  LEDGER_APP_DIR,
  ledgerAppBinaryPath,
} from "./ledger-app-pins";

type Model = keyof typeof LEDGER_APP_BINARIES;

const run = async (command: string[], cwd = "."): Promise<void> => {
  const child = Bun.spawn(command, { cwd, stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
  }
};

const requested = process.argv.slice(2);
const models = (requested.length > 0 ? requested : Object.keys(LEDGER_APP_BINARIES)) as Model[];
for (const model of models) {
  if (!(model in LEDGER_APP_BINARIES)) {
    throw new Error(`Unknown model ${model}; expected one of ${Object.keys(LEDGER_APP_BINARIES)}`);
  }
}

await mkdir("vendor", { recursive: true });
if (!(await Bun.file(`${LEDGER_APP_DIR}/ledger_app.toml`).exists())) {
  await run([
    "git",
    "clone",
    "--filter=blob:none",
    "--no-checkout",
    APP_STARKNET_REPOSITORY,
    LEDGER_APP_DIR,
  ]);
}
await run(["git", "fetch", "--depth=1", "origin", APP_STARKNET_REVISION], LEDGER_APP_DIR);
await run(["git", "checkout", "--force", "--detach", APP_STARKNET_REVISION], LEDGER_APP_DIR);
// Nothing but the pinned tree may reach the build: drop local edits and every
// untracked or ignored file (an old target/ included), then prove it.
await run(["git", "reset", "--hard", APP_STARKNET_REVISION], LEDGER_APP_DIR);
await run(["git", "clean", "-ffdx"], LEDGER_APP_DIR);
const git = (args: string[]): string =>
  Bun.spawnSync(["git", ...args], { cwd: LEDGER_APP_DIR })
    .stdout.toString()
    .trim();
if (
  git(["rev-parse", "HEAD"]) !== APP_STARKNET_REVISION ||
  git(["status", "--porcelain", "--ignored", "--untracked-files=all"]) !== ""
) {
  throw new Error("Ledger app checkout is not exactly the pinned commit; refusing to build");
}

const failures: string[] = [];
for (const model of models) {
  const { cargoDevice, sha256 } = LEDGER_APP_BINARIES[model];
  await run([
    "docker",
    "run",
    "--rm",
    // Named by digest, so a fetch can only ever return that exact image.
    "--pull=missing",
    "-v",
    `${resolve(LEDGER_APP_DIR)}:/app`,
    "-w",
    "/app/starknet",
    LEDGER_APP_BUILDER_IMAGE,
    "cargo",
    "ledger",
    "build",
    cargoDevice,
    "--",
    "--locked",
  ]);
  const output = ledgerAppBinaryPath(model);
  await mkdir(LEDGER_APP_BIN_DIR, { recursive: true });
  await copyFile(`${LEDGER_APP_DIR}/starknet/target/${cargoDevice}/release/starknet`, output);
  const digest = createHash("sha256")
    .update(await readFile(output))
    .digest("hex");
  if (sha256 === null) {
    console.log(
      `${model}: ${digest} (unrecorded: review, then record it in scripts/ledger-app-pins.ts)`,
    );
  } else if (sha256 !== digest) {
    failures.push(`${model}: built ${digest}, pinned ${sha256}`);
  } else {
    console.log(`${model}: ${digest} matches the pin`);
  }
}

if (failures.length > 0) {
  throw new Error(`Ledger app build does not match its pins: ${failures.join("; ")}`);
}
