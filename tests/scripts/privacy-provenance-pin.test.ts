/**
 * MCW-V09-127: the privacy SDK gate carried its own copy of the vendored
 * revision and verified nothing but the checkout head plus one bundle digest.
 * A second literal can disagree with the vendoring step about which commit was
 * fetched, and an unchecked worktree lets anything else in the checkout — the
 * source map the build-only-dependency assertions are read from included —
 * change without the gate noticing.
 *
 * These cases pin that the gate reads the pin back out of the vendor script
 * through the shared policy, digests both shipped files, checks the worktree,
 * and does all of it before importing the runtime. They are text and pure-policy
 * assertions on purpose: offline sandboxes have no vendored checkout.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { vendorPinFailures, vendorRevisionPin } from "../../scripts/vendor-pin-policy";

const gate = "scripts/check-privacy-sdk.ts";
const vendorScript = "scripts/vendor-privacy-sdk.ts";
const constant = "PRIVACY_SDK_REVISION";

describe("the privacy SDK pin", () => {
  test("the vendor script pins an immutable commit", async () => {
    const source = await readFile(vendorScript, "utf8");
    expect(vendorPinFailures(source, vendorScript, constant)).toEqual([]);
    expect(vendorRevisionPin(source, vendorScript, constant)).toMatch(/^[0-9a-f]{40}$/);
  });

  test("the gate holds no second copy of the revision", async () => {
    const source = await readFile(gate, "utf8");
    const pin = vendorRevisionPin(await readFile(vendorScript, "utf8"), vendorScript, constant);
    // The pin is read from the vendor script, so the commit must appear nowhere
    // in the gate — a copied literal is exactly the drift this forbids.
    expect(source).not.toContain(pin);
    expect(source).toContain(`vendorRevisionPin(`);
    expect(source).toContain(`"${constant}"`);
  });
});

describe("the privacy SDK gate", () => {
  test("verifies provenance before importing the vendored runtime", async () => {
    const source = await readFile(gate, "utf8");
    const provenanceCheck = source.indexOf("vendorProvenanceFailures(");
    const digest = source.indexOf('createHash("sha256")');
    const head = source.indexOf('git(["rev-parse", "HEAD"])');
    const worktree = source.indexOf('git(["status", "--porcelain"])');
    const runtimeImport = source.indexOf("await import(pathToFileURL(");
    expect(runtimeImport).toBeGreaterThan(-1);
    for (const index of [provenanceCheck, digest, head, worktree]) {
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(runtimeImport);
    }
  });

  test("digests both shipped files, not only the executing bundle", async () => {
    const source = await readFile(gate, "utf8");
    expect(source).toMatch(/const expectedDigest = "[0-9a-f]{64}";/);
    expect(source).toMatch(/const expectedSourceMapDigest =\s*"[0-9a-f]{64}";/);
    const artifacts = source.slice(source.indexOf("artifacts: ["), source.indexOf("head:"));
    // The source map feeds the build-only-dependency assertions; leaving it
    // unpinned would let those assertions be rewritten under a matching bundle.
    expect(artifacts).toContain("path: bundle");
    expect(artifacts).toContain("path: sourceMap");
    expect(artifacts).toContain("expectedDigest: expectedSourceMapDigest");
  });

  test("keeps the runtime-shape assertions alongside the digests", async () => {
    const source = await readFile(gate, "utf8");
    expect(source).toContain("Privacy SDK browser bundle contains forbidden runtime");
    expect(source).toContain("Privacy SDK browser bundle includes build-only dependency");
    expect(source).toContain(
      "Privacy SDK factory no longer exposes the reviewed transfer interface",
    );
  });
});
