/**
 * The mobile core adopts the extension's vault schema (v13), pinned by `vault-v13.json`: a vault
 * the extension's own service wrote, at schema 13 (see `scripts/mobile-parity-vault.ts`). This fails when the committed payload is no longer what the
 * extension writes for the same phrase and accounts, or when the committed envelope no longer
 * opens to it: re-run `bun run mobile:parity`. `vault-v13-imported.json` is held to the same rule
 * for the vault with two raw-key imports (wallet-core P3).
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { CURRENT_SCHEMA_VERSION, isVaultV13 } from "@bramble/vault/schema";
import {
  computeImportedVaultParity,
  computeVaultParity,
  VAULT_IMPORTED_FIXTURE_PATH,
  VAULT_PARITY_FIXTURE_PATH,
  type VaultParity,
} from "../../scripts/mobile-parity-vault";

describe("mobile vault parity", () => {
  test("the committed v13 vault is what the extension writes today", async () => {
    const fixture = JSON.parse(await readFile(VAULT_PARITY_FIXTURE_PATH, "utf8")) as VaultParity;
    const expected = JSON.parse(
      JSON.stringify(await computeVaultParity(fixture.sealed)),
    ) as VaultParity;
    expect(fixture).toEqual(expected);
    // The extension writes v14; wallet-core still reads v13, so this fixture stays at 13.
    expect(CURRENT_SCHEMA_VERSION).toBe(14);
    expect(isVaultV13(fixture.payload)).toBe(true);
  });

  test("the committed imported-key vault (P3) is what the extension writes today", async () => {
    const fixture = JSON.parse(await readFile(VAULT_IMPORTED_FIXTURE_PATH, "utf8")) as VaultParity;
    const expected = JSON.parse(
      JSON.stringify(await computeImportedVaultParity(fixture.sealed)),
    ) as VaultParity;
    expect(fixture).toEqual(expected);
    expect(isVaultV13(fixture.payload)).toBe(true);
  });
});
