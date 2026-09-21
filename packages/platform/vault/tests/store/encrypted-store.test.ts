/**
 * Encrypted store checks cover round trips and wrong-passphrase failure.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import { createMemoryStore } from "@bramble/store/kv";
import {
  createEncryptedStore,
  decryptJson,
  encryptJson,
  isEncryptedEnvelope,
} from "@bramble/vault/encrypted-store";
import { isVaultPassphrase, MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";

const vaultKey = "bramble:vault";
const preferencesKey = "bramble:preferences";

describe("createEncryptedStore", () => {
  test("validates vault passphrase length", () => {
    expect(isVaultPassphrase("correct horse battery staple")).toBe(true);
    expect(isVaultPassphrase("            ")).toBe(false);
    expect(isVaultPassphrase("short")).toBe(false);
  });

  test("gates the onboarding submit at the minimum-length boundary", () => {
    // The create-wallet form gates on this predicate so the backend invariant
    // never throws with an unsurfaced error. The floor is the shared constant,
    // so the form, the vault service, and the KDF cannot disagree about it —
    // the unlock and reveal fields read the same value, and a passphrase the
    // setup screen accepted must never be refused when unlocking.
    expect(isVaultPassphrase("a".repeat(MIN_VAULT_PASSPHRASE_LENGTH - 1))).toBe(false);
    expect(isVaultPassphrase("a".repeat(MIN_VAULT_PASSPHRASE_LENGTH))).toBe(true);
    // Below the recommended 12 but at or above the floor: accepted, and the
    // meter warns rather than the validator refusing.
    expect(isVaultPassphrase("Tr0ub4dor&3")).toBe(true);
    // Padding does not buy length — the floor applies to the trimmed value.
    expect(isVaultPassphrase(`  ${"a".repeat(MIN_VAULT_PASSPHRASE_LENGTH - 1)}  `)).toBe(false);
    expect(isVaultPassphrase(42)).toBe(false);
    expect(isVaultPassphrase(undefined)).toBe(false);
    expect(isVaultPassphrase("a".repeat(1_025))).toBe(false);
  });

  test("requires explicit encryption scopes", async () => {
    await expect(encryptJson({ ok: true }, "correct horse battery staple", "")).rejects.toThrow(
      "Encrypted store scope is required",
    );

    const envelope = await encryptJson(
      { ok: true },
      "correct horse battery staple",
      "bramble:test",
    );
    await expect(
      decryptJson(envelope, "correct horse battery staple", "bramble:other"),
    ).rejects.toThrow("Invalid encrypted store envelope");
  });

  test("rejects lossy JSON values before encryption", async () => {
    await expect(
      encryptJson({ amount: Number.NaN }, "correct horse battery staple", "bramble:test"),
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

  test("rejects replay of an older envelope while its independent marker stays current", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness);
    await encrypted.write({ revision: 1 }, "correct horse battery staple");
    const oldEnvelope = await store.get(vaultKey);
    await encrypted.write({ revision: 2 }, "correct horse battery staple");

    await store.set(vaultKey, oldEnvelope as Json);
    await expect(encrypted.read("correct horse battery staple")).rejects.toThrow(
      "Encrypted store rollback detected",
    );
  });

  test("recovers each interrupted commit point without losing the last committed value", async () => {
    for (const failAt of [1, 2, 3]) {
      const backend = createMemoryStore();
      const freshness = createMemoryStore();
      let writes = 0;
      let armed = false;
      const faulting = (target: KeyValueStore): KeyValueStore => ({
        get: (key) => target.get(key),
        remove: (key) => target.remove(key),
        async set(key, value) {
          writes += 1;
          if (armed && writes === failAt) {
            armed = false;
            throw new Error(`injected commit write ${failAt}`);
          }
          await target.set(key, value);
        },
      });
      const encrypted = createEncryptedStore(faulting(backend), vaultKey, faulting(freshness));
      await encrypted.write({ revision: 1 }, "correct horse battery staple");
      writes = 0;
      armed = true;

      await expect(
        encrypted.write({ revision: 2 }, "correct horse battery staple"),
      ).rejects.toThrow(`injected commit write ${failAt}`);
      const recovered = await encrypted.read("correct horse battery staple");
      expect(recovered).toEqual({ revision: failAt === 3 ? 2 : 1 });
    }
  });

  test("rejects rollback of the entire local profile while sync freshness remains current", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness);
    await encrypted.write({ revision: 1 }, "correct horse battery staple");
    const oldEnvelope = await store.get(vaultKey);
    await encrypted.write({ revision: 2 }, "correct horse battery staple");

    await store.set(vaultKey, oldEnvelope as Json);
    await expect(encrypted.read("correct horse battery staple")).rejects.toThrow(
      "Encrypted store rollback detected",
    );
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
      scope: "bramble:encrypted-store:bramble:vault",
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
      "bramble:encrypted-store:bramble:vault",
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
      "Encrypted store commit state missing",
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
      `bramble:encrypted-store:${vaultKey}`,
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

  test("rejects every older v2 envelope after the store commits its v3 migration", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness);
    const scope = `bramble:encrypted-store:${vaultKey}`;
    const earlier = await legacyEnvelope({ revision: 1 }, "correct horse battery staple", scope);
    const latest = await legacyEnvelope({ revision: 2 }, "correct horse battery staple", scope);

    // Both snapshots predate freshness tracking; only the latest is present
    // when migration establishes the independent store-wide authority.
    await store.set(vaultKey, earlier as never);
    await store.set(vaultKey, latest as never);
    await encrypted.upgradeLegacyEnvelope("correct horse battery staple");

    await store.set(vaultKey, earlier as never);
    await expect(encrypted.read("correct horse battery staple")).rejects.toThrow(
      "Encrypted store rollback detected",
    );
  });

  test("rejects v2 after a fresh store has committed v3", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness);
    const legacy = await legacyEnvelope(
      { revision: 1 },
      "correct horse battery staple",
      `bramble:encrypted-store:${vaultKey}`,
    );

    await encrypted.write({ revision: 2 }, "correct horse battery staple");
    await store.set(vaultKey, legacy as never);
    await expect(encrypted.read("correct horse battery staple")).rejects.toThrow(
      "Encrypted store rollback detected",
    );
  });

  test("recovers every interrupted v2-to-v3 migration write", async () => {
    for (const failAt of [1, 2, 3, 4]) {
      const backend = createMemoryStore();
      const freshnessBackend = createMemoryStore();
      let writes = 0;
      let armed = false;
      const faulting = (target: KeyValueStore): KeyValueStore => ({
        get: (key) => target.get(key),
        remove: (key) => target.remove(key),
        async set(key, value) {
          writes += 1;
          if (armed && writes === failAt) {
            armed = false;
            throw new Error(`injected migration write ${failAt}`);
          }
          await target.set(key, value);
        },
      });
      const encrypted = createEncryptedStore(
        faulting(backend),
        vaultKey,
        faulting(freshnessBackend),
      );
      const legacy = await legacyEnvelope(
        { schemaVersion: 1 },
        "correct horse battery staple",
        `bramble:encrypted-store:${vaultKey}`,
      );
      await backend.set(vaultKey, legacy as never);
      armed = true;

      await expect(encrypted.upgradeLegacyEnvelope("correct horse battery staple")).rejects.toThrow(
        `injected migration write ${failAt}`,
      );
      await expect(encrypted.read("correct horse battery staple")).resolves.toEqual({
        schemaVersion: 1,
      });
    }
  });

  test("rejects v2 when its store-wide marker has lost commit state", async () => {
    const store = createMemoryStore();
    const freshness = createMemoryStore();
    const encrypted = createEncryptedStore(store, vaultKey, freshness);
    const legacy = await legacyEnvelope(
      { revision: 1 },
      "correct horse battery staple",
      `bramble:encrypted-store:${vaultKey}`,
    );
    await store.set(vaultKey, legacy as never);
    await encrypted.upgradeLegacyEnvelope("correct horse battery staple");
    const upgraded = await store.get(vaultKey);
    if (!isEncryptedEnvelope(upgraded) || upgraded.version !== 3) {
      throw new Error("upgrade did not persist a committed envelope");
    }

    await freshness.remove(`${vaultKey}:commit:${upgraded.lineage}`);
    await store.set(vaultKey, legacy as never);
    await expect(encrypted.read("correct horse battery staple")).rejects.toThrow(
      "Encrypted store rollback detected",
    );
  });
});
