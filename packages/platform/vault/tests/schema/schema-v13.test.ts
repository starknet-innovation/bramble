/**
 * Schema v13: a multisig's shared STRK20 viewing key (#826).
 *
 * Old data migrates to empty collections. Current data validates a canonical
 * key bound to the multisig's own chain. Invalid data fails the vault closed.
 */
import { describe, expect, test } from "bun:test";
import { migrateVault, VAULT_MIGRATIONS } from "@bramble/vault/migrations";
import { MULTISIG_STRK20_VIEWING_KEY_SCHEME } from "@bramble/vault/multisig-strk20-key";
import { CURRENT_SCHEMA_VERSION, isVaultV12, isVaultV13 } from "@bramble/vault/schema";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";

const account = {
  accountContractType: "openzeppelin",
  address: "0x123",
  classHash: "0x5400e90f7e0ae78bd02c77cd75527280470e2fe19c54970dd79dc37a9d3645c",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};

const v12 = {
  accounts: [account],
  accountSecrets: [],
  activeAccountId: account.id,
  importedSeeds: [],
  mnemonic: null,
  originGrants: [],
  schemaVersion: 12,
  shadowAccountScopes: [],
  signingKeys: [{ accountId: account.id, privateKey: "0x456" }],
};

const key = {
  chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
  multisigId: "SN_MAIN:0xabc",
  poolAddress: "0x123",
  scheme: MULTISIG_STRK20_VIEWING_KEY_SCHEME,
  viewingKey: "0x654321",
};

const v13 = (
  multisigStrk20ViewingKeys: readonly unknown[],
  multisigStrk20KeyConflicts: readonly unknown[] = [],
) => ({
  ...v12,
  multisigStrk20KeyConflicts,
  multisigStrk20ViewingKeys,
  schemaVersion: 13,
});

describe("schema v13 (current)", () => {
  test("is the current version, reached by exactly one adjacent step", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(13);
    expect(VAULT_MIGRATIONS.at(-1)).toMatchObject({ fromVersion: 12, toVersion: 13 });
  });

  test("old: a v12 vault migrates to empty collections and nothing else", () => {
    expect(isVaultV12(v12)).toBe(true);
    expect(migrateVault(v12) as unknown).toEqual(v13([]));
    expect(migrateVault(structuredClone(v12))).toEqual(migrateVault(v12));
    expect(isVaultV12({ ...v12, multisigStrk20ViewingKeys: [] })).toBe(false);
  });

  test("current: a canonical key validates, and a conflict requires that key", () => {
    expect(isVaultV13(v13([]))).toBe(true);
    expect(isVaultV13(v13([key]))).toBe(true);
    expect(
      isVaultV13(
        v13(
          [key],
          [{ chainId: key.chainId, multisigId: key.multisigId, poolAddress: key.poolAddress }],
        ),
      ),
    ).toBe(true);
    expect(migrateVault(v13([key])) as unknown).toEqual(v13([key]));
  });

  test("invalid: a bad key, a foreign chain, or a conflict without a key fails closed", () => {
    expect(isVaultV13(v13([{ ...key, viewingKey: "0x0654321" }]))).toBe(false);
    expect(isVaultV13(v13([{ ...key, chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId }]))).toBe(
      false,
    );
    expect(
      isVaultV13(
        v13(
          [],
          [{ chainId: key.chainId, multisigId: key.multisigId, poolAddress: key.poolAddress }],
        ),
      ),
    ).toBe(false);
    expect(isVaultV13(v13([key, key]))).toBe(false);
    expect(() => migrateVault(v13([{ ...key, extra: true }]))).toThrow("Unsupported vault schema");
  });
});
