/**
 * Migration checks prove vault schemas move deterministically or fail closed.
 */
import { describe, expect, test } from "bun:test";
import { ARGENT_ACCOUNT_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import {
  CURRENT_SCHEMA_VERSION,
  migrateVault,
  VAULT_MIGRATIONS,
} from "@mc-wallet/vault/migrations";
import { isVaultV1, isVaultV6, isVaultV8 } from "@mc-wallet/vault/schema";
import { canonicalFelt } from "@mc-wallet/wallet-model/networks";

const legacyVault = {
  accounts: [
    {
      address: "0x123",
      classHash: "0xabc",
      derivation: {
        accountIndex: 0,
        addressIndex: 0,
        kind: "starknet-bip44" as const,
      },
      id: "SN_SEPOLIA:0x123",
      networkId: "SN_SEPOLIA" as const,
      publicKeyX: "0xabc",
      publicKeyY: "0xdef",
    },
  ],
  activeAccountId: "SN_SEPOLIA:0x123",
  originGrants: [
    {
      accountIds: ["SN_SEPOLIA:0x123"],
      origin: "https://example.com",
    },
  ],
  schemaVersion: 1 as const,
  signingKeys: [
    {
      accountId: "SN_SEPOLIA:0x123",
      privateKey: "0x456",
    },
  ],
};

const legacyV3 = { ...legacyVault, mnemonic: null, schemaVersion: 3 as const };
const legacyV4 = { ...legacyV3, accountSecrets: [], schemaVersion: 4 as const };
const legacyV5 = { ...legacyV4, schemaVersion: 5 as const };
const legacyV6 = {
  ...legacyV5,
  accounts: legacyV5.accounts.map((account) => ({
    accountContractType: "openzeppelin" as const,
    ...account,
  })),
  schemaVersion: 6 as const,
};
const currentVault = { ...legacyV6, schemaVersion: CURRENT_SCHEMA_VERSION as 8 };

describe("migrateVault", () => {
  test("declares contiguous migration steps to the current schema", () => {
    for (const [index, migration] of VAULT_MIGRATIONS.entries()) {
      expect(migration.fromVersion).toBe(index);
      expect(migration.toVersion).toBe(index + 1);
    }
    expect(VAULT_MIGRATIONS.at(-1)?.toVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  test("creates an empty current vault for missing data", () => {
    expect(migrateVault(undefined)).toEqual({
      accounts: [],
      accountSecrets: [],
      activeAccountId: null,
      mnemonic: null,
      originGrants: [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      signingKeys: [],
    });
  });

  test("keeps current vaults unchanged", () => {
    expect(migrateVault(currentVault)).toBe(currentVault);
  });

  test("upgrades schema-v1 vaults through the chain to the current schema", () => {
    expect(isVaultV1(legacyVault)).toBe(true);
    const migrated = migrateVault(legacyVault);

    expect(isVaultV8(migrated)).toBe(true);
    expect(migrated).toEqual({
      ...legacyVault,
      accounts: legacyVault.accounts.map((account) => ({
        accountContractType: "openzeppelin",
        ...account,
      })),
      accountSecrets: [],
      mnemonic: null,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    expect(migrated).not.toBe(legacyVault);
  });

  test("returns valid current vaults for every supported source shape", () => {
    for (const source of [
      undefined,
      null,
      {},
      legacyVault,
      legacyV3,
      legacyV4,
      legacyV5,
      legacyV6,
      currentVault,
    ]) {
      const migrated = migrateVault(source);
      expect(isVaultV8(migrated)).toBe(true);
      expect(migrateVault(migrated)).toBe(migrated);
    }
  });

  test("canonicalizes schema-v4 account aliases and every dependent reference", () => {
    const aliasedId = "SN_SEPOLIA:0x0123";
    const migrated = migrateVault({
      ...legacyV4,
      accounts: [
        {
          ...legacyV4.accounts[0],
          address: "0x0123",
          classHash: "0x0abc",
          id: aliasedId,
          publicKeyX: "0x0abc",
          publicKeyY: "0x0def",
        },
      ],
      activeAccountId: aliasedId,
      originGrants: [{ accountIds: [aliasedId], origin: "https://example.com" }],
      signingKeys: [{ accountId: aliasedId, privateKey: "0x0456" }],
    });

    expect(isVaultV8(migrated)).toBe(true);
    expect(migrated.accounts[0]).toMatchObject({
      accountContractType: "openzeppelin",
      address: "0x123",
      classHash: "0xabc",
      id: "SN_SEPOLIA:0x123",
      publicKeyX: "0xabc",
      publicKeyY: "0xdef",
    });
    expect(migrated.activeAccountId).toBe("SN_SEPOLIA:0x123");
    expect(migrated.originGrants[0]?.accountIds).toEqual(["SN_SEPOLIA:0x123"]);
    expect(migrated.signingKeys[0]).toEqual({
      accountId: "SN_SEPOLIA:0x123",
      privateKey: "0x456",
    });
  });

  test("retains the historical public-key salt when migrating Argent schema-v6 accounts", () => {
    const argent = {
      ...legacyV6.accounts[0],
      accountContractType: "argent" as const,
      classHash: canonicalFelt(ARGENT_ACCOUNT_CONTRACT.classHash),
    };
    const migrated = migrateVault({
      ...legacyV6,
      accounts: [argent],
      activeAccountId: argent.id,
    });

    expect(isVaultV6({ ...legacyV6, accounts: [argent] })).toBe(true);
    expect(isVaultV8(migrated)).toBe(true);
    expect(migrated.accounts[0]).toMatchObject({ deploymentSalt: argent.publicKeyX });
  });

  test("ignores inherited schema versions for legacy empty vaults", () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "schemaVersion");
    Object.defineProperty(Object.prototype, "schemaVersion", {
      configurable: true,
      enumerable: true,
      value: 999,
    });

    try {
      expect(migrateVault({})).toEqual({
        accounts: [],
        accountSecrets: [],
        activeAccountId: null,
        mnemonic: null,
        originGrants: [],
        schemaVersion: CURRENT_SCHEMA_VERSION,
        signingKeys: [],
      });
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(Object.prototype, "schemaVersion", previousDescriptor);
      } else {
        Reflect.deleteProperty(Object.prototype, "schemaVersion");
      }
    }
  });

  test("rejects unknown schemas", () => {
    expect(() => migrateVault({ schemaVersion: -1 })).toThrow("Unsupported vault schema");
    expect(() => migrateVault({ schemaVersion: 999 })).toThrow("Unsupported vault schema");
  });

  test("rejects malformed legacy data", () => {
    const hiddenLegacy = {};
    Object.defineProperty(hiddenLegacy, "accounts", { value: [] });

    expect(() => migrateVault({ accounts: [], schemaVersion: 0 })).toThrow(
      "Unsupported vault schema",
    );
    expect(() => migrateVault(hiddenLegacy)).toThrow("Unsupported vault schema");
  });
});
