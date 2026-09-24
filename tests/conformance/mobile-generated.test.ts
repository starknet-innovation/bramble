/**
 * The mobile wallet reuses the extension's design system, network catalog, and Krusty release
 * rather than restating them. These tests fail when a committed mobile copy drifts from its
 * TypeScript source: re-run `bun run mobile:assets` (tokens, networks, brand mark) or
 * `bun run mobile:parity` (derivation vectors) and commit the result.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { EXPECTED_DEPENDENCIES } from "../../scripts/config-standards-policy";
import { renderMobileAssets } from "../../scripts/mobile-assets";
import {
  computeParityAccounts,
  PARITY_FIXTURE_PATH,
  PARITY_MESSAGE_HASH,
  PARITY_MNEMONIC,
} from "../../scripts/mobile-parity";

describe("mobile generated sources", () => {
  for (const [path, expected] of renderMobileAssets()) {
    test(`${path} matches its TypeScript source`, async () => {
      expect(await readFile(path, "utf8")).toBe(expected);
    });
  }
});

describe("mobile core parity", () => {
  test("the committed fixture is what the extension derives today", async () => {
    const fixture = JSON.parse(await readFile(PARITY_FIXTURE_PATH, "utf8")) as {
      readonly accounts: unknown;
      readonly messageHash: string;
      readonly mnemonic: string;
    };
    expect(fixture.mnemonic).toBe(PARITY_MNEMONIC);
    expect(fixture.messageHash).toBe(PARITY_MESSAGE_HASH);
    expect(fixture.accounts).toEqual(await computeParityAccounts());
  });

  test("the Rust core pins the same Krusty release as the extension", async () => {
    const cargo = await readFile("mobile/core/Cargo.toml", "utf8");
    const npmPin = EXPECTED_DEPENDENCIES["@starknetfoundation/krusty-kms-wasm"];
    expect(npmPin).toMatch(/^\d+\.\d+\.\d+$/);
    expect(cargo).toContain(`krusty-kms = { version = "=${npmPin}"`);
    expect(cargo).toContain(`krusty-kms-common = { version = "=${npmPin}"`);
    const lib = await readFile("mobile/core/src/lib.rs", "utf8");
    expect(lib).toContain(`krusty_version: "${npmPin}".into()`);
  });
});
