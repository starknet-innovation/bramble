/**
 * Archive-and-clear checks for the vault reinitialize route (#456). The archive
 * must preserve a decryptable copy of the encrypted vault and remove the live
 * one, and it must never remove the live vault unless the copy is proven.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  createEncryptedStore,
  decryptJson,
  isEncryptedEnvelope,
} from "@bramble/vault/encrypted-store";

const PASSPHRASE = "correct horse battery staple";
const VAULT_KEY = "bramble:vault";
const ARCHIVE_KEY = "bramble:vault-archive";
const VAULT_SCOPE = `bramble:encrypted-store:${VAULT_KEY}`;

const VAULT = {
  accounts: [],
  activeAccountId: null,
  originGrants: [],
  schemaVersion: 1,
  signingKeys: [],
};

describe("EncryptedStore.archiveTo", () => {
  test("keeps a decryptable copy and clears the live vault", async () => {
    const store = createMemoryStore();
    const archive = createMemoryStore();
    const encrypted = createEncryptedStore(store, VAULT_KEY);
    await encrypted.write(VAULT, PASSPHRASE);

    await expect(encrypted.archiveTo(archive, ARCHIVE_KEY)).resolves.toBe(true);

    // The live copy is gone: the next start is first-run.
    expect(await encrypted.exists()).toBe(false);
    expect(await store.get(VAULT_KEY)).toBeUndefined();

    // The archive holds the real envelope, recoverable only offline with the
    // passphrase and the original scope.
    const envelope = await archive.get(ARCHIVE_KEY);
    expect(isEncryptedEnvelope(envelope)).toBe(true);
    if (!isEncryptedEnvelope(envelope)) {
      throw new Error("archive did not hold an envelope");
    }
    await expect(decryptJson(envelope, PASSPHRASE, VAULT_SCOPE)).resolves.toEqual(VAULT);
  });

  test("resolves false when there is nothing to archive", async () => {
    const encrypted = createEncryptedStore(createMemoryStore(), VAULT_KEY);
    await expect(encrypted.archiveTo(createMemoryStore(), ARCHIVE_KEY)).resolves.toBe(false);
  });

  test("an archived envelope cannot be mounted as a live store", async () => {
    const store = createMemoryStore();
    const archive = createMemoryStore();
    const encrypted = createEncryptedStore(store, VAULT_KEY);
    await encrypted.write(VAULT, PASSPHRASE);
    await encrypted.archiveTo(archive, ARCHIVE_KEY);

    // Put the archived blob back at the live key without its freshness record,
    // which is what a blind restore would do. The store must refuse it rather
    // than serve an unverifiable vault.
    await store.set(VAULT_KEY, (await archive.get(ARCHIVE_KEY)) as Json);
    const restored = createEncryptedStore(store, VAULT_KEY);
    await expect(restored.read(PASSPHRASE)).rejects.toThrow("Encrypted store commit state missing");
  });

  test("a failed archive write leaves the live vault intact", async () => {
    const store = createMemoryStore();
    const failing: KeyValueStore = {
      get: (key) => store.get(key),
      remove: (key) => store.remove(key),
      set: async () => {
        throw new Error("archive storage unavailable");
      },
    };
    const encrypted = createEncryptedStore(store, VAULT_KEY);
    await encrypted.write(VAULT, PASSPHRASE);

    await expect(encrypted.archiveTo(failing, ARCHIVE_KEY)).rejects.toThrow(
      "archive storage unavailable",
    );
    // Nothing was removed, so the user is still locked but not bricked.
    expect(await encrypted.exists()).toBe(true);
    await expect(encrypted.read(PASSPHRASE)).resolves.toEqual(VAULT);
  });
});
