/**
 * Builds the MV3 extension with Bun and copies static extension assets into dist.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const outdir = "dist";
const vendorOutdir = join(outdir, "vendor/krusty-kms/pkg");

const requireBuild = (result: Bun.BuildOutput): void => {
  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error("extension build failed");
  }
};

await rm(outdir, { force: true, recursive: true });
await mkdir(outdir, { recursive: true });

requireBuild(
  await Bun.build({
    entrypoints: ["src/background/index.ts"],
    format: "esm",
    minify: true,
    outdir: join(outdir, "background"),
    target: "browser",
  }),
);

requireBuild(
  await Bun.build({
    entrypoints: ["src/popup/index.ts"],
    format: "esm",
    minify: true,
    outdir: join(outdir, "popup"),
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

await cp("public/manifest.json", join(outdir, "manifest.json"));
await cp("public/popup.html", join(outdir, "popup.html"));
await mkdir(vendorOutdir, { recursive: true });
await cp(
  "vendor/krusty-kms/crates/wasm/pkg/krusty_kms_wasm.js",
  join(vendorOutdir, "krusty_kms_wasm.js"),
);
await cp(
  "vendor/krusty-kms/crates/wasm/pkg/krusty_kms_wasm_bg.wasm",
  join(vendorOutdir, "krusty_kms_wasm_bg.wasm"),
);
