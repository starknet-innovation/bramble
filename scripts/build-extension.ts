/**
 * Builds the MV3 extension with Bun and copies static extension assets into dist.
 */
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const outdir = "dist";
const krustyModule = "/vendor/krusty-kms/pkg/krusty_kms_wasm.js";
const vendorOutdir = join(outdir, "vendor/krusty-kms/pkg");
const LEDGER_BUFFER_MODULES =
  /[\\/]node_modules[\\/]@ledgerhq[\\/](?:hw-app-starknet|hw-transport|hw-transport-webhid)[\\/].*\.js$/;

// Ledger's browser packages still reference the Node `Buffer` identifier
// without importing it. Inject a MODULE-LOCAL import only into those pinned
// package files while building the side panel; this avoids installing Buffer
// on `globalThis`, where unrelated panel code could observe or replace it.
const ledgerBufferBoundary: Bun.BunPlugin = {
  name: "ledger-buffer-boundary",
  setup(builder) {
    builder.onLoad({ filter: LEDGER_BUFFER_MODULES }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      return {
        contents: source.includes("Buffer")
          ? `import { Buffer } from "buffer";\n${source}`
          : source,
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

await run(["bun", "run", "check:extension"]);
await run(["bun", "run", "check:krusty"]);
await run(["bun", "run", "check:multisig"]);
await rm(outdir, { force: true, recursive: true });
await mkdir(outdir, { recursive: true });

requireBuild(
  await Bun.build({
    entrypoints: ["src/background/index.ts"],
    external: [krustyModule],
    format: "esm",
    minify: true,
    outdir: join(outdir, "background"),
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    entrypoints: ["src/sidepanel/index.ts"],
    format: "esm",
    minify: true,
    outdir: join(outdir, "sidepanel"),
    plugins: [ledgerBufferBoundary],
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    entrypoints: ["src/ledger-grant/index.ts"],
    format: "esm",
    minify: true,
    outdir: join(outdir, "ledger-grant"),
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    entrypoints: ["src/content/index.ts"],
    format: "iife",
    minify: true,
    outdir: join(outdir, "content"),
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    entrypoints: ["src/provider/inpage.ts"],
    format: "iife",
    minify: true,
    outdir: join(outdir, "provider"),
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    entrypoints: ["src/sandbox/render.ts"],
    format: "esm",
    minify: true,
    outdir: join(outdir, "sandbox"),
    target: "browser",
  }),
);

await cp("public/manifest.json", join(outdir, "manifest.json"));
await cp("public/popup.html", join(outdir, "popup.html"));
await cp("public/sidepanel.html", join(outdir, "sidepanel.html"));
await cp("public/ledger-grant.html", join(outdir, "ledger-grant.html"));
await mkdir(join(outdir, "sandbox"), { recursive: true });
await cp("public/sandbox/render.html", join(outdir, "sandbox/render.html"));
await mkdir(vendorOutdir, { recursive: true });
await cp(
  "vendor/krusty-kms/crates/wasm/pkg/krusty_kms_wasm.js",
  join(vendorOutdir, "krusty_kms_wasm.js"),
);
await cp(
  "vendor/krusty-kms/crates/wasm/pkg/krusty_kms_wasm_bg.wasm",
  join(vendorOutdir, "krusty_kms_wasm_bg.wasm"),
);
await mkdir(join(outdir, "vendor/multisig"), { recursive: true });
await cp(
  "vendor/multisig/multisig.contract_class.json",
  join(outdir, "vendor/multisig/multisig.contract_class.json"),
);
