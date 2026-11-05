/**
 * Where a QSB preimage can leave Krusty. The BIP releases no secret before
 * its `exposed` record is durable, so the reveal is reachable from exactly
 * one place: the vault service's `releasePreimages`, which records the
 * exposure, awaits that write and only then reveals, all in one queue slot.
 * Every shipped source and script is scanned: Krusty's `revealQsbPreimages`
 * is called only by the Krusty adapter that wraps it and that one vault
 * method; `releasePreimages` is called only by the release flow; and
 * inside the vault method the exposure, its durable write and the reveal come
 * in that order.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/extension/src", "packages", "scripts"] as const;
const VAULT_METHOD = "packages/platform/vault/src/service/qsb-vault-withdrawals.ts";

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "node_modules" || entry === "tests" ? [] : sources(path);
    }
    return /\.(?:ts|js|mjs)$/.test(entry) ? [path] : [];
  });

const naming = (pattern: RegExp): readonly string[] =>
  ROOTS.flatMap((root) => sources(root))
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .sort();

describe("the QSB preimage reveal", () => {
  test("is called only by the Krusty adapter and the one vault method", () => {
    // Besides those two: the fake KMS defines its own stand-in (never shipped),
    // and check:krusty pins the reveal's known answer on a public test phrase.
    expect(naming(/\brevealQsbPreimages\(/)).toEqual([
      "packages/platform/kms-krusty/src/qsb-reveal.ts",
      VAULT_METHOD,
      "packages/testing/testkit/src/fake-kms.ts",
      "scripts/check-krusty-adapter.ts",
    ]);
  });

  test("the vault method is called only by the release flow", () => {
    expect(naming(/\.releasePreimages\(/)).toEqual([
      "apps/extension/src/background/qsb/qsb-withdrawal-release.ts",
    ]);
  });

  test("the vault method reveals only after recording and writing the exposure", () => {
    const text = readFileSync(VAULT_METHOD, "utf8");
    const reveals = [...text.matchAll(/\bkms\.revealQsbPreimages\(/g)];
    expect(reveals).toHaveLength(1);
    const recorded = text.indexOf("recordQsbExposure(binding");
    const written = text.indexOf("await writeQsbJournal(");
    const revealed = reveals[0]?.index ?? -1;
    expect(recorded).toBeGreaterThan(0);
    expect([recorded < written, written < revealed]).toEqual([true, true]);
  });
});
