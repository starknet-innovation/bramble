/**
 * Verifies the QSB runtime the background ships before it enters the wallet:
 * the exact published Pyodide package and the commit-pinned qsb-app pipeline
 * sources, then runs the public-only known-answer probe through the real
 * adapter on those same bytes.
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
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createQsbRuntime,
  QSB_MANIFEST,
  QSB_SOURCES,
  type QsbInterpreter,
  refuseRipemd160,
} from "../apps/extension/src/background/qsb/qsb-runtime";
import { QSB_PUBLIC_PROBE_ANSWERS } from "./qsb-known-answers";
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
  "bridge.py": "21f073bf940e8fc8ab3d19e8ff92a4e3f61b525fdac1514e5249e351f0e0dcfd",
  [QSB_MANIFEST]: "f1cab3a8871f9918dda011c0723eb0d2993d255ab722c3e78439f183110f1d65",
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

if (failures.length > 0) {
  throw new Error(failures.join("; "));
}

// The bytes above establish what ships; this establishes that they run. Same
// adapter, same files, same refusing RIPEMD-160 provider as the worker. The
// loader is imported by path — the very `pyodide.mjs` digest-checked above, not
// whatever the package's export map resolves — and narrowed like the worker's
// own type shim, since the package's declarations need Emscripten's globals.
const pyodideLoader = (await import(pathToFileURL(resolve(pyodideRoot, "pyodide.mjs")).href)) as {
  readonly loadPyodide?: unknown;
};
if (typeof pyodideLoader.loadPyodide !== "function") {
  throw new Error("Pyodide runtime no longer exports loadPyodide");
}
const loadPyodide = pyodideLoader.loadPyodide as (options: {
  readonly indexURL: string;
  readonly jsglobals: object;
  readonly stderr: (line: string) => void;
  readonly stdout: (line: string) => void;
}) => Promise<QsbInterpreter>;
const runtime = createQsbRuntime({
  loadInterpreter: () =>
    loadPyodide({
      indexURL: `${resolve(pyodideRoot)}/`,
      jsglobals: Object.create(null),
      stderr: () => undefined,
      stdout: () => undefined,
    }),
  readFile: async (file) => new Uint8Array(await readFile(`${shippedDirectory}/${file}`)),
  ripemd160: refuseRipemd160,
});
const probe = await runtime.publicProbe();
if (
  probe.push20 !== QSB_PUBLIC_PROBE_ANSWERS.push20 ||
  probe.sha256dEmpty !== QSB_PUBLIC_PROBE_ANSWERS.sha256dEmpty ||
  probe.validSmallR.join(",") !== QSB_PUBLIC_PROBE_ANSWERS.validSmallR.join(",")
) {
  throw new Error("QSB public probe does not match its known answers");
}
