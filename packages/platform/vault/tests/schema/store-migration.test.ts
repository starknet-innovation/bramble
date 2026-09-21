/**
 * Encrypted vault update lifecycle: first-unlock persistence, staged commit,
 * interrupted-write recovery, idempotence, and fail-closed source validation.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { createEncryptedStore, type EncryptedStore } from "@bramble/vault/encrypted-store";
import { migrateVault } from "@bramble/vault/migrations";
import { isVaultV9 } from "@bramble/vault/schema";
import {
  readMigratedVault,
  VAULT_MIGRATION_STORE_KEY,
  VAULT_STORE_KEY,
} from "@bramble/vault/store-migration";

const vaultPassphrase = "correct horse battery staple";
const account = {
  address: "0x123",
  classHash: "0xabc",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN" as const,
  publicKeyX: "0x456",
  publicKeyY: "0x789",
};
const legacyV3 = {
  accounts: [account],
  activeAccountId: account.id,
  mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
  originGrants: [],
  schemaVersion: 3 as const,
  signingKeys: [{ accountId: account.id, privateKey: "0x654321" }],
};

const stores = () => {
  const backend = createMemoryStore();
  return {
    backend,
    primary: createEncryptedStore(backend, VAULT_STORE_KEY),
    staging: createEncryptedStore(backend, VAULT_MIGRATION_STORE_KEY),
  };
};

describe("readMigratedVault", () => {
  test("durably migrates schema v3 through a verified encrypted staging write", async () => {
    const { backend, primary, staging } = stores();
    await primary.write(legacyV3, vaultPassphrase);

    const migrated = await readMigratedVault({ primary, staging }, vaultPassphrase);

    expect(isVaultV9(migrated)).toBe(true);
    expect(migrated.accountSecrets).toEqual([]);
    expect(await primary.read(vaultPassphrase)).toEqual(migrated);
    expect(await staging.exists()).toBe(false);
    const raw = JSON.stringify(await backend.get(VAULT_STORE_KEY));
    expect(raw).not.toContain(legacyV3.mnemonic);
    expect(raw).not.toContain("0x654321");
  });

  test("keeps invalid legacy ciphertext unchanged and never creates staging output", async () => {
    const { backend, primary, staging } = stores();
    await primary.write({ ...legacyV3, accounts: [] }, vaultPassphrase);
    const before = await backend.get(VAULT_STORE_KEY);

    await expect(readMigratedVault({ primary, staging }, vaultPassphrase)).rejects.toThrow(
      "Unsupported vault schema",
    );
    expect(await backend.get(VAULT_STORE_KEY)).toEqual(before);
    expect(await staging.exists()).toBe(false);
  });

  test("recovers an authenticated staged vault when the primary commit is unreadable", async () => {
    const { backend, primary, staging } = stores();
    const current = migrateVault(legacyV3);
    await staging.write(current, vaultPassphrase);
    await backend.set(VAULT_STORE_KEY, { corrupted: true });

    await expect(readMigratedVault({ primary, staging }, vaultPassphrase)).resolves.toEqual(
      current,
    );
    expect(await primary.read(vaultPassphrase)).toEqual(current);
    expect(await staging.exists()).toBe(false);
  });

  test("leaves a current primary envelope byte-for-byte unchanged", async () => {
    const { backend, primary, staging } = stores();
    const current = migrateVault(legacyV3);
    await primary.write(current, vaultPassphrase);
    const before = await backend.get(VAULT_STORE_KEY);

    await expect(readMigratedVault({ primary, staging }, vaultPassphrase)).resolves.toBeDefined();
    expect(await backend.get(VAULT_STORE_KEY)).toEqual(before);
  });

  test("keeps a current primary authoritative and removes a stale authenticated stage", async () => {
    const { backend, primary, staging } = stores();
    const current = migrateVault(legacyV3);
    await primary.write(current, vaultPassphrase);
    await staging.write({ ...current, activeAccountId: null }, vaultPassphrase);
    const before = await backend.get(VAULT_STORE_KEY);

    await expect(readMigratedVault({ primary, staging }, vaultPassphrase)).resolves.toEqual(
      current,
    );
    expect(await backend.get(VAULT_STORE_KEY)).toEqual(before);
    expect(await staging.exists()).toBe(false);
  });

  test("fails closed when migration staging cleanup is a silent no-op", async () => {
    const { primary, staging } = stores();
    const current = migrateVault(legacyV3);
    await primary.write(current, vaultPassphrase);
    await staging.write({ ...current, activeAccountId: null }, vaultPassphrase);
    const stickyStage: EncryptedStore = {
      ...staging,
      async remove() {},
    };

    await expect(
      readMigratedVault({ primary, staging: stickyStage }, vaultPassphrase),
    ).rejects.toThrow("Vault migration cleanup failed");
    expect(await primary.read(vaultPassphrase)).toEqual(current);
    expect(await staging.exists()).toBe(true);

    await expect(readMigratedVault({ primary, staging }, vaultPassphrase)).resolves.toEqual(
      current,
    );
    expect(await staging.exists()).toBe(false);
  });

  test("never touches the primary when staged verification fails", async () => {
    const { backend, primary, staging } = stores();
    await primary.write(legacyV3, vaultPassphrase);
    const before = await backend.get(VAULT_STORE_KEY);
    const unreadableStage: EncryptedStore = {
      ...staging,
      async read() {
        throw new Error("injected staging verification failure");
      },
    };

    await expect(
      readMigratedVault({ primary, staging: unreadableStage }, vaultPassphrase),
    ).rejects.toThrow("injected staging verification failure");
    expect(await backend.get(VAULT_STORE_KEY)).toEqual(before);
    expect(await staging.exists()).toBe(true);
  });

  test("retains the old primary and verified stage when the primary write fails", async () => {
    const { backend, primary, staging } = stores();
    await primary.write(legacyV3, vaultPassphrase);
    const before = await backend.get(VAULT_STORE_KEY);
    const unwritablePrimary: EncryptedStore = {
      ...primary,
      async write() {
        throw new Error("injected primary write failure");
      },
    };

    await expect(
      readMigratedVault({ primary: unwritablePrimary, staging }, vaultPassphrase),
    ).rejects.toThrow("injected primary write failure");
    expect(await backend.get(VAULT_STORE_KEY)).toEqual(before);
    expect(isVaultV9(await staging.read(vaultPassphrase))).toBe(true);

    await expect(readMigratedVault({ primary, staging }, vaultPassphrase)).resolves.toMatchObject({
      schemaVersion: 9,
    });
    expect(await staging.exists()).toBe(false);
  });

  test("does not use an authenticated stage with the wrong passphrase", async () => {
    const { backend, primary, staging } = stores();
    await primary.write(legacyV3, vaultPassphrase);
    await staging.write(migrateVault(legacyV3), vaultPassphrase);
    const before = await backend.get(VAULT_STORE_KEY);

    await expect(
      readMigratedVault({ primary, staging }, "incorrect horse battery staple"),
    ).rejects.toThrow();
    expect(await backend.get(VAULT_STORE_KEY)).toEqual(before);
    expect(await staging.exists()).toBe(true);
  });
});
