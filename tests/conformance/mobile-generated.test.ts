/**
 * The mobile wallet reuses the extension's design system, network catalog, and Krusty release
 * rather than restating them. These tests fail when a committed mobile copy drifts from its
 * TypeScript source: re-run `bun run mobile:assets` (tokens, networks, brand mark) or
 * `bun run mobile:parity` (derivation vectors) and commit the result.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { EXPECTED_DEPENDENCIES } from "../../scripts/config-standards-policy";
import { readMobileAssetSources, renderMobileAssets } from "../../scripts/mobile-assets";
import { FACE_ID_USAGE, SECURITY_POLICY } from "../../scripts/mobile-assets/security-copy";
import {
  computeParityAccounts,
  computeUiParity,
  PARITY_FIXTURE_PATH,
  PARITY_MESSAGE_HASH,
  PARITY_MNEMONIC,
} from "../../scripts/mobile-parity";

describe("mobile generated sources", async () => {
  for (const [path, expected] of renderMobileAssets(await readMobileAssetSources())) {
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
      readonly ui: unknown;
    };
    expect(fixture.mnemonic).toBe(PARITY_MNEMONIC);
    expect(fixture.messageHash).toBe(PARITY_MESSAGE_HASH);
    expect(fixture.accounts).toEqual(await computeParityAccounts());
    expect(fixture.ui).toEqual(JSON.parse(JSON.stringify(computeUiParity())));
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

describe("mobile vault security", () => {
  test("the idle lock and KDF policy are the extension's own values", () => {
    expect(SECURITY_POLICY.idleLockMs).toBe(30 * 60 * 1000);
    expect(SECURITY_POLICY.kdfIterations).toBe(600_000);
  });

  test("the iOS Face ID usage string is the generated copy", async () => {
    const spec = await readFile("mobile/ios/project.yml", "utf8");
    expect(spec).toContain(`INFOPLIST_KEY_NSFaceIDUsageDescription: "${FACE_ID_USAGE}"`);
  });

  test("the parity fixture carries an extension-sealed DEK slot", async () => {
    const fixture = JSON.parse(await readFile(PARITY_FIXTURE_PATH, "utf8")) as {
      readonly dekSlot: { readonly scope: string; readonly sealed: { readonly scope: string } };
    };
    expect(fixture.dekSlot.scope).toBe("bramble.mobile.dek.v1");
    expect(fixture.dekSlot.sealed.scope).toBe(fixture.dekSlot.scope);
  });
});
