/**
 * Krusty alone signs Bramble's Bitcoin transactions. `@scure/btc-signer`
 * builds, parses, finalizes and extracts QSB deposits, but its own signing
 * (`sign`, `signIdx`), its key helpers (`signECDSA`, `signSchnorr`,
 * `randomPrivateKeyBytes`, `pubECDSA`, `pubSchnorr`, `taprootTweakPrivKey`)
 * and its key containers (`WIF`, `HDKey`) must never be called from a Bramble
 * source: a second signer would be a fallback the architecture forbids. This
 * scans every shipped source and script, and proves the scan catches a
 * violation.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/extension/src", "packages", "scripts"] as const;
const FORBIDDEN =
  /\.(?:sign|signIdx)\s*\(|\b(?:HDKey|WIF|pubECDSA|pubSchnorr|randomPrivateKeyBytes|signECDSA|signSchnorr|taprootTweakPrivKey)\b/;

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "node_modules" || entry === "tests" ? [] : sources(path);
    }
    return /\.(?:ts|js|mjs)$/.test(entry) ? [path] : [];
  });

// A file that reaches btc-signer and names one of its signing entry points.
const violates = (text: string): boolean =>
  text.includes("@scure/btc-signer") && FORBIDDEN.test(text);

describe("Bitcoin signing", () => {
  test("no Bramble source that reaches btc-signer calls its signing", () => {
    const files = ROOTS.flatMap((root) => sources(root));
    const reaching = files.filter((file) =>
      readFileSync(file, "utf8").includes("@scure/btc-signer"),
    );
    expect(reaching.length).toBeGreaterThan(0);
    expect(reaching.filter((file) => violates(readFileSync(file, "utf8")))).toEqual([]);
  });

  test("the scan would catch a source that did", () => {
    const importing = 'import { Transaction } from "@scure/btc-signer";\n';
    expect(violates(`${importing}tx.sign(key);`)).toBe(true);
    expect(violates(`${importing}tx.signIdx(key, 0);`)).toBe(true);
    expect(violates('import { signECDSA } from "@scure/btc-signer/utils.js";')).toBe(true);
    expect(violates(`${importing}tx.finalizeIdx(0);`)).toBe(false);
  });
});
