/**
 * `check:ledger-app`: verifies the Ledger E2E pins (issue 861). Always checks
 * the pins' shape and that the vendoring script follows no branch. When the
 * app has been vendored (`bun run vendor:ledger-app`), it also checks that the
 * checkout sits on the pinned commit, unmodified, and that every built binary
 * matches its recorded SHA-256. Without a checkout (CI, most machines) only the
 * static half runs, and the Speculos runner refuses to start.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  APP_STARKNET_REVISION,
  LEDGER_APP_BINARIES,
  LEDGER_APP_BUILDER_IMAGE,
  LEDGER_APP_DIR,
  ledgerAppBinaryPath,
  SPECULOS_IMAGE,
} from "./ledger-app-pins";
import { ledgerAppBinaryFailure, ledgerAppPinFailures } from "./ledger-app-policy";
import {
  dynamicExecutionFailures,
  vendorPinFailures,
  vendorProvenanceFailures,
} from "./vendor-pin-policy";

const pinsFile = "scripts/ledger-app-pins.ts";
const vendorScript = "scripts/vendor-ledger-app.ts";
const vendorSource = await readFile(vendorScript, "utf8");

const failures: string[] = [
  ...ledgerAppPinFailures({
    binaries: LEDGER_APP_BINARIES,
    builderImage: LEDGER_APP_BUILDER_IMAGE,
    revision: APP_STARKNET_REVISION,
    speculosImage: SPECULOS_IMAGE,
  }),
  ...vendorPinFailures(await readFile(pinsFile, "utf8"), pinsFile, "APP_STARKNET_REVISION"),
  ...vendorPinFailures(vendorSource, vendorScript, "APP_STARKNET_REVISION").filter(
    // The revision lives in the pins module; only the moving-branch rule applies here.
    (failure) => !failure.includes("must pin a commit"),
  ),
  ...dynamicExecutionFailures(vendorSource, vendorScript),
];

if (await Bun.file(`${LEDGER_APP_DIR}/ledger_app.toml`).exists()) {
  const git = (args: string[]): string => {
    const result = Bun.spawnSync(["git", ...args], { cwd: LEDGER_APP_DIR });
    if (result.exitCode !== 0) {
      throw new Error(`Ledger app provenance unavailable: git ${args.join(" ")} failed`);
    }
    return result.stdout.toString().trim();
  };
  failures.push(
    ...vendorProvenanceFailures({
      artifacts: [],
      head: git(["rev-parse", "HEAD"]),
      name: "Ledger Starknet app",
      pinnedRevision: APP_STARKNET_REVISION,
      // Build output (target/, bin/) is not source.
      worktreeStatus: git(["status", "--porcelain", "--untracked-files=no"]),
    }),
  );
}

for (const [model, binary] of Object.entries(LEDGER_APP_BINARIES)) {
  const path = ledgerAppBinaryPath(model as keyof typeof LEDGER_APP_BINARIES);
  const digest = (await Bun.file(path).exists())
    ? createHash("sha256")
        .update(await readFile(path))
        .digest("hex")
    : null;
  const failure = ledgerAppBinaryFailure(model, binary.sha256, digest);
  if (failure !== null) {
    failures.push(failure);
  }
}

if (failures.length > 0) {
  throw new Error(failures.join("; "));
}
