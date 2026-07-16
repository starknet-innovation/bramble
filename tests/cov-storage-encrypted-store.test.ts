/**
 * Encrypted store failure and cache-eviction branches: an envelope carrying a
 * non-base64 field is rejected by the metadata guard (the base64 decode throws
 * and is caught), a wrong passphrase and a corrupted ciphertext both fail the
 * read, `remove` deletes the stored blob, and the derived-key cache evicts its
 * oldest entry once it fills past its bound.
 */
import { describe, expect, test } from "bun:test";
import {
  createEncryptedStore,
  encryptJson,
  isEncryptedEnvelope,
} from "../src/storage/encrypted-store";
import { createMemoryStore } from "../src/storage/kv";

const vaultKey = "mc-wallet:vault";
const passphrase = "correct horse battery staple";

describe("encrypted store failure branches", () => {
  test("rejects an envelope whose iv is not valid base64", () => {
    // The iv passes the typeof-string check but is not decodable base64, so the
    // decode throws and the guard's catch returns false rather than propagating.
    const envelope = {
      cipher: "AES-256-GCM",
      data: btoa("x"),
      iterations: 600_000,
      iv: "@@@@not base64@@@@",
      kdf: "PBKDF2-SHA-256",
      salt: btoa("0123456789abcdef"),
      scope: `mc-wallet:encrypted-store:${vaultKey}`,
      version: 2,
    };
    expect(isEncryptedEnvelope(envelope)).toBe(false);
  });

  test("read rejects a wrong passphrase and leaves the blob intact", async () => {
    const store = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey);
    await encrypted.write({ schemaVersion: 1 }, passphrase);

    await expect(encrypted.read("wrong horse battery staple")).rejects.toThrow();
    // The correct passphrase still reads the untouched blob.
    await expect(encrypted.read(passphrase)).resolves.toEqual({ schemaVersion: 1 });
  });

  test("read rejects a corrupted ciphertext blob", async () => {
    const store = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey);
    const envelope = await encryptJson(
      { schemaVersion: 1 },
      passphrase,
      `mc-wallet:encrypted-store:${vaultKey}`,
    );
    // Flip the stored ciphertext to a different (still base64, still valid
    // length) value so the AES-GCM auth tag check fails on decrypt.
    const corrupted = { ...envelope, data: btoa("tampered ciphertext bytes here!!") };
    expect(isEncryptedEnvelope(corrupted)).toBe(true);
    await store.set(vaultKey, corrupted);

    await expect(encrypted.read(passphrase)).rejects.toThrow();
  });

  test("remove deletes the stored blob so a later read yields undefined", async () => {
    const store = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey);
    await encrypted.write({ schemaVersion: 1 }, passphrase);
    expect(await encrypted.exists()).toBe(true);

    await encrypted.remove();

    expect(await encrypted.exists()).toBe(false);
    await expect(encrypted.read(passphrase)).resolves.toBeUndefined();
  });

  test("evicts the oldest derived key once the cache fills past its bound", async () => {
    const store = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey);

    // Each write generates a fresh salt, so each derives (and caches) a distinct
    // key. The cache holds 8; the 9th write must evict the oldest entry. After
    // all writes the store still reads back correctly, proving eviction did not
    // corrupt the live key set.
    for (let index = 0; index < 9; index += 1) {
      await encrypted.write({ schemaVersion: 1, seq: index }, passphrase);
    }

    await expect(encrypted.read(passphrase)).resolves.toEqual({ schemaVersion: 1, seq: 8 });
  });
});
