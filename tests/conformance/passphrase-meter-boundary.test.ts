/**
 * The passphrase meter's common-password list (Sherlock 152) belongs to the
 * onboarding UI only. The length bounds in `passphrase.ts` are imported by the
 * background, vault and KMS adapter, so if they reach the meter, every one of
 * those bundles carries the list as dead weight.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => relative(root, join(root, dir, name)));

describe("passphrase meter boundary", () => {
  test("the length bounds module does not import the meter or its word list", () => {
    const bounds = read("packages/foundation/wallet-model/src/preferences/passphrase.ts");
    expect(bounds).not.toMatch(/from "\.\/(guessable|passphrase-strength)"/);
  });

  test("no background or platform module imports the meter", () => {
    const offenders = [
      ...sourceFiles("apps/extension/src/background"),
      ...readdirSync(join(root, "packages/platform")).flatMap((pkg) =>
        sourceFiles(`packages/platform/${pkg}/src`),
      ),
    ].filter((file) => read(file).includes("@bramble/wallet-model/passphrase-strength"));
    expect(offenders).toEqual([]);
  });
});
