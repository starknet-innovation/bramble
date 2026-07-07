/**
 * Migration checks prove vault schemas move deterministically or fail closed.
 */
import { describe, expect, test } from "bun:test";
import { CURRENT_SCHEMA_VERSION, migrateVault, VAULT_MIGRATIONS } from "../src/storage/migrations";
import { isVaultV1, isVaultV2 } from "../src/storage/vault-schema";

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

const currentVault = { ...legacyVault, mnemonic: null, schemaVersion: 2 as const };

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

  test("upgrades schema-v1 vaults by adding a null recovery phrase", () => {
    expect(isVaultV1(legacyVault)).toBe(true);
    const migrated = migrateVault(legacyVault);

    expect(isVaultV2(migrated)).toBe(true);
    expect(migrated).toEqual({ ...legacyVault, mnemonic: null, schemaVersion: 2 });
    expect(migrated).not.toBe(legacyVault);
  });

  test("returns valid current vaults for every supported source shape", () => {
    for (const source of [undefined, null, {}, legacyVault, currentVault]) {
      const migrated = migrateVault(source);
      expect(isVaultV2(migrated)).toBe(true);
      expect(migrateVault(migrated)).toBe(migrated);
    }
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
