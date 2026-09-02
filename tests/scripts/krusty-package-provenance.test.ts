/**
 * Krusty package provenance and extension-packaging policy.
 *
 * This branch consumes a local wasm-pack build carrying the unpublished ML-DSA
 * exports instead of a registry release, so the specifier is a vendor/ tarball.
 * The provenance model is unchanged and is what these tests hold: bun.lock
 * pins the tarball by SHA-512, `check-krusty-adapter.ts` pins both runtime
 * files by SHA-256 before the import, and the extension is built only from the
 * installed package bytes — never from a Krusty source checkout.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { readWorkflowSources } from "../../scripts/workflow-inventory";

const packageName = "@starknetfoundation/krusty-kms-wasm";
const packageVersion = "0.11.0-pq.0";
const packageSpecifier = "file:vendor/starknetfoundation-krusty-kms-wasm-0.11.0-pq.0.tgz";

describe("the installed Krusty package", () => {
  test("is an exact runtime dependency with no source-vendoring script", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      readonly dependencies?: Readonly<Record<string, unknown>>;
      readonly scripts?: Readonly<Record<string, unknown>>;
    };
    expect(manifest.dependencies?.[packageName]).toBe(packageSpecifier);
    // The lockfile still pins immutable bytes: a resolved tarball plus its
    // SHA-512, the same guarantee the registry specifier carried.
    expect(await readFile("bun.lock", "utf8")).toMatch(
      /@starknetfoundation\/krusty-kms-wasm@vendor\/[^"]+\.tgz".*sha512-/,
    );
    expect(await Bun.file(packageSpecifier.replace("file:", "")).exists()).toBe(true);
    expect(manifest.scripts?.["vendor:krusty"]).toBeUndefined();
    expect(await Bun.file("scripts/vendor-krusty.ts").exists()).toBe(false);
  });

  test("pins both runtime files before importing the package", async () => {
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
