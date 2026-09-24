/**
 * Builds the MV3 extension with Bun and copies static extension assets into each
 * target's output directory.
 *
 * One bundle set serves both browsers; the manifest and the shipped page set
 * differ. `--target=firefox` writes the Gecko output to `dist-firefox/`, and
 * `--target=all` writes both from one run of the prerequisite gates — those
 * gates check the sources, which no target changes, so running them per target
 * would only make a two-browser build twice as slow to fail. The two emissions
 * then run concurrently: their output directories are disjoint and every input
 * they read is read-only, so neither can observe the other.
 *
 * See `./firefox-manifest.ts` for what the Gecko target changes, and why.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type BuildTarget, nameLimit, outputDirectory, requestedTargets } from "./build-target";
import { shipsSandboxedRenderer, toFirefoxManifest } from "./firefox-manifest";

const repositoryRoot = join(import.meta.dir, "../..");
process.chdir(repositoryRoot);
const extensionRoot = "apps/extension";
const publicRoot = join(extensionRoot, "public");

const buildTargets = requestedTargets(Bun.argv);
const krustyModule = "/dependencies/krusty-kms/krusty_kms_wasm.js";
const privacySdkModule = "/vendor/starknet-privacy/sdk/starknet-sdk.min.js";
const krustyPackage = "node_modules/@starknetfoundation/krusty-kms-wasm";
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

// Stamp extension bundles with the manifest version and source branch so the
// settings screen and gateway analytics can identify the exact build. Released
// builds (main, or a detached tag checkout reporting HEAD) carry no branch.
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
await run(["bun", "run", "check:extension"]);
await run(["bun", "run", "check:krusty"]);
await run(["bun", "run", "check:argent"]);
await run(["bun", "run", "check:privacy"]);
/**
 * Writes one target's complete output directory: its bundles, its manifest, and
 * its static assets. Every path below is derived from `target`, so two
 * concurrent calls share no state and cannot write to the same file.
 */
const emit = async (target: BuildTarget): Promise<void> => {
  const outdir = outputDirectory(target);
  const krustyOutdir = join(outdir, "dependencies/krusty-kms");
  const buildStamp = {
    __MC_BUILD_BRANCH__: JSON.stringify(devBranch),
    __MC_BUILD_TARGET__: JSON.stringify(target),
    __MC_BUILD_VERSION__: JSON.stringify(manifestVersion ?? ""),
  };

  await rm(outdir, { force: true, recursive: true });
  await mkdir(outdir, { recursive: true });

  requireBuild(
    await Bun.build({
      define: buildStamp,
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

  // The collectible renderer ships only where the manifest can declare it as a
  // sandboxed page. Firefox gained the `sandbox` key in 154 and this build
  // supports ESR, so on Gecko the key would be ignored and the page would load
  // with full extension privileges. Nothing is lost: the collectibles journey
  // is parked and no view can reach the gallery.
  if (shipsSandboxedRenderer(target)) {
    requireBuild(
      await Bun.build({
        entrypoints: [join(extensionRoot, "src/sandbox/render.ts")],
        format: "esm",
        minify: true,
        outdir: join(outdir, "sandbox"),
        target: "browser",
      }),
    );
  }

  // The browser's extension list is the only place a loaded build identifies
  // itself, and every dev build otherwise looks identical to a release. Stamp the
  // branch into `name` and `version_name` (Chrome shows `version_name` in place of
  // `version` when present) so a side-by-side load is unambiguous. `version` stays
  // the numeric manifest value Chrome requires, and released builds — main, or a
  // detached tag checkout — are copied through untouched. Firefox does not
  // implement `version_name`, so the Gecko build carries the branch in `name`
  // only; an unknown key there is a packaging warning, not an identity.
  const chromeManifest = JSON.parse(
    await readFile(join(publicRoot, "manifest.json"), "utf8"),
  ) as Record<string, unknown>;
  const targetManifest = target === "firefox" ? toFirefoxManifest(chromeManifest) : chromeManifest;
  const developmentIdentity = (manifest: Record<string, unknown>): Record<string, unknown> => ({
    ...manifest,
    name: `${String(manifest["name"] ?? "Bramble")} · ${devBranch}`.slice(0, nameLimit(target)),
    ...(target === "firefox"
      ? {}
      : { version_name: `${manifestVersion ?? ""} · ${devBranch}`.slice(0, 75) }),
  });
  await writeFile(
    join(outdir, "manifest.json"),
    `${JSON.stringify(
      devBranch === "" ? targetManifest : developmentIdentity(targetManifest),
      null,
      2,
    )}\n`,
  );
  await cp(join(publicRoot, "onboarding.html"), join(outdir, "onboarding.html"));
  await cp(join(publicRoot, "popup.html"), join(outdir, "popup.html"));
  await cp(join(publicRoot, "sidepanel.html"), join(outdir, "sidepanel.html"));
  await cp(join(publicRoot, "ledger-grant.html"), join(outdir, "ledger-grant.html"));
  await cp(join(publicRoot, "icons"), join(outdir, "icons"), { recursive: true });
  await cp(join(publicRoot, "brand"), join(outdir, "brand"), { recursive: true });
  if (shipsSandboxedRenderer(target)) {
    await mkdir(join(outdir, "sandbox"), { recursive: true });
    await cp(join(publicRoot, "sandbox/render.html"), join(outdir, "sandbox/render.html"));
  }
  await mkdir(krustyOutdir, { recursive: true });
  await cp(join(krustyPackage, "krusty_kms_wasm.js"), join(krustyOutdir, "krusty_kms_wasm.js"));
  await cp(
    join(krustyPackage, "krusty_kms_wasm_bg.wasm"),
    join(krustyOutdir, "krusty_kms_wasm_bg.wasm"),
  );
  await mkdir(join(outdir, "vendor/starknet-privacy/sdk"), { recursive: true });
  await cp(
    "vendor/starknet-privacy/sdk/dist/browser/starknet-sdk.min.js",
    join(outdir, "vendor/starknet-privacy/sdk/starknet-sdk.min.js"),
  );
};

await Promise.all(buildTargets.map(emit));
