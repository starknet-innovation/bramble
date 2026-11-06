/**
 * `bun run test:e2e:ledger [nanosp|flex|stax ...]` (default: nanosp flex).
 *
 * For each model: checks the vendored app binary against its RECORDED hash
 * (`scripts/ledger-app-pins.ts`), starts the digest-pinned Speculos image on
 * loopback ports seeded with the repository's PUBLIC test phrase, runs
 * `playwright.ledger.config.ts`, and stops the container.
 *
 * Without Docker or a vendored binary it SKIPS: it prints "NOT RUN" with the
 * reason and runs no test, so nothing is reported as passed. Set
 * BRAMBLE_SPECULOS_REQUIRED=1 (a future CI job) to make that a failure. A
 * binary that is present but unrecorded or mismatched always fails.
 *
 * Needs `bun run build` and `bun run vendor:ledger-app`. Never takes a seed
 * from the environment: S-LDG belongs to the nightly Sepolia run only.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  APP_STARKNET_VERSION,
  LEDGER_APP_BINARIES,
  ledgerAppBinaryPath,
  SPECULOS_IMAGE,
} from "../../../scripts/ledger-app-pins";
import { IMPORT_MNEMONIC } from "../wallet-helpers";
import type { LedgerModel } from "./dashboard";
import { probeSpeculos, type SpeculosEndpoints } from "./speculos";

const API_PORT = 5000;
const APDU_PORT = 9999;
const STARTUP_MS = 90_000;

const fail = (message: string): never => {
  console.error(`test:e2e:ledger: ${message}`);
  process.exit(1);
};

const notRun = (reason: string): never => {
  if (process.env["BRAMBLE_SPECULOS_REQUIRED"] === "1") {
    return fail(reason);
  }
  console.warn(`test:e2e:ledger: NOT RUN (skipped, no test passed): ${reason}`);
  process.exit(0);
};

const requested = process.argv.slice(2);
const models = (requested.length > 0 ? requested : ["nanosp", "flex"]) as LedgerModel[];
for (const model of models) {
  if (!(model in LEDGER_APP_BINARIES)) {
    fail(`unknown model ${model}; expected one of ${Object.keys(LEDGER_APP_BINARIES).join(", ")}`);
  }
}
if (
  Bun.which("docker") === null ||
  Bun.spawnSync(["docker", "version"], { stderr: "ignore", stdout: "ignore" }).exitCode !== 0
) {
  notRun("Docker is required to run Speculos");
}

const verifiedBinary = async (model: LedgerModel): Promise<string> => {
  const path = ledgerAppBinaryPath(model);
  if (!(await Bun.file(path).exists())) {
    return notRun(`${path} is missing; run bun run vendor:ledger-app ${model}`);
  }
  const pinned = LEDGER_APP_BINARIES[model].sha256;
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (pinned === null) {
    return fail(`${model} binary hash ${digest} is not recorded in scripts/ledger-app-pins.ts`);
  }
  if (digest !== pinned) {
    return fail(`${model} binary does not match its recorded hash`);
  }
  return resolve(path);
};

const run = (command: string[], env: Record<string, string> = {}): number =>
  Bun.spawnSync(command, {
    env: { ...process.env, ...env },
    stderr: "inherit",
    stdout: "inherit",
  }).exitCode;

// Every binary is checked before any container starts, so a skip never
// follows a partial run.
const binaries = new Map<LedgerModel, string>();
for (const model of models) {
  binaries.set(model, await verifiedBinary(model));
}

// Ctrl-C or a CI cancel must not leave a container holding the ports.
let runningContainer: string | null = null;
let runningSuite: ReturnType<typeof Bun.spawn> | null = null;
const stopAll = (): void => {
  runningSuite?.kill();
  if (runningContainer !== null) {
    Bun.spawnSync(["docker", "stop", runningContainer], { stderr: "ignore", stdout: "ignore" });
    runningContainer = null;
  }
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopAll();
    process.exit(130);
  });
}

let failed = false;
for (const model of models) {
  const binary = binaries.get(model) ?? fail(`no binary for ${model}`);
  const name = `bramble-speculos-${model}-${process.pid}`;
  const started = run([
    "docker",
    "run",
    "--detach",
    "--rm",
    // Named by digest, so a fetch can only ever return that exact image.
    "--pull=missing",
    "--name",
    name,
    "-p",
    `127.0.0.1:${API_PORT}:${API_PORT}`,
    "-p",
    `127.0.0.1:${APDU_PORT}:${APDU_PORT}`,
    "-v",
    `${dirname(binary)}:/apps:ro`,
    "-e",
    `SPECULOS_APPNAME=Starknet:${APP_STARKNET_VERSION}`,
    SPECULOS_IMAGE,
    "--model",
    model,
    "--display",
    "headless",
    "--seed",
    IMPORT_MNEMONIC,
    "--api-port",
    String(API_PORT),
    "--apdu-port",
    String(APDU_PORT),
    `/apps/${model}.elf`,
  ]);
  if (started !== 0) {
    fail(`could not start Speculos for ${model}`);
  }
  runningContainer = name;
  try {
    const endpoints: SpeculosEndpoints = {
      apduPort: APDU_PORT,
      apiUrl: `http://127.0.0.1:${API_PORT}`,
      host: "127.0.0.1",
      model,
    };
    const deadline = performance.now() + STARTUP_MS;
    let reason = await probeSpeculos(endpoints);
    while (reason !== null && performance.now() < deadline) {
      await new Promise((done) => setTimeout(done, 1_000));
      reason = await probeSpeculos(endpoints);
    }
    if (reason !== null) {
      throw new Error(`Speculos for ${model} did not come up: ${reason}`);
    }
    // Asynchronous, so the signal handlers above can run while it does.
    runningSuite = Bun.spawn(
      ["bun", "run", "test:e2e", "--config", "playwright.ledger.config.ts"],
      {
        env: {
          ...process.env,
          BRAMBLE_SPECULOS_APDU_PORT: String(APDU_PORT),
          BRAMBLE_SPECULOS_API_PORT: String(API_PORT),
          BRAMBLE_SPECULOS_MODEL: model,
        },
        stderr: "inherit",
        stdout: "inherit",
      },
    );
    const exitCode = await runningSuite.exited;
    runningSuite = null;
    failed ||= exitCode !== 0;
  } catch (error) {
    console.error(`test:e2e:ledger: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  } finally {
    stopAll();
  }
}
process.exit(failed ? 1 : 0);
