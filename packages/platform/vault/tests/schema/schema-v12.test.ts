/**
 * Schema v12: encrypted shadow-account scope records (#443, PR 5).
 *
 * Old data: a v11 vault migrates to an empty collection and nothing else
 * changes. Current data: well-formed, canonical records bound to a retained
 * account on its own chain validate. Invalid data: every malformed, dangling,
 * duplicated, unsorted, or over-bound record makes the whole vault fail
 * closed, like any other corrupt vault content.
 */
import { describe, expect, test } from "bun:test";
import { migrateVault, VAULT_MIGRATIONS } from "@bramble/vault/migrations";
import { CURRENT_SCHEMA_VERSION, isVaultV11, isVaultV12 } from "@bramble/vault/schema";
import {
  MAX_SHADOW_ACCOUNT_NONCES,
  MAX_SHADOW_ACCOUNT_SCOPES,
  type ShadowAccountScopeRef,
} from "@bramble/vault/shadow-account-scopes";
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

const v11 = {
  accounts: [account],
  accountSecrets: [],
  activeAccountId: account.id,
  importedSeeds: [],
  mnemonic: null,
  originGrants: [],
  schemaVersion: 11,
  signingKeys: [{ accountId: account.id, privateKey: "0x456" }],
};

const scope: ShadowAccountScopeRef = {
  accountId: account.id,
  anonymizer: "0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7",
  chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
  label: "Market",
  nonces: ["0x0", "0x2", "0x10"],
  origin: "https://app.example",
  poolAddress: "0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
};

const v12 = (shadowAccountScopes: readonly unknown[]) => ({
  ...v11,
  schemaVersion: 12,
  shadowAccountScopes,
});

describe("schema v12 (current)", () => {
  test("is the current version, reached by exactly one adjacent step", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(12);
    const step = VAULT_MIGRATIONS.at(-1);
    expect(step).toMatchObject({ fromVersion: 11, toVersion: 12 });
  });

  test("old: a v11 vault migrates to an empty scope collection and nothing else", () => {
    expect(isVaultV11(v11)).toBe(true);
    expect(migrateVault(v11) as unknown).toEqual(v12([]));
    // Deterministic: migrating twice from the same input gives the same vault.
    expect(migrateVault(structuredClone(v11))).toEqual(migrateVault(v11));
    // A v11 vault cannot already hold the v12 collection.
    expect(isVaultV11({ ...v11, shadowAccountScopes: [] })).toBe(false);
  });

  test("current: canonical records bound to the account's own chain validate", () => {
    expect(isVaultV12(v12([]))).toBe(true);
    expect(isVaultV12(v12([scope]))).toBe(true);
    expect(isVaultV12(v12([scope, { ...scope, label: "Other", nonces: [] }]))).toBe(true);
    expect(migrateVault(v12([scope])) as unknown).toEqual(v12([scope]));
  });

  test("current: a v12 vault without the collection is refused", () => {
    const { shadowAccountScopes: _scopes, ...missing } = v12([]);
    expect(isVaultV12(missing)).toBe(false);
    expect(() => migrateVault(missing)).toThrow("Unsupported vault schema");
  });

  const invalid: readonly (readonly [string, unknown])[] = [
    ["a dangling account", { ...scope, accountId: "SN_MAIN:0x999" }],
    ["another network's chain", { ...scope, chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId }],
    ["a non-canonical anonymizer", { ...scope, anonymizer: "0x04f33230" }],
    ["a zero anonymizer", { ...scope, anonymizer: "0x0" }],
    ["a non-canonical pool", { ...scope, poolAddress: "0x0040337b" }],
    ["an uppercase nonce", { ...scope, nonces: ["0xA"] }],
    ["unsorted nonces", { ...scope, nonces: ["0x2", "0x0"] }],
    ["a repeated nonce", { ...scope, nonces: ["0x2", "0x2"] }],
    ["a nonce outside the field", { ...scope, nonces: [`0x${"f".repeat(64)}`] }],
    ["an invalid origin", { ...scope, origin: "http://app.example" }],
    ["an origin with a path", { ...scope, origin: "https://app.example/x" }],
    ["an empty label", { ...scope, label: "" }],
    ["a non-ASCII label", { ...scope, label: "Märkt" }],
    ["an unknown key", { ...scope, extra: true }],
    ["a missing key", { ...scope, nonces: undefined }],
    [
      "too many nonces",
      {
        ...scope,
        nonces: Array.from(
          { length: MAX_SHADOW_ACCOUNT_NONCES + 1 },
          (_, i) => `0x${i.toString(16)}`,
        ),
      },
    ],
  ];
  for (const [name, record] of invalid) {
    test(`invalid: ${name} fails the whole vault closed`, () => {
      expect(isVaultV12(v12([record]))).toBe(false);
      expect(() => migrateVault(v12([record]))).toThrow("Unsupported vault schema");
    });
  }

  test("invalid: a duplicated scope or a collection past the bound is refused", () => {
    expect(isVaultV12(v12([scope, { ...scope, nonces: [] }]))).toBe(false);
    const many = Array.from({ length: MAX_SHADOW_ACCOUNT_SCOPES + 1 }, (_, index) => ({
      ...scope,
      label: `Site ${index}`,
    }));
    expect(isVaultV12(v12(many.slice(0, MAX_SHADOW_ACCOUNT_SCOPES)))).toBe(true);
    expect(isVaultV12(v12(many))).toBe(false);
    expect(isVaultV12({ ...v12([]), shadowAccountScopes: "none" })).toBe(false);
  });
});
