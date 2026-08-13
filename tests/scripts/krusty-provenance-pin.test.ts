/**
 * MCW-V09-127: the vendored Krusty KMS package owns all wallet cryptography and
 * used to enter the build with nothing verified but the presence of two files.
 * These tests pin the provenance policy itself — pin extraction, revision
 * equality, worktree cleanliness, artifact digests — and assert the Krusty gate
 * runs it before importing the package, so the checks cannot be quietly dropped.
 *
 * They also pin the shape of what remains, in both directions. The gate must
 * keep the glue digest and the known-answer vectors, and the vendor script must
 * keep the rustc pin and the path remapping. It must NOT carry a byte digest for
 * `krusty_kms_wasm_bg.wasm`: `bun run vendor:krusty` compiles that file on the
 * builder's own toolchain, so such a literal holds only on the machine that
 * wrote it — round 2 of this remediation shipped one and it failed release CI on
 * the first foreign builder. Because that leaves the executing crypto core
 * with no byte provenance, the gate is required to say so and to name the
 * closure path (consuming Krusty KMS as a pinned npm dependency, issue #235), so
 * the missing assurance cannot be lost by deleting a comment.
 *
 * The policy is pure on purpose: it is exercised here without a vendored
 * checkout, which offline sandboxes do not have.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  type VendorProvenance,
  vendorPinFailures,
  vendorProvenanceFailures,
  vendorRevisionPin,
} from "../../scripts/vendor-pin-policy";
import { readWorkflowSources } from "../../scripts/workflow-inventory";

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

  test("digests the wasm-bindgen glue, which every builder reproduces", async () => {
    const source = await readFile("scripts/check-krusty-adapter.ts", "utf8");
    expect(source).toMatch(/const expectedGlueDigest = "[0-9a-f]{64}";/);
    const artifacts = source.slice(source.indexOf("artifacts: ["), source.indexOf("head:"));
    expect(artifacts).toContain("path: wasmPackage");
    expect(artifacts).toContain("expectedDigest: expectedGlueDigest");
  });

  test("pins no byte digest over the locally compiled crypto core", async () => {
    const source = await readFile("scripts/check-krusty-adapter.ts", "utf8");
    // `vendor:krusty` builds this file with wasm-pack on the builder's own
    // toolchain, so a digest literal cannot hold across machines: it fails every
    // host but the one that produced it while verifying nothing anywhere.
    const artifacts = source.slice(source.indexOf("artifacts: ["), source.indexOf("head:"));
    expect(artifacts).not.toContain("path: wasmBinary");
    expect(source).not.toMatch(/const expectedWasmDigest =/);
  });

  test("states that the crypto core has no byte provenance and names the closure", async () => {
    const source = await readFile("scripts/check-krusty-adapter.ts", "utf8");
    const header = source.slice(0, source.indexOf("*/"));
    expect(header).toContain("What is NOT established today");
    expect(header).toContain("issue #235");
  });

  test("keeps the known-answer vectors, the only check on the wasm's behaviour", async () => {
    const source = await readFile("scripts/check-krusty-adapter.ts", "utf8");
    expect(source).toContain("known-answer vectors do not match the reviewed build");
  });
});

describe("the Krusty build pin", () => {
  const vendorScript = "scripts/vendor-krusty.ts";

  test("pins a rustc release and remaps every absolute build path", async () => {
    const source = await readFile(vendorScript, "utf8");
    // Neither makes the wasm reproducible on its own, but without them it
    // embeds the builder's paths and rustc release and two builds of the pinned
    // revision cannot be compared at all — the prerequisite issue #235 needs.
    expect(source).toMatch(/const KRUSTY_KMS_TOOLCHAIN = "\d+\.\d+\.\d+";/);
    expect(source).toContain("RUSTUP_TOOLCHAIN: KRUSTY_KMS_TOOLCHAIN");
    expect(source).toContain("--remap-path-prefix=");
    expect(source).toContain("RUSTFLAGS: rustflags");
  });

  test("fails closed unless wasm-pack is exactly the workflow-pinned release", async () => {
    const source = await readFile(vendorScript, "utf8");
    expect(source).toContain('const KRUSTY_WASM_PACK_VERSION = "0.13.1"');
    expect(source).toContain('["wasm-pack", "--version"]');
    expect(source).toContain("wasmPackVersion !== `wasm-pack $" + "{KRUSTY_WASM_PACK_VERSION}`");
  });

  test("every workflow that vendors Krusty installs the pinned toolchain", async () => {
    const source = await readFile(vendorScript, "utf8");
    const toolchain = source.match(/const KRUSTY_KMS_TOOLCHAIN = "([\d.]+)";/)?.[1];
    expect(toolchain).toMatch(/^\d+\.\d+\.\d+$/);
    const vendoring: string[] = [];
    for (const [workflow, yaml] of Object.entries(await readWorkflowSources())) {
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
