/**
 * MG1 regression suite: proves the vault migration chain preserves all
 * fund-bearing fields, stays idempotent at the current schema, accepts the
 * null-mnemonic retention shape, and rejects unsupported schema versions.
 */
import { describe, expect, test } from "bun:test";
import { CURRENT_SCHEMA_VERSION, migrateVault } from "@bramble/vault/migrations";
import {
  isVaultV1,
  isVaultV11,
  type VaultV1,
  type VaultV2,
  type VaultV11,
} from "@bramble/vault/schema";

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
  test("v1 -> current preserves every account, signing key, origin grant, and active id", () => {
    expect(isVaultV1(multiAccountV1)).toBe(true);

    const migrated = migrateVault(multiAccountV1);

    expect(isVaultV11(migrated)).toBe(true);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.mnemonic).toBeNull();
    expect(migrated.accounts).toEqual(
      multiAccountV1.accounts.map((account) => ({
        accountContractType: "openzeppelin",
        ...account,
      })),
    );
    expect(migrated.signingKeys).toEqual(multiAccountV1.signingKeys);
    expect(migrated.originGrants).toEqual(multiAccountV1.originGrants);
    expect(migrated.activeAccountId).toBe(multiAccountV1.activeAccountId);
    expect(migrated).not.toBe(multiAccountV1);
  });

  test("v0 sources migrate through the full chain to an empty current vault", () => {
    const expected: VaultV11 = {
      accounts: [],
      accountSecrets: [],
      activeAccountId: null,
      importedSeeds: [],
      mnemonic: null,
      originGrants: [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      signingKeys: [],
    };
    for (const source of [null, undefined, {}]) {
      const migrated = migrateVault(source);
      expect(isVaultV11(migrated)).toBe(true);
      expect(migrated).toEqual(expected);
    }
  });

  test("a v2 vault with mnemonic:null migrates to the current schema, then idempotently", () => {
    const nullMnemonic: VaultV2 = { ...multiAccountV1, mnemonic: null, schemaVersion: 2 };

    const once = migrateVault(nullMnemonic);
    expect(once).not.toBe(nullMnemonic);
    expect(isVaultV11(once)).toBe(true);
    expect(once).toEqual({
      ...nullMnemonic,
      accounts: nullMnemonic.accounts.map((account) => ({
        accountContractType: "openzeppelin",
        ...account,
      })),
      accountSecrets: [],
      importedSeeds: [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    expect(migrateVault(once)).toBe(once);
  });

  test("a v2 vault with a retained mnemonic migrates to the current schema", () => {
    const withMnemonic: VaultV2 = {
      ...multiAccountV1,
      mnemonic: "correct horse battery staple",
      schemaVersion: 2,
    };

    const migrated = migrateVault(withMnemonic);
    expect(isVaultV11(migrated)).toBe(true);
    expect(migrated.mnemonic).toBe("correct horse battery staple");
    expect(migrated).toEqual({
      ...withMnemonic,
      accounts: withMnemonic.accounts.map((account) => ({
        accountContractType: "openzeppelin",
        ...account,
      })),
      accountSecrets: [],
      importedSeeds: [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
  });

  test("rejects unsupported and newer schema versions instead of accepting them", () => {
    for (const schemaVersion of [-1, 1.5, 9, 999, Number.MAX_SAFE_INTEGER]) {
      expect(() => migrateVault({ ...multiAccountV1, mnemonic: null, schemaVersion })).toThrow(
        "Unsupported vault schema",
      );
    }
  });

  test("rejects a well-formed current shell carrying a future schema version", () => {
    const future = { ...multiAccountV1, mnemonic: null, schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(isVaultV11(future)).toBe(false);
    expect(() => migrateVault(future)).toThrow("Unsupported vault schema");
  });
});
