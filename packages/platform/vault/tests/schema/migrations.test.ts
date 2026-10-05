/**
 * Migration checks prove vault schemas move deterministically or fail closed.
 */
import { describe, expect, test } from "bun:test";
import { ARGENT_ACCOUNT_CONTRACT } from "@bramble/starknet/account-contracts";
import { CURRENT_SCHEMA_VERSION, migrateVault, VAULT_MIGRATIONS } from "@bramble/vault/migrations";
import {
  isVaultV1,
  isVaultV6,
  isVaultV7,
  isVaultV8,
  isVaultV9,
  isVaultV11,
} from "@bramble/vault/schema";
import { deploymentClasses } from "@bramble/wallet-model/account-families";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { canonicalFelt } from "@bramble/wallet-model/networks";

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
const legacyV7 = {
  ...legacyV6,
  accounts: legacyV6.accounts,
  schemaVersion: 7 as const,
};
const currentVault = {
  ...legacyV7,
  importedSeeds: [],
  schemaVersion: CURRENT_SCHEMA_VERSION as 11,
};

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
      importedSeeds: [],
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

    expect(isVaultV11(migrated)).toBe(true);
    expect(migrated).toEqual({
      ...legacyVault,
      accounts: legacyVault.accounts.map((account) => ({
        accountContractType: "openzeppelin",
        ...account,
      })),
      accountSecrets: [],
      importedSeeds: [],
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
      legacyV7,
      currentVault,
    ]) {
      const migrated = migrateVault(source);
      expect(isVaultV11(migrated)).toBe(true);
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

    expect(isVaultV11(migrated)).toBe(true);
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
    expect(isVaultV11(migrated)).toBe(true);
    expect(migrated.accounts[0]).toMatchObject({ deploymentSalt: argent.publicKeyX });

    // The adjacent v7→v8 step retains the founding phrase and every account,
    // adding only the empty imported-seeds collection; v8→v9 then re-stamps.
    const fromV7 = migrateVault(legacyV7);
    expect(isVaultV7(legacyV7)).toBe(true);
    expect(isVaultV11(fromV7)).toBe(true);
    expect(fromV7).toEqual({ ...legacyV7, importedSeeds: [], schemaVersion: 11 });
  });

  test("refuses a schema-v6 vault that claims an Argent class that era never wrote", () => {
    // v6 writers only stored the pinned Argent class. A 0.3.x class is a
    // current-era record; accepting it here would migrate a vault v6 could
    // not have written.
    const earlier = deploymentClasses("argent").find((entry) => entry.label === "argent 0.3.0");
    if (!earlier) throw new Error("argent 0.3.0 missing from the class table");
    const historical = {
      ...legacyV6.accounts[0],
      accountContractType: "argent" as const,
      classHash: canonicalFelt(earlier.classHash),
    };
    const claimed = { ...legacyV6, accounts: [historical], activeAccountId: historical.id };
    expect(isVaultV6(claimed)).toBe(false);
    expect(() => migrateVault(claimed)).toThrow("Unsupported vault schema");
  });

  test("v9 admits Ready's Ledger path scheme; v8 and earlier stay pinned to LedgerW", () => {
    const ledgerAt = (index: number, application: "LedgerW" | "argentx") => {
      const address = "0xdef123";
      return {
        accountContractType: "openzeppelin" as const,
        address,
        classHash: "0x111111",
        derivation: {
          accountIndex: index,
          eip2645application: application,
          kind: "ledger" as const,
          path: ledgerAccountPath(index, application),
        },
        id: `SN_MAIN:${address}`,
        networkId: "SN_MAIN" as const,
        publicKeyX: "0xabc",
      };
    };
    const ledgerVaultV8 = (application: "LedgerW" | "argentx") => {
      const account = ledgerAt(12, application);
      return {
        accounts: [account],
        accountSecrets: [],
        activeAccountId: account.id,
        importedSeeds: [],
        mnemonic: null,
        originGrants: [],
        schemaVersion: 8 as const,
        signingKeys: [],
      };
    };

    // The v8→v9 and v9→v10 steps each rewrite nothing but the version stamp.
    const bramble = ledgerVaultV8("LedgerW");
    expect(isVaultV8(bramble)).toBe(true);
    expect(migrateVault(bramble)).toEqual({ ...bramble, schemaVersion: 11 });
    expect(isVaultV9({ ...bramble, schemaVersion: 9 })).toBe(true);

    // A v8 payload could never have held a Ready-path account: the legacy
    // validators refuse it, so the migration fails closed instead of admitting
    // a representation those schemas never defined. The same record is valid
    // once stamped v9.
    const ready = ledgerVaultV8("argentx");
    expect(isVaultV8(ready)).toBe(false);
    expect(() => migrateVault(ready)).toThrow("Unsupported vault schema");
    const { importedSeeds: _, ...readyV7 } = { ...ready, schemaVersion: 7 as const };
    expect(isVaultV7(readyV7)).toBe(false);
    expect(isVaultV9({ ...ready, schemaVersion: 9 })).toBe(true);
    expect(isVaultV9({ ...bramble, schemaVersion: 9 })).toBe(true);
    // Stamping a Ready-path record with any earlier version is still refused.
    expect(() => migrateVault({ ...ready, schemaVersion: 3 })).toThrow("Unsupported vault schema");
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
        importedSeeds: [],
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
