/**
 * The mobile core adopts the extension's vault schema (v13), pinned by `vault-v13.json`: a vault the
 * extension's own service wrote. This fails when the committed payload is no longer what the
 * extension writes for the same phrase and accounts, or when the committed envelope no longer
 * opens to it: re-run `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { CURRENT_SCHEMA_VERSION, isVaultV13 } from "@bramble/vault/schema";
import { sealedIsCurrent } from "../../scripts/mobile-parity";
import {
  computeVaultParity,
  VAULT_PARITY_FIXTURE_PATH,
  VAULT_PARITY_PASSWORD,
  VAULT_PARITY_SCOPE,
  type VaultParity,
} from "../../scripts/mobile-parity-vault";

describe("mobile vault parity", () => {
  test("the committed v13 vault is what the extension writes today", async () => {
    const fixture = JSON.parse(await readFile(VAULT_PARITY_FIXTURE_PATH, "utf8")) as VaultParity;
    const expected = JSON.parse(
      JSON.stringify(await computeVaultParity(fixture.sealed)),
    ) as VaultParity;
    expect(fixture).toEqual(expected);
    expect(CURRENT_SCHEMA_VERSION).toBe(13);
    expect(isVaultV13(fixture.payload)).toBe(true);
    expect(
      await sealedIsCurrent(
        fixture.sealed,
        fixture.payload,
        VAULT_PARITY_PASSWORD,
        VAULT_PARITY_SCOPE,
      ),
    ).toBe(true);
  });
});
