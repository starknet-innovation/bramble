/**
 * Schema v10: Braavos accounts, and Argent accounts at any release they could
 * have been deployed with.
 *
 * The bump exists because both are values a v9 build cannot validate. So the
 * invariants worth pinning are the boundaries between eras: v10 admits them, v9
 * refuses them exactly as it always did, and the adjacent migration touches
 * nothing but the version stamp — which is what makes an older build meeting a
 * v10 vault refuse it rather than misread records it cannot check.
 */
import { describe, expect, test } from "bun:test";
import { migrateVault } from "@bramble/vault/migrations";
import { CURRENT_SCHEMA_VERSION, isVaultV9, isVaultV10 } from "@bramble/vault/schema";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_BASE_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import { canonicalFelt } from "@bramble/wallet-model/networks";

// Stored records carry canonical felts; the class table publishes zero-padded
// hashes exactly as Krusty does, and the vault canonicalizes before writing.
const canonical = (hash: string): string => canonicalFelt(hash) ?? hash;

const PUBLIC_KEY = "0xabc";

const base = {
  address: "0x123",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_SEPOLIA:0x123",
  networkId: "SN_SEPOLIA",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0xdef",
};

const vaultOf = (account: Record<string, unknown>, schemaVersion: number) => ({
  accounts: [account],
  accountSecrets: [],
  activeAccountId: base.id,
  importedSeeds: [],
  mnemonic: null,
  originGrants: [{ accountIds: [base.id], origin: "https://example.com" }],
  schemaVersion,
  signingKeys: [{ accountId: base.id, privateKey: "0x456" }],
});

const argentAt = (classHash: string) => ({
  ...base,
  accountContractType: "argent",
  classHash: canonical(classHash),
  deploymentSalt: PUBLIC_KEY,
});

const braavosAt = (classHash: string) => ({
  ...base,
  accountContractType: "braavos",
  classHash: canonical(classHash),
  deploymentSalt: PUBLIC_KEY,
});

const argentRelease = (label: string): string => {
  const entry = deploymentClasses("argent").find((candidate) => candidate.label === label);
  if (!entry) {
    throw new Error(`${label} missing from the class table`);
  }
  return entry.classHash;
};

const BRAAVOS_CURRENT_IMPLEMENTATION =
  "0x3957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a";

describe("schema v10 (one step below current)", () => {
  test("sits one step below the current version", () => {
    // v11 added the Ready-scheme derivation kind on top of this file's shapes.
    expect(CURRENT_SCHEMA_VERSION).toBe(11);
  });

  test("admits Argent at every release an account could have been deployed with", () => {
    for (const label of ["argent 0.3.0", "argent 0.3.1", "argent 0.4.0"]) {
      expect(isVaultV10(vaultOf(argentAt(argentRelease(label)), 10))).toBe(true);
    }
  });

  test("admits Braavos at each class a Braavos account is deployed with", () => {
    expect(isVaultV10(vaultOf(braavosAt(BRAAVOS_BASE_CLASS_HASH), 10))).toBe(true);
    for (const entry of deploymentClasses("braavos")) {
      expect(isVaultV10(vaultOf(braavosAt(entry.classHash), 10))).toBe(true);
    }
  });

  test("refuses a class no account could have been deployed with", () => {
    // The stored class is the one the address derives from. An implementation
    // an account only upgraded INTO never fixed any address, so storing it
    // beside one would describe an account that cannot exist.
    expect(isVaultV10(vaultOf(braavosAt(BRAAVOS_CURRENT_IMPLEMENTATION), 10))).toBe(false);
    expect(isVaultV10(vaultOf(argentAt("0x123"), 10))).toBe(false);
    expect(isVaultV10(vaultOf(braavosAt("0x123"), 10))).toBe(false);
  });

  test("refuses a family's class claimed by another family", () => {
    expect(isVaultV10(vaultOf(braavosAt(ARGENT_ACCOUNT_CLASS_HASH), 10))).toBe(false);
    expect(isVaultV10(vaultOf(argentAt(BRAAVOS_BASE_CLASS_HASH), 10))).toBe(false);
  });

  test("requires the salt a Braavos address derives from", () => {
    const { deploymentSalt: _, ...unsalted } = braavosAt(BRAAVOS_BASE_CLASS_HASH);
    expect(isVaultV10(vaultOf(unsalted, 10))).toBe(false);
  });
});

describe("schema v9 (legacy)", () => {
  test("still refuses Braavos, which no v9 writer produced", () => {
    expect(isVaultV9(vaultOf(braavosAt(BRAAVOS_BASE_CLASS_HASH), 9))).toBe(false);
  });

  test("still pins Argent to the release this wallet creates", () => {
    expect(isVaultV9(vaultOf(argentAt(ARGENT_ACCOUNT_CLASS_HASH), 9))).toBe(true);
    expect(isVaultV9(vaultOf(argentAt(argentRelease("argent 0.3.0")), 9))).toBe(false);
  });
});

describe("migration v9 -> v10", () => {
  test("rewrites nothing but the version stamp", () => {
    const v9 = vaultOf(argentAt(ARGENT_ACCOUNT_CLASS_HASH), 9);
    const migrated: unknown = migrateVault(v9);
    expect(migrated).toEqual({ ...v9, schemaVersion: 11 });
  });

  test("refuses a v9 vault claiming a record only v10 can hold", () => {
    // A v9 stamp on a Braavos record is corrupt, not new: migrating it forward
    // would launder an unvalidated record into a current vault.
    expect(() => migrateVault(vaultOf(braavosAt(BRAAVOS_BASE_CLASS_HASH), 9))).toThrow(
      "Unsupported vault schema",
    );
  });
});
