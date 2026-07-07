/**
 * MG1 regression suite: proves the vault migration chain preserves all
 * fund-bearing fields, stays idempotent at the current schema, accepts the
 * null-mnemonic retention shape, and rejects unsupported schema versions.
 */
import { describe, expect, test } from "bun:test";
import { CURRENT_SCHEMA_VERSION, migrateVault } from "../src/storage/migrations";
import { isVaultV1, isVaultV2, type VaultV1, type VaultV2 } from "../src/storage/vault-schema";

const accountA = {
  address: "0x123",
  classHash: "0xabc",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_SEPOLIA:0x123",
  networkId: "SN_SEPOLIA" as const,
  publicKeyX: "0xa1",
  publicKeyY: "0xa2",
};

const accountB = {
  address: "0x456",
  classHash: "0xdef",
  derivation: { accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_SEPOLIA:0x456",
  networkId: "SN_SEPOLIA" as const,
  publicKeyX: "0xb1",
  publicKeyY: "0xb2",
};

const multiAccountV1: VaultV1 = {
  accounts: [accountA, accountB],
  activeAccountId: accountB.id,
  originGrants: [
    { accountIds: [accountA.id], origin: "https://one.example" },
    { accountIds: [accountA.id, accountB.id], origin: "https://two.example" },
  ],
  schemaVersion: 1,
  signingKeys: [
    { accountId: accountA.id, privateKey: "0x111" },
    { accountId: accountB.id, privateKey: "0x222" },
  ],
};

describe("MG1 migration chain", () => {
  test("v1 -> v2 preserves every account, signing key, origin grant, and active id", () => {
    expect(isVaultV1(multiAccountV1)).toBe(true);

    const migrated = migrateVault(multiAccountV1);

    expect(isVaultV2(migrated)).toBe(true);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.mnemonic).toBeNull();
    expect(migrated.accounts).toEqual(multiAccountV1.accounts);
    expect(migrated.signingKeys).toEqual(multiAccountV1.signingKeys);
    expect(migrated.originGrants).toEqual(multiAccountV1.originGrants);
    expect(migrated.activeAccountId).toBe(multiAccountV1.activeAccountId);
    expect(migrated).not.toBe(multiAccountV1);
  });

  test("v0 sources migrate through the full chain to an empty current vault", () => {
    const expected: VaultV2 = {
      accounts: [],
      activeAccountId: null,
      mnemonic: null,
      originGrants: [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      signingKeys: [],
    };
    for (const source of [null, undefined, {}]) {
      const migrated = migrateVault(source);
      expect(isVaultV2(migrated)).toBe(true);
      expect(migrated).toEqual(expected);
    }
  });

  test("a v2 vault with mnemonic:null validates and migrates idempotently", () => {
    const nullMnemonic: VaultV2 = { ...multiAccountV1, mnemonic: null, schemaVersion: 2 };

    expect(isVaultV2(nullMnemonic)).toBe(true);
    const once = migrateVault(nullMnemonic);
    expect(once).toBe(nullMnemonic);
    expect(migrateVault(once)).toBe(once);
  });

  test("a v2 vault with a retained mnemonic migrates idempotently", () => {
    const withMnemonic: VaultV2 = {
      ...multiAccountV1,
      mnemonic: "correct horse battery staple",
      schemaVersion: 2,
    };

    expect(isVaultV2(withMnemonic)).toBe(true);
    expect(migrateVault(withMnemonic)).toBe(withMnemonic);
  });

  test("rejects unsupported and newer schema versions instead of accepting them", () => {
    for (const schemaVersion of [-1, 1.5, 3, 999, Number.MAX_SAFE_INTEGER]) {
      expect(() => migrateVault({ ...multiAccountV1, mnemonic: null, schemaVersion })).toThrow(
        "Unsupported vault schema",
      );
    }
  });

  test("rejects a well-formed v2 shell carrying a future schema version", () => {
    const future = { ...multiAccountV1, mnemonic: null, schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(isVaultV2(future)).toBe(false);
    expect(() => migrateVault(future)).toThrow("Unsupported vault schema");
  });
});
