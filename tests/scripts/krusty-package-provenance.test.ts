/** Published Krusty package provenance and extension-packaging policy. */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { readWorkflowSources } from "../../scripts/workflow-inventory";

const packageName = "@starknetfoundation/krusty-kms-wasm";
const packageVersion = "0.10.0";

describe("published Krusty package", () => {
  test("is an exact runtime dependency with no source-vendoring script", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      readonly dependencies?: Readonly<Record<string, unknown>>;
      readonly scripts?: Readonly<Record<string, unknown>>;
    };
    expect(manifest.dependencies?.[packageName]).toBe(packageVersion);
    expect(await readFile("bun.lock", "utf8")).toMatch(
      /@starknetfoundation\/krusty-kms-wasm@0\.10\.0.*sha512-/,
    );
    expect(manifest.scripts?.["vendor:krusty"]).toBeUndefined();
    expect(await Bun.file("scripts/vendor-krusty.ts").exists()).toBe(false);
  });

  test("pins both published runtime files before importing the package", async () => {
    const source = await readFile("scripts/check-krusty-adapter.ts", "utf8");
    const digestLoop = source.indexOf("for (const [path, expectedDigest]");
    const packageImport = source.indexOf(
      'createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"))',
    );
    expect(source).toContain(`const packageVersion = "${packageVersion}"`);
    expect(source).toMatch(/krusty_kms_wasm\.js.*[0-9a-f]{64}/s);
    expect(source).toMatch(/krusty_kms_wasm_bg\.wasm.*[0-9a-f]{64}/s);
    expect(source).toContain('manifest["main"] !== "krusty_kms_wasm.js"');
    expect(source).toContain('Object.hasOwn(manifest, "exports")');
    expect(digestLoop).toBeGreaterThan(-1);
    let depth = 0;
    let digestLoopEnd = -1;
    for (let index = source.indexOf("{", digestLoop); index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) {
        digestLoopEnd = index;
        break;
      }
    }
    expect(digestLoopEnd).toBeGreaterThan(digestLoop);
    expect(packageImport).toBeGreaterThan(digestLoopEnd);
    expect(source).toContain("known-answer vectors do not match the reviewed build");
  });

  test("copies only installed package bytes into the extension", async () => {
    const build = await readFile("apps/extension/build.ts", "utf8");
    expect(build).toContain(`node_modules/${packageName}`);
    expect(build).toContain("dependencies/krusty-kms");
    expect(build).not.toContain("vendor/krusty-kms");
  });

  test("workflows install the lockfile and never vendor Krusty source", async () => {
    for (const [name, source] of Object.entries(await readWorkflowSources())) {
      expect(source, name).not.toContain("vendor:krusty");
      if (source.includes("bun run build")) {
        expect(source, name).toContain("bun install --frozen-lockfile");
      }
    }
  });
});
