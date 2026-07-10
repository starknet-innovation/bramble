/**
 * Encrypted store checks cover round trips and wrong-passphrase failure.
 */
import { describe, expect, test } from "bun:test";
import {
  createEncryptedStore,
  decryptJson,
  encryptJson,
  isEncryptedEnvelope,
  isVaultPassphrase,
} from "../src/storage/encrypted-store";
import { createMemoryStore } from "../src/storage/kv";

const vaultKey = "mc-wallet:vault";
const preferencesKey = "mc-wallet:preferences";

describe("createEncryptedStore", () => {
  test("validates vault passphrase length", () => {
    expect(isVaultPassphrase("correct horse battery staple")).toBe(true);
    expect(isVaultPassphrase("            ")).toBe(false);
    expect(isVaultPassphrase("too short")).toBe(false);
  });

  test("gates the onboarding submit at the 12-character boundary", () => {
    // The create-wallet form gates on this predicate so the backend invariant
    // never throws with an unsurfaced error; 11 chars is rejected, 12 accepted.
    expect(isVaultPassphrase("a".repeat(11))).toBe(false);
    expect(isVaultPassphrase("a".repeat(12))).toBe(true);
    expect(isVaultPassphrase(`  ${"a".repeat(10)}  `)).toBe(false);
    expect(isVaultPassphrase(42)).toBe(false);
    expect(isVaultPassphrase(undefined)).toBe(false);
  });

  test("requires explicit encryption scopes", async () => {
    await expect(encryptJson({ ok: true }, "correct horse battery staple", "")).rejects.toThrow(
      "Encrypted store scope is required",
    );

    const envelope = await encryptJson(
      { ok: true },
      "correct horse battery staple",
      "mc-wallet:test",
    );
    await expect(
      decryptJson(envelope, "correct horse battery staple", "mc-wallet:other"),
    ).rejects.toThrow("Invalid encrypted store envelope");
  });

  test("rejects lossy JSON values before encryption", async () => {
    await expect(
      encryptJson({ amount: Number.NaN }, "correct horse battery staple", "mc-wallet:test"),
    ).rejects.toThrow("Invalid JSON value");
  });

  test("requires namespaced storage keys", () => {
    expect(() => createEncryptedStore(createMemoryStore(), "vault")).toThrow(
      "Storage key must be namespaced",
    );
  });

  test("encrypts and decrypts JSON values", async () => {
    const store = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey);
    const vault = {
      accounts: [],
      activeAccountId: null,
      originGrants: [],
      schemaVersion: 1,
      signingKeys: [],
    };

    await encrypted.write(vault, "correct horse battery staple");

    const raw = await store.get(vaultKey);
    expect(JSON.stringify(raw)).not.toContain("accounts");
    await expect(encrypted.read("correct horse battery staple")).resolves.toEqual(vault);
  });

  test("rejects the wrong passphrase", async () => {
    const encrypted = createEncryptedStore(createMemoryStore(), vaultKey);

    await encrypted.write({ schemaVersion: 1 }, "correct horse battery staple");

    await expect(encrypted.read("wrong horse battery staple")).rejects.toThrow();
  });

  test("derives the key once per unlock and re-derives after clearKeys", async () => {
    const encrypted = createEncryptedStore(createMemoryStore(), vaultKey);
    await encrypted.write({ schemaVersion: 1 }, "correct horse battery staple");
    // Drop the key the write just cached so counting starts from a cold cache.
    encrypted.clearKeys();

    // Count the expensive PBKDF2 derivations across repeated reads.
    const subtle = crypto.subtle as unknown as {
      deriveKey: (...args: unknown[]) => Promise<CryptoKey>;
    };
    const original = subtle.deriveKey.bind(crypto.subtle);
    let derivations = 0;
    subtle.deriveKey = ((...args: unknown[]) => {
      derivations += 1;
      return original(...args);
    }) as typeof subtle.deriveKey;

    try {
      await expect(encrypted.read("correct horse battery staple")).resolves.toEqual({
        schemaVersion: 1,
      });
      await encrypted.read("correct horse battery staple");
      await encrypted.read("correct horse battery staple");
      expect(derivations).toBe(1);

      // A wrong passphrase must not collide onto the cached key.
      await expect(encrypted.read("wrong horse battery staple")).rejects.toThrow();
      expect(derivations).toBe(2);

      // Locking drops the cache, so the next read re-derives.
      encrypted.clearKeys();
      await encrypted.read("correct horse battery staple");
      expect(derivations).toBe(3);
    } finally {
      subtle.deriveKey = original as typeof subtle.deriveKey;
    }
  });

  test("rejects malformed envelopes before decrypting", async () => {
    const store = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey);
    const envelope = {
      cipher: "AES-256-GCM",
      data: "not-base64",
      iterations: 310_000,
      iv: btoa("short"),
      kdf: "PBKDF2-SHA-256",
      salt: btoa("also-short"),
      scope: "mc-wallet:encrypted-store:mc-wallet:vault",
      version: 2,
    };

    expect(isEncryptedEnvelope(envelope)).toBe(false);
    await store.set(vaultKey, envelope);
    await expect(encrypted.read("correct horse battery staple")).rejects.toThrow(
      "Invalid encrypted store envelope",
    );
  });

  test("rejects extra envelope metadata before decrypting", async () => {
    const store = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey);
    const envelope = await encryptJson(
      { schemaVersion: 1 },
      "correct horse battery staple",
      "mc-wallet:encrypted-store:mc-wallet:vault",
    );
    const unexpected = { ...envelope, debug: true };
    const hiddenUnexpected = { ...envelope };
    Object.defineProperty(hiddenUnexpected, "debug", { value: true });

    expect(isEncryptedEnvelope(unexpected)).toBe(false);
    expect(isEncryptedEnvelope(hiddenUnexpected)).toBe(false);
    await store.set(vaultKey, unexpected);
    await expect(encrypted.read("correct horse battery staple")).rejects.toThrow(
      "Invalid encrypted store envelope",
    );
  });

  test("binds envelopes to their storage key", async () => {
    const store = createMemoryStore();
    const vaultStore = createEncryptedStore(store, vaultKey);
    const preferencesStore = createEncryptedStore(store, preferencesKey);

    await vaultStore.write({ schemaVersion: 1 }, "correct horse battery staple");
    const raw = await store.get(vaultKey);
    if (!isEncryptedEnvelope(raw)) {
      throw new Error("test setup failed");
    }

    await store.set(preferencesKey, raw);
    await expect(preferencesStore.read("correct horse battery staple")).rejects.toThrow(
      "Invalid encrypted store envelope",
    );
  });

  test("rejects unexpected KDF iteration envelopes", async () => {
    const store = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey);

    await encrypted.write({ schemaVersion: 1 }, "correct horse battery staple");
    const raw = await store.get(vaultKey);
    if (!isEncryptedEnvelope(raw)) {
      throw new Error("test setup failed");
    }

    const downgraded = { ...raw, iterations: 1 };
    expect(isEncryptedEnvelope(downgraded)).toBe(false);
    await store.set(vaultKey, downgraded);
    await expect(encrypted.read("correct horse battery staple")).rejects.toThrow(
      "Invalid encrypted store envelope",
    );

    const oversized = { ...raw, iterations: Number.MAX_SAFE_INTEGER };
    expect(isEncryptedEnvelope(oversized)).toBe(false);
    await store.set(vaultKey, oversized);
    await expect(encrypted.read("correct horse battery staple")).rejects.toThrow(
      "Invalid encrypted store envelope",
    );

    // Near-miss counts outside the accepted set fail closed too: only the
    // exact current and legacy strengths are readable.
    expect(isEncryptedEnvelope({ ...raw, iterations: 100_000 })).toBe(false);
  });

  // Builds an envelope at the pre-bump legacy strength with raw Web Crypto,
  // independent of the store's own encryptJson, to prove compatibility with
  // envelopes produced before the KDF iteration raise.
  const legacyEnvelope = async (value: unknown, passphrase: string, scope: string) => {
    const encoder = new TextEncoder();
    const iterations = 310_000;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const baseKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      { hash: "SHA-256", iterations, name: "PBKDF2", salt: salt.slice().buffer },
      baseKey,
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt"],
    );
    const data = await crypto.subtle.encrypt(
      {
        additionalData: encoder.encode(scope).slice().buffer,
        iv: iv.slice().buffer,
        name: "AES-GCM",
      },
      key,
      encoder.encode(JSON.stringify(value)),
    );
    const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    return {
      cipher: "AES-256-GCM",
      data: toBase64(new Uint8Array(data)),
      iterations,
      iv: toBase64(iv),
      kdf: "PBKDF2-SHA-256",
      salt: toBase64(salt),
      scope,
      version: 2,
    };
  };

  test("reads legacy-strength envelopes and upgrades them explicitly", async () => {
    const store = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey);
    const legacy = await legacyEnvelope(
      { schemaVersion: 1 },
      "correct horse battery staple",
      `mc-wallet:encrypted-store:${vaultKey}`,
    );
    expect(isEncryptedEnvelope(legacy)).toBe(true);
    await store.set(vaultKey, legacy as never);

    // The legacy envelope decrypts, but read stays side-effect-free so passive
    // callers cannot race a write with a stale upgrade.
    expect(await encrypted.read("correct horse battery staple")).toEqual({ schemaVersion: 1 });
    expect((await store.get(vaultKey)) as unknown).toEqual(legacy);

    // The explicit upgrade path re-encrypts at the current KDF strength after a
    // successful decrypt; the vault service runs this through its write queue.
    await encrypted.upgradeLegacyEnvelope("correct horse battery staple");
    const upgraded = await store.get(vaultKey);
    if (!isEncryptedEnvelope(upgraded)) {
      throw new Error("upgrade did not persist a valid envelope");
    }
    expect(upgraded.iterations).toBeGreaterThan(legacy.iterations);
    expect(await encrypted.read("correct horse battery staple")).toEqual({ schemaVersion: 1 });

    // A wrong passphrase never triggers the upgrade path.
    await store.set(vaultKey, legacy as never);
    await expect(encrypted.upgradeLegacyEnvelope("wrong horse battery staple")).rejects.toThrow();
    expect((await store.get(vaultKey)) as unknown).toEqual(legacy);
  });
});
