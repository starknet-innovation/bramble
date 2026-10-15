/**
 * Schema v11: accounts derived with Ready's ETH-seeded scheme (issue 505).
 *
 * The bump exists because `argentx-bip44` is a derivation kind no v10 build can
 * validate. The invariants worth pinning are the era boundaries: v11 admits the
 * kind, v10 refuses it exactly as it always did, and the adjacent migration
 * touches nothing but the version stamp — which is what makes an older build
 * meeting a v11 vault refuse it rather than misread records it cannot check.
 */
import { describe, expect, test } from "bun:test";
import { migrateVault } from "@bramble/vault/migrations";
import { CURRENT_SCHEMA_VERSION, isVaultV10, isVaultV11 } from "@bramble/vault/schema";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { canonicalFelt } from "@bramble/wallet-model/networks";

const PUBLIC_KEY = "0xabc";

const argentxAccount = {
  accountContractType: "argent",
  address: "0x123",
  classHash: canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) as string,
  deploymentSalt: PUBLIC_KEY,
  derivation: { addressIndex: 1, kind: "argentx-bip44" as const },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
};

const vaultOf = (account: Record<string, unknown>, schemaVersion: number) => ({
  accounts: [account],
  accountSecrets: [],
  activeAccountId: argentxAccount.id,
  importedSeeds: [],
  mnemonic: null,
  originGrants: [],
  schemaVersion,
  signingKeys: [{ accountId: argentxAccount.id, privateKey: "0x456" }],
});

describe("schema v11 (one step below current)", () => {
  test("sits one step below the current version", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(12);
  });

  test("admits a Ready-scheme account that v10 refuses", () => {
    expect(isVaultV11(vaultOf(argentxAccount, 11))).toBe(true);
    // No v10 writer produced the kind, so a v10 record claiming it is corrupt.
    expect(isVaultV10(vaultOf(argentxAccount, 10))).toBe(false);
  });

  test("still requires the y-coordinate from the wallet's own ladder", () => {
    const ownLadder = {
      ...argentxAccount,
      derivation: { accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" as const },
    };
    // Same record shape without a publicKeyY is valid only as argentx.
    expect(isVaultV11(vaultOf(ownLadder, 11))).toBe(false);
    expect(isVaultV11(vaultOf({ ...ownLadder, publicKeyY: "0xdef" }, 11))).toBe(true);
  });
});

describe("migration v10 -> v11", () => {
  test("rewrites nothing but the version stamp", () => {
    const argent = {
      ...argentxAccount,
      derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
      publicKeyY: "0xdef",
    };
    const v10 = vaultOf(argent, 10);
    expect(isVaultV10(v10)).toBe(true);
    const migrated: unknown = migrateVault(v10);
    expect(migrated).toEqual({ ...v10, schemaVersion: 12, shadowAccountScopes: [] });
  });
});
