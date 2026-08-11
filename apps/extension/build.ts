/**
 * Builds the MV3 extension with Bun and copies static extension assets into dist.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../..");
process.chdir(repositoryRoot);
const extensionRoot = "apps/extension";
const publicRoot = join(extensionRoot, "public");
const outdir = "dist";
const krustyModule = "/vendor/krusty-kms/pkg/krusty_kms_wasm.js";
const privacySdkModule = "/vendor/starknet-privacy/sdk/starknet-sdk.min.js";
const vendorOutdir = join(outdir, "vendor/krusty-kms/pkg");
const LEDGER_BUFFER_MODULES =
  /[\\/]node_modules[\\/]@ledgerhq[\\/](?:hw-app-starknet|hw-transport|hw-transport-web-ble|hw-transport-webhid|hw-transport-webusb)[\\/].*\.js$/;
const LEDGER_BLE_RAW_DISCONNECT_LOG = 'console.log("onDisconnect!", e);';

// Ledger's browser packages still reference the Node `Buffer` identifier
// without importing it. Inject a MODULE-LOCAL import only into those pinned
// package files while building the side panel and grant tab; this avoids
// installing Buffer on `globalThis`, where unrelated UI code could observe or
// replace it.
const ledgerBufferBoundary: Bun.BunPlugin = {
  name: "ledger-buffer-boundary",
  setup(builder) {
    builder.onLoad({ filter: LEDGER_BUFFER_MODULES }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      // The pinned Web Bluetooth package logs its raw disconnect event. Device
      // objects must not cross the Ledger boundary through console output, so
      // remove that one upstream diagnostic while bundling.
      const boundarySource = source.replace(LEDGER_BLE_RAW_DISCONNECT_LOG, "");
      return {
        contents: boundarySource.includes("Buffer")
          ? `import { Buffer } from "buffer";\n${boundarySource}`
          : boundarySource,
        loader: "js",
      };
    });
  },
};

const requireBuild = (result: Bun.BuildOutput): void => {
  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error("extension build failed");
  }
};

const run = async (cmd: string[]): Promise<void> => {
  const child = Bun.spawn(cmd, { stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed with exit code ${exitCode}`);
  }
};

// Stamp the sidepanel bundle with the manifest version and source branch so
// the settings screen can show exactly what build is loaded. Released builds
// (main, or a detached tag checkout reporting HEAD) carry no branch.
const gitBranch = async (): Promise<string> => {
  try {
    const child = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      stderr: "ignore",
      stdout: "pipe",
    });
    const branch = (await new Response(child.stdout).text()).trim();
    return (await child.exited) === 0 ? branch : "";
  } catch {
    return "";
  }
};
const manifestVersion = (
  JSON.parse(await readFile(join(publicRoot, "manifest.json"), "utf8")) as { version?: string }
).version;
const branch = await gitBranch();
// One definition of "this is a dev build", used by both the settings stamp and
// the manifest below; two copies of the main/HEAD test would drift.
const devBranch = branch === "main" || branch === "HEAD" ? "" : branch;
const buildStamp = {
  __MC_BUILD_BRANCH__: JSON.stringify(devBranch),
  __MC_BUILD_VERSION__: JSON.stringify(manifestVersion ?? ""),
};

await run(["bun", "run", "check:extension"]);
await run(["bun", "run", "check:krusty"]);
await run(["bun", "run", "check:multisig"]);
await run(["bun", "run", "check:privacy"]);
await rm(outdir, { force: true, recursive: true });
await mkdir(outdir, { recursive: true });

requireBuild(
  await Bun.build({
    entrypoints: [join(extensionRoot, "src/background/index.ts")],
    external: [krustyModule, privacySdkModule],
    format: "esm",
    minify: true,
    outdir: join(outdir, "background"),
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    define: buildStamp,
    entrypoints: [join(extensionRoot, "src/sidepanel/index.ts")],
    format: "esm",
    minify: true,
    outdir: join(outdir, "sidepanel"),
    plugins: [ledgerBufferBoundary],
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    entrypoints: [join(extensionRoot, "src/ledger-grant/index.ts")],
    format: "esm",
    minify: true,
    outdir: join(outdir, "ledger-grant"),
    plugins: [ledgerBufferBoundary],
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    entrypoints: [join(extensionRoot, "src/content/index.ts")],
    format: "iife",
    minify: true,
    outdir: join(outdir, "content"),
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    entrypoints: [join(extensionRoot, "src/provider/inpage.ts")],
    format: "iife",
    minify: true,
    outdir: join(outdir, "provider"),
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    entrypoints: [join(extensionRoot, "src/sandbox/render.ts")],
    format: "esm",
    minify: true,
    outdir: join(outdir, "sandbox"),
    target: "browser",
  }),
);

// The browser's extension list is the only place a loaded build identifies
// itself, and every dev build otherwise looks identical to a release. Stamp the
// branch into `name` and `version_name` (Chrome shows `version_name` in place of
// `version` when present) so a side-by-side load is unambiguous. `version` stays
// the numeric manifest value Chrome requires, and released builds — main, or a
// detached tag checkout — are copied through untouched.
const manifestJson = JSON.parse(await readFile(join(publicRoot, "manifest.json"), "utf8")) as Record<
  string,
  unknown
>;
await writeFile(
  join(outdir, "manifest.json"),
  `${JSON.stringify(
    devBranch === ""
      ? manifestJson
      : {
          ...manifestJson,
          name: `${String(manifestJson["name"] ?? "MC Wallet")} · ${devBranch}`.slice(0, 75),
          version_name: `${manifestVersion ?? ""} · ${devBranch}`.slice(0, 75),
        },
    null,
    2,
  )}\n`,
);
await cp(join(publicRoot, "onboarding.html"), join(outdir, "onboarding.html"));
await cp(join(publicRoot, "popup.html"), join(outdir, "popup.html"));
await cp(join(publicRoot, "sidepanel.html"), join(outdir, "sidepanel.html"));
await cp(join(publicRoot, "ledger-grant.html"), join(outdir, "ledger-grant.html"));
await mkdir(join(outdir, "sandbox"), { recursive: true });
await cp(join(publicRoot, "sandbox/render.html"), join(outdir, "sandbox/render.html"));
await mkdir(vendorOutdir, { recursive: true });
await cp(
  "vendor/krusty-kms/crates/wasm/pkg/krusty_kms_wasm.js",
  join(vendorOutdir, "krusty_kms_wasm.js"),
);
await cp(
  "vendor/krusty-kms/crates/wasm/pkg/krusty_kms_wasm_bg.wasm",
  join(vendorOutdir, "krusty_kms_wasm_bg.wasm"),
);
await mkdir(join(outdir, "vendor/starknet-privacy/sdk"), { recursive: true });
await cp(
  "vendor/starknet-privacy/sdk/dist/browser/starknet-sdk.min.js",
  join(outdir, "vendor/starknet-privacy/sdk/starknet-sdk.min.js"),
);
await mkdir(join(outdir, "vendor/multisig"), { recursive: true });
await cp(
  "vendor/multisig/multisig.contract_class.json",
  join(outdir, "vendor/multisig/multisig.contract_class.json"),
);
