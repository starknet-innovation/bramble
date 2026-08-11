/**
 * MCW-V09-127: the vendored Krusty KMS package owns all wallet cryptography and
 * used to enter the build with nothing verified but the presence of two files.
 * These tests pin the provenance policy itself — pin extraction, revision
 * equality, worktree cleanliness, artifact digests — and assert the Krusty gate
 * runs it before importing the package, so the checks cannot be quietly dropped.
 * They also pin what makes the wasm digest meaningful: the gate must digest the
 * executing crypto core and not only the glue, and the vendor script must pin
 * the rustc release and remap the build paths that would otherwise make the
 * artifact machine-specific.
 *
 * The policy is pure on purpose: it is exercised here without a vendored
 * checkout, which offline sandboxes do not have.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import {
  type VendorProvenance,
  vendorPinFailures,
  vendorProvenanceFailures,
  vendorRevisionPin,
} from "../../scripts/vendor-pin-policy";

const revision = "fb0b274dd654f69a828dee653576416f5a650a01";
const otherRevision = "0123456789abcdef0123456789abcdef01234567";
const script = "scripts/vendor-krusty.ts";
const constant = "KRUSTY_KMS_REVISION";

const provenance = (overrides: Partial<VendorProvenance> = {}): VendorProvenance => ({
  artifacts: [{ digest: "abc", expectedDigest: "abc", path: "pkg/glue.js" }],
  head: revision,
  name: "Krusty KMS",
  pinnedRevision: revision,
  worktreeStatus: "",
  ...overrides,
});

describe("vendorRevisionPin", () => {
  test("reads the same literal the pin check enforces", () => {
    const source = `const ${constant} = "${revision}";\n`;
    expect(vendorPinFailures(source, script, constant)).toEqual([]);
    expect(vendorRevisionPin(source, script, constant)).toBe(revision);
  });

  test("fails closed on a missing or malformed pin", () => {
    expect(() => vendorRevisionPin('const OTHER = "x";', script, constant)).toThrow(
      `${script} must pin a commit in ${constant}`,
    );
    expect(() => vendorRevisionPin(`const ${constant} = "main";`, script, constant)).toThrow(
      `${script} must pin a commit in ${constant}`,
    );
  });

  test("reads the repository's real Krusty pin", async () => {
    const source = await readFile(script, "utf8");
    expect(vendorRevisionPin(source, script, constant)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("vendorProvenanceFailures", () => {
  test("accepts a checkout on the pinned commit with matching artifacts", () => {
    expect(vendorProvenanceFailures(provenance())).toEqual([]);
  });

  test("rejects a checkout that is not on the pinned commit", () => {
    expect(vendorProvenanceFailures(provenance({ head: otherRevision }))).toEqual([
      "Krusty KMS checkout does not match the pinned revision",
    ]);
  });

  test("rejects a locally modified checkout", () => {
    expect(
      vendorProvenanceFailures(provenance({ worktreeStatus: " M crates/wasm/src/lib.rs" })),
    ).toEqual(["Krusty KMS checkout has local modifications"]);
  });

  test("rejects a runtime artifact that is not the reviewed build", () => {
    const failures = vendorProvenanceFailures(
      provenance({
        artifacts: [{ digest: "tampered", expectedDigest: "abc", path: "pkg/glue.js" }],
      }),
    );
    expect(failures).toEqual(["pkg/glue.js does not match the reviewed artifact digest"]);
  });

  test("names every artifact that fails, not just the first", () => {
    expect(
      vendorProvenanceFailures(
        provenance({
          artifacts: [
            { digest: "tampered", expectedDigest: "abc", path: "pkg/core.wasm" },
            { digest: "tampered", expectedDigest: "abc", path: "pkg/glue.js" },
          ],
        }),
      ),
    ).toEqual([
      "pkg/core.wasm does not match the reviewed artifact digest",
      "pkg/glue.js does not match the reviewed artifact digest",
    ]);
  });

  test("reports every mismatch rather than the first", () => {
    expect(
      vendorProvenanceFailures(
        provenance({
          artifacts: [{ digest: "tampered", expectedDigest: "abc", path: "pkg/glue.js" }],
          head: otherRevision,
          worktreeStatus: "?? evil.rs",
        }),
      ),
    ).toHaveLength(3);
  });
});

describe("the Krusty gate", () => {
  test("verifies provenance before importing the vendored package", async () => {
    const source = await readFile("scripts/check-krusty-adapter.ts", "utf8");
    const provenanceCheck = source.indexOf("vendorProvenanceFailures(");
    const digest = source.indexOf('createHash("sha256")');
    const head = source.indexOf('git(["rev-parse", "HEAD"])');
    const worktree = source.indexOf('git(["status", "--porcelain"])');
    const packageImport = source.indexOf("createKrustyKms(await import(");
    for (const index of [provenanceCheck, digest, head, worktree]) {
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(packageImport);
    }
  });

  test("pins a digest for both shipped artifacts, not only the glue", async () => {
    const source = await readFile("scripts/check-krusty-adapter.ts", "utf8");
    expect(source).toMatch(/const expectedGlueDigest = "[0-9a-f]{64}";/);
    expect(source).toMatch(/const expectedWasmDigest = "[0-9a-f]{64}";/);
    // The crypto core that actually executes must be one of the digested
    // artifacts; a gate that pins only the glue leaves the wasm substitutable.
    const artifacts = source.slice(source.indexOf("artifacts: ["), source.indexOf("head:"));
    expect(artifacts).toContain("path: wasmBinary");
    expect(artifacts).toContain("expectedDigest: expectedWasmDigest");
  });

  test("keeps the known-answer vectors alongside the digests", async () => {
    const source = await readFile("scripts/check-krusty-adapter.ts", "utf8");
    expect(source).toContain("known-answer vectors do not match the reviewed build");
  });
});

describe("the Krusty build pin", () => {
  const vendorScript = "scripts/vendor-krusty.ts";

  test("pins a rustc release and remaps every absolute build path", async () => {
    const source = await readFile(vendorScript, "utf8");
    // Without both, the wasm embeds the builder's paths and no digest can hold.
    expect(source).toMatch(/const KRUSTY_KMS_TOOLCHAIN = "\d+\.\d+\.\d+";/);
    expect(source).toContain("RUSTUP_TOOLCHAIN: KRUSTY_KMS_TOOLCHAIN");
    expect(source).toContain("--remap-path-prefix=");
    expect(source).toContain("RUSTFLAGS: rustflags");
  });

  test("every workflow that vendors Krusty installs the pinned toolchain", async () => {
    const source = await readFile(vendorScript, "utf8");
    const toolchain = source.match(/const KRUSTY_KMS_TOOLCHAIN = "([\d.]+)";/)?.[1];
    expect(toolchain).toMatch(/^\d+\.\d+\.\d+$/);
    const directory = ".github/workflows";
    const workflows = (await readdir(directory)).filter((name) => name.endsWith(".yml"));
    const vendoring: string[] = [];
    for (const workflow of workflows) {
      const yaml = await readFile(`${directory}/${workflow}`, "utf8");
      if (yaml.includes("bun run vendor:krusty")) {
        vendoring.push(workflow);
        expect({ workflow, pinned: yaml.includes(`toolchain: ${toolchain}`) }).toEqual({
          workflow,
          pinned: true,
        });
      }
    }
    expect(vendoring.length).toBeGreaterThan(0);
  });
});
