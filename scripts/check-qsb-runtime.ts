/**
 * Verifies the QSB runtime the background ships before it enters the wallet:
 * the exact published Pyodide package and the commit-pinned qsb-app pipeline
 * sources, then runs the public-only known-answer probe and the commitments
 * setup of the QSB BIP test vault through the real adapter on those same bytes.
 *
 * Provenance runs through the shared `vendor-pin-policy` helpers, and the
 * pinned qsb-app commit is read back out of `scripts/vendor-qsb.ts` rather than
 * copied here. Bun's frozen lockfile pins the Pyodide tarball and its registry
 * integrity; this gate additionally pins every Pyodide file `build` copies into
 * the extension and rejects package metadata or install-hook drift. Every
 * shipped QSB file is digest-pinned, and the vendored `manifest.json` — the
 * list the runtime checks each source against — must describe exactly the
 * sources the adapter loads. Pyodide is imported only after its bytes verify.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { qsbVaultConfiguration } from "@bramble/qsb/configuration";
import { ripemd160 } from "@noble/hashes/legacy.js";
import {
  createQsbRuntime,
  QSB_MANIFEST,
  QSB_SOURCES,
} from "../apps/extension/src/background/qsb/qsb-runtime";
import { QSB_MAX_JSON_TEXT } from "../apps/extension/src/background/qsb/qsb-vault-setup";
import {
  QSB_PUBLIC_PROBE_ANSWERS,
  QSB_TEST_VAULT_COMMITMENTS,
  QSB_TEST_VAULT_SETUP,
} from "./qsb-known-answers";
import { loadPinnedPyodide } from "./qsb-pyodide";
import {
  dynamicExecutionFailures,
  npmRunTargets,
  vendorProvenanceFailures,
  vendorRevisionPin,
} from "./vendor-pin-policy";

const pyodideName = "pyodide";
const pyodideVersion = "0.29.3";
const pyodideRoot = `node_modules/${pyodideName}`;
// The Pyodide files `apps/extension/build.ts` copies into
// `dependencies/pyodide/`, as published in pyodide@0.29.3. The source maps,
// type declarations, CommonJS entry and REPL pages are never shipped.
const pyodideRuntimeDigests: Readonly<Record<string, string>> = {
  "pyodide-lock.json": "3256ffc76388de0e37f4b34d42ab484268d1afc675179ff97b2a5bb14f84ccac",
  "pyodide.asm.js": "1263f02b5b26099b96112378156f242dd98b39a8201ba7765e5fe3d455c5ce91",
  "pyodide.asm.wasm": "e2f4ee75b325e35eb31bfb8c613d4dd5098f5502c156a97847686875b5025480",
  "pyodide.mjs": "23213d27e9dacbda6f25f955fb38dabfc40ada082c04ee253047ea5dddcaa3b5",
  "python_stdlib.zip": "4298b6ee445cb724c3973437da47789752b9e6ff4e26619026b283ec801fc46b",
};
const INSTALL_HOOKS = ["install", "postinstall", "preinstall", "prepare"] as const;

const checkout = "vendor/qsb";
const shippedDirectory = `${checkout}/public/qsb`;
const vendorScript = "scripts/vendor-qsb.ts";
const sparsePattern = "/public/qsb/";
// SHA-256 of every QSB file `build` copies into `vendor/qsb/`, at the pinned
// qsb-app commit. Update only together with QSB_APP_REVISION.
const qsbDigests: Readonly<Record<string, string>> = {
  LICENSE: "8d2562b24636fb569997da918899eed12e95b573eef1207bf60be6bf7bd836ff",
  "bitcoin_tx.py": "c7e52af90bd0d9fce9834fce26dcd67aee0d7751ee228d9730873c4d12659a5c",
  "bridge.py": "2a786a36a988e298b4fbb6132f37a50d7610fb14fb382143518c7ad3ec6d6d96",
  [QSB_MANIFEST]: "e73a049b7c02350d03d3b5409036e9d9aaf384f09500446eb497c361e1f3c60f",
  "qsb_pipeline.py": "05334c08fa012a77ccba2887e05d78f90a8b81c0e34b786931b423f7f11255d8",
  "secp256k1.py": "d2cebd1410b75cad606806cf02d7bee3e24724d5fcb7a53a07f598fcbc8afece",
};

const digestOf = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const git = async (args: string[]): Promise<string> => {
  const child = Bun.spawn(["git", ...args], { cwd: checkout, stderr: "inherit", stdout: "pipe" });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) {
    throw new Error(`QSB provenance unavailable: git ${args.join(" ")} failed in ${checkout}`);
  }
  return output.trim();
};

if (!(await Bun.file(`${shippedDirectory}/${QSB_MANIFEST}`).exists())) {
  throw new Error(`QSB pipeline sources missing in ${shippedDirectory}; run bun run vendor:qsb`);
}

const failures: string[] = [];

const pyodideManifest = JSON.parse(await readFile(`${pyodideRoot}/package.json`, "utf8")) as Record<
  string,
  unknown
>;
const pyodideScripts = pyodideManifest["scripts"];
if (
  pyodideManifest["name"] !== pyodideName ||
  pyodideManifest["version"] !== pyodideVersion ||
  pyodideManifest["license"] !== "MPL-2.0" ||
  typeof pyodideScripts !== "object" ||
  pyodideScripts === null ||
  INSTALL_HOOKS.some((hook) => Object.hasOwn(pyodideScripts, hook))
) {
  failures.push(`Pyodide must be the hook-free published ${pyodideName}@${pyodideVersion}`);
}
for (const [file, expected] of Object.entries(pyodideRuntimeDigests)) {
  if ((await digestOf(`${pyodideRoot}/${file}`)) !== expected) {
    failures.push(`Pyodide runtime does not match ${pyodideName}@${pyodideVersion}: ${file}`);
  }
}

const vendorSource = await readFile(vendorScript, "utf8");
failures.push(
  ...vendorProvenanceFailures({
    artifacts: await Promise.all(
      Object.entries(qsbDigests).map(async ([file, expectedDigest]) => {
        const path = `${shippedDirectory}/${file}`;
        return { digest: await digestOf(path), expectedDigest, path };
      }),
    ),
    head: await git(["rev-parse", "HEAD"]),
    name: "QSB pipeline",
    pinnedRevision: vendorRevisionPin(vendorSource, vendorScript, "QSB_APP_REVISION"),
    worktreeStatus: await git(["status", "--porcelain"]),
  }),
  ...dynamicExecutionFailures(vendorSource, vendorScript),
  ...npmRunTargets(vendorSource).map(
    (target) => `${vendorScript} must not run the upstream \`${target}\` package script`,
  ),
);
if ((await git(["sparse-checkout", "list"])) !== sparsePattern) {
  failures.push(`${checkout} must check out only ${sparsePattern}`);
}

// The runtime refuses any source the manifest does not pin, so the manifest
// must name exactly the adapter's sources, each with that file's digest.
const manifest = JSON.parse(
  await readFile(`${shippedDirectory}/${QSB_MANIFEST}`, "utf8"),
) as Record<string, unknown>;
if (Object.keys(manifest).sort().join(",") !== [...QSB_SOURCES].sort().join(",")) {
  failures.push(`${QSB_MANIFEST} must list exactly the adapter's QSB_SOURCES`);
}
for (const source of QSB_SOURCES) {
  if (manifest[source] !== qsbDigests[source]) {
    failures.push(`${QSB_MANIFEST} does not pin the reviewed digest of ${source}`);
  }
}
// The adapter refuses a public state longer than the bridge itself would read
// back, so the two limits must be one number.
const bridgeSource = await readFile(`${shippedDirectory}/bridge.py`, "utf8");
if (!bridgeSource.includes(`\nMAX_JSON_TEXT = ${QSB_MAX_JSON_TEXT}\n`)) {
  failures.push(`bridge.py must keep MAX_JSON_TEXT at the adapter's ${QSB_MAX_JSON_TEXT}`);
}

if (failures.length > 0) {
  throw new Error(failures.join("; "));
}

// The bytes above establish what ships; this establishes that they run. Same
// adapter, same files, same RIPEMD-160 provider as the worker, and the very
// `pyodide.mjs` digest-checked above (./qsb-pyodide imports it by path).
const runtime = createQsbRuntime({
  loadInterpreter: () => loadPinnedPyodide(pyodideRoot),
  readFile: async (file) => new Uint8Array(await readFile(`${shippedDirectory}/${file}`)),
  ripemd160,
});
const probe = await runtime.publicProbe();
if (
  probe.hash160Empty !== QSB_PUBLIC_PROBE_ANSWERS.hash160Empty ||
  probe.push20 !== QSB_PUBLIC_PROBE_ANSWERS.push20 ||
  probe.sha256dEmpty !== QSB_PUBLIC_PROBE_ANSWERS.sha256dEmpty ||
  probe.validSmallR.join(",") !== QSB_PUBLIC_PROBE_ANSWERS.validSmallR.join(",")
) {
  throw new Error("QSB public probe does not match its known answers");
}
const vault = await runtime.setupFromCommitments(QSB_TEST_VAULT_COMMITMENTS);
if (
  vault.scriptHash !== QSB_TEST_VAULT_SETUP.scriptHash ||
  vault.scriptHex.length !== QSB_TEST_VAULT_SETUP.scriptBytes * 2 ||
  createHash("sha256").update(vault.publicStateJson).digest("hex") !==
    QSB_TEST_VAULT_SETUP.publicStateSha256 ||
  qsbVaultConfiguration({ ...vault, network: "mainnet" }).publicStateHash !==
    QSB_TEST_VAULT_SETUP.publicStateHash
) {
  throw new Error("QSB commitments setup does not match the test vault's known answers");
}
