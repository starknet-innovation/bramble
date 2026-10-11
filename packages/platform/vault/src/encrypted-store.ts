/**
 * Encrypted JSON store using Web Crypto for local-at-rest browser extension data.
 */
import { invariant, WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord, type Json } from "@bramble/core/json";
import { assertJsonValue, assertStorageKey, type KeyValueStore } from "@bramble/store/kv";
import { isVaultPassphrase, MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import { base64ToBytes, bytesToBase64, bytesToHex, hasBase64Bytes } from "./store/envelope-bytes";
import { createFreshnessAuthority } from "./store/freshness-authority";
import { createLegacyMarker } from "./store/legacy-marker";
import {
  COMMIT_STATE_MISSING,
  type EncryptedStoreHealth,
  healthFor,
  INVALID_ENVELOPE,
  ROLLBACK_DETECTED,
  UNVERIFIED_HEALTH,
} from "./store/store-errors";

export {
  COMMIT_STATE_MISSING,
  type EncryptedStoreHealth,
  INVALID_ENVELOPE,
  ROLLBACK_DETECTED,
} from "./store/store-errors";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KDF_ITERATIONS = 600_000;
// Envelopes written before the iteration bump. Reads accept these exact
// values (never arbitrary ones, so a tampered-down envelope still fails
// closed) and the store transparently re-encrypts at the current strength on
// the next successful read. Accepting a legacy count does not weaken those
// vaults: they were produced at that strength, and forging a replacement
// envelope still requires the passphrase.
const LEGACY_KDF_ITERATIONS: ReadonlySet<number> = new Set([310_000]);

const isAcceptedIterations = (value: number): boolean =>
  value === KDF_ITERATIONS || LEGACY_KDF_ITERATIONS.has(value);
const ENVELOPE_KEYS = [
  "cipher",
  "data",
  "iterations",
  "iv",
  "kdf",
  "salt",
  "scope",
  "version",
] as const;
const COMMITTED_ENVELOPE_KEYS = [...ENVELOPE_KEYS, "commit", "lineage"] as const;

/**
 * Versioned encrypted JSON envelope stored at rest.
 */
export type EncryptedEnvelope = {
  readonly cipher: "AES-256-GCM";
  readonly data: string;
  readonly iterations: number;
  readonly iv: string;
  readonly kdf: "PBKDF2-SHA-256";
  readonly salt: string;
  readonly scope: string;
} & (
  | { readonly version: 2 }
  | { readonly commit: string; readonly lineage: string; readonly version: 3 }
);

/**
 * Validates encrypted envelope metadata before decryption.
 */
export const isEncryptedEnvelope = (value: unknown): value is EncryptedEnvelope => {
  if (
    !isRecord(value) ||
    value["cipher"] !== "AES-256-GCM" ||
    typeof value["data"] !== "string" ||
    typeof value["iterations"] !== "number" ||
    !isAcceptedIterations(value["iterations"]) ||
    typeof value["iv"] !== "string" ||
    !hasBase64Bytes(value["iv"], 12) ||
    value["kdf"] !== "PBKDF2-SHA-256" ||
    typeof value["salt"] !== "string" ||
    !hasBase64Bytes(value["salt"], 16) ||
    typeof value["scope"] !== "string" ||
    value["scope"].length === 0 ||
    !hasBase64Bytes(value["data"])
  ) {
    return false;
  }
  return value["version"] === 2
    ? hasOnlyKnownKeys(value, ENVELOPE_KEYS)
    : value["version"] === 3 &&
        hasOnlyKnownKeys(value, COMMITTED_ENVELOPE_KEYS) &&
        typeof value["commit"] === "string" &&
        hasBase64Bytes(value["commit"], 16) &&
        typeof value["lineage"] === "string" &&
        /^[0-9a-f]{32}$/.test(value["lineage"]);
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

/**
 * Resolves a passphrase into an AES-GCM key for the given salt/iterations,
 * mirroring the standalone {@link deriveKey}. A cached implementation can be
 * injected so the expensive KDF runs once per unlock instead of per operation.
 */
export type KeyResolver = (
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
) => Promise<CryptoKey>;

const deriveKey: KeyResolver = async (passphrase, salt, iterations) => {
  invariant(
    isVaultPassphrase(passphrase),
    `Passphrase must be at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters`,
  );

  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { hash: "SHA-256", iterations, name: "PBKDF2", salt: toArrayBuffer(salt) },
    baseKey,
    { length: 256, name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
};

// A non-secret fingerprint of the passphrase, used only to key the in-memory
// derived-key cache so a wrong passphrase can never collide onto a cached key.
const passphraseFingerprint = async (passphrase: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(encoder.encode(passphrase)));
  return bytesToBase64(new Uint8Array(digest));
};

const encryptionParams = (
  iv: Uint8Array,
  scope: string,
  marker?: { readonly commit: string; readonly lineage: string },
): AesGcmParams => {
  invariant(scope.length > 0, "Encrypted store scope is required");
  return {
    additionalData: toArrayBuffer(
      encoder.encode(
        marker === undefined ? scope : `${scope}\0${marker.lineage}\0${marker.commit}`,
      ),
    ),
    iv: toArrayBuffer(iv),
    name: "AES-GCM",
  };
};

/**
 * Encrypts JSON data with passphrase-derived AES-GCM bound to a caller scope.
 */
export const encryptJson = async (
  value: Json,
  passphrase: string,
  scope: string,
  resolveKey: KeyResolver = deriveKey,
  lineage = bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
): Promise<EncryptedEnvelope> => {
  assertJsonValue(value);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const commit = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await resolveKey(passphrase, salt, KDF_ITERATIONS);
  const plaintext = encoder.encode(JSON.stringify(value));
  const data = await crypto.subtle.encrypt(
    encryptionParams(iv, scope, { commit, lineage }),
    key,
    plaintext,
  );

  return {
    cipher: "AES-256-GCM",
    commit,
    data: bytesToBase64(new Uint8Array(data)),
    iterations: KDF_ITERATIONS,
    iv: bytesToBase64(iv),
    kdf: "PBKDF2-SHA-256",
    lineage,
    salt: bytesToBase64(salt),
    scope,
    version: 3,
  };
};

/**
 * Decrypts an already validated encrypted JSON envelope for its caller scope.
 */
export const decryptJson = async (
  envelope: EncryptedEnvelope,
  passphrase: string,
  scope: string,
  resolveKey: KeyResolver = deriveKey,
): Promise<unknown> => {
  if (envelope.scope !== scope) {
    throw new WalletError(INVALID_ENVELOPE);
  }

  const key = await resolveKey(passphrase, base64ToBytes(envelope.salt), envelope.iterations);
  const plaintext = await crypto.subtle.decrypt(
    encryptionParams(
      base64ToBytes(envelope.iv),
      scope,
      envelope.version === 3 ? { commit: envelope.commit, lineage: envelope.lineage } : undefined,
    ),
    key,
    toArrayBuffer(base64ToBytes(envelope.data)),
  );

  return JSON.parse(decoder.decode(plaintext)) as unknown;
};

/**
 * Passphrase-protected JSON store over a key-value backend. `clearKeys` drops
 * the in-memory derived-key cache and must be called when the wallet locks.
 *
 * `readUnverified` and `replaceUnverified` exist only for a vault whose health
 * is `unverified` or `rollback`, and throw otherwise. They skip the freshness
 * check that makes replaying an old envelope detectable, so a caller must have
 * the user's explicit consent to accept a possibly older copy.
 */
export type EncryptedStore = {
  readonly clearKeys: () => void;
  readonly exists: () => Promise<boolean>;
  readonly health: () => Promise<EncryptedStoreHealth>;
  readonly read: (passphrase: string) => Promise<unknown>;
  readonly readUnverified: (passphrase: string) => Promise<unknown>;
  readonly remove: () => Promise<void>;
  readonly replaceUnverified: (value: Json, passphrase: string) => Promise<void>;
  readonly upgradeLegacyEnvelope: (passphrase: string) => Promise<void>;
  readonly write: (value: Json, passphrase: string) => Promise<void>;
};

// Bounds the derived-key cache; salt changes each write, so a long-running
// unlocked session with many writes must not accumulate keys without limit.
const MAX_CACHED_KEYS = 8;

/**
 * Creates an encrypted store for one key in the provided backend. The store
 * memoizes derived AES keys per (passphrase fingerprint, salt, iterations) so
 * the PBKDF2 work runs once per unlock rather than on every read or signature;
 * the keys are non-extractable and are dropped by `clearKeys` on lock.
 *
 * `mirrorFreshness` keeps a copy of each durable commit record in `store`, read
 * only when the durable record is missing. Only a store whose durable record
 * the wallet never deletes while its envelope may still be replayed can take
 * one: the migration staging store removes its record after every migration,
 * so a mirror there would let a restored copy of `store` vouch for itself.
 */
export const createEncryptedStore = (
  store: KeyValueStore,
  key: string,
  freshnessStore: KeyValueStore = store,
  sessionFreshnessStore?: KeyValueStore,
  mirrorFreshness = false,
): EncryptedStore => {
  assertStorageKey(key);
  const scope = `bramble:encrypted-store:${key}`;
  const freshness = createFreshnessAuthority(
    key,
    freshnessStore,
    sessionFreshnessStore,
    mirrorFreshness && freshnessStore !== store ? store : undefined,
  );
  const legacy = createLegacyMarker(key, store, freshnessStore, freshness);
  const keyCache = new Map<string, CryptoKey>();
  let keyCacheGeneration = 0;

  const readRawEnvelope = async (): Promise<EncryptedEnvelope | undefined> => {
    const envelope = await store.get(key);
    if (envelope === undefined) {
      return undefined;
    }
    if (!isEncryptedEnvelope(envelope)) {
      throw new WalletError(INVALID_ENVELOPE);
    }
    return envelope as EncryptedEnvelope;
  };

  const recoverCommittedEnvelope = async (
    envelope: Extract<EncryptedEnvelope, { readonly version: 3 }>,
  ): Promise<EncryptedEnvelope> => {
    const state = await freshness.read(envelope.lineage);
    if (state === undefined) {
      throw new WalletError(COMMIT_STATE_MISSING);
    }
    if (state.current !== envelope.commit && state.pending !== envelope.commit) {
      throw new WalletError(ROLLBACK_DETECTED);
    }
    // Both authorities must vouch for the envelope. `freshnessStore` is
    // `storage.sync`, which a content script can write on Firefox, so an
    // attacker there rewrites the envelope and its commit state together and
    // the pair stays self-consistent; the session shadow it cannot reach is
    // what disagrees.
    await freshness.requireShadow(envelope.lineage, envelope.commit);
    await freshness.restoreDurable(envelope.lineage);
    if (state.pending !== null) {
      await freshness.set(envelope.lineage, {
        current: envelope.commit,
        pending: null,
        version: 1,
      });
    }
    await legacy.claim(envelope.lineage);
    return envelope;
  };

  const readEnvelope = async (): Promise<EncryptedEnvelope | undefined> => {
    const envelope = await readRawEnvelope();
    if (envelope === undefined) {
      return undefined;
    }
    // Version-2 envelopes predate the independent marker and remain readable
    // only until this store has committed a marked value. Replaying one over a
    // marked profile is therefore rejected.
    if (envelope.version === 2) {
      return legacy.recover(envelope);
    }
    return recoverCommittedEnvelope(envelope);
  };

  const writeEnvelope = async (
    envelope: EncryptedEnvelope,
    previous: EncryptedEnvelope | undefined,
  ): Promise<void> => {
    if (envelope.version !== 3) {
      throw new WalletError("Committed encrypted envelope required");
    }
    const commit = envelope.commit;
    const current = previous?.version === 3 ? previous.commit : null;
    await freshness.set(envelope.lineage, {
      current,
      pending: commit,
      version: 1,
    });
    if (previous?.version !== 3) {
      await legacy.prepare(envelope.lineage);
    }
    await store.set(key, envelope);
    await freshness.set(envelope.lineage, {
      current: commit,
      pending: null,
      version: 1,
    });
  };

  const previousForWrite = async (): Promise<EncryptedEnvelope | undefined> => {
    try {
      return await readEnvelope();
    } catch (error) {
      const raw = await store.get(key);
      if (raw !== undefined && !isEncryptedEnvelope(raw)) {
        return undefined;
      }
      throw error;
    }
  };

  const encryptAndWrite = async (value: Json, passphrase: string): Promise<void> => {
    const previous = await previousForWrite();
    const lineage =
      previous?.version === 3
        ? previous.lineage
        : bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    await writeEnvelope(await encryptJson(value, passphrase, scope, resolveKey, lineage), previous);
  };

  const currentHealth = async (): Promise<EncryptedStoreHealth> => {
    try {
      return (await readEnvelope()) === undefined ? "absent" : "ok";
    } catch (error) {
      const health = healthFor(error);
      if (health === undefined) {
        throw error;
      }
      return health;
    }
  };

  const requireUnverified = async (): Promise<EncryptedEnvelope> => {
    if (!UNVERIFIED_HEALTH.has(await currentHealth())) {
      throw new WalletError("Encrypted store is not awaiting recovery");
    }
    const envelope = await readRawEnvelope();
    invariant(envelope !== undefined, "Encrypted store is not awaiting recovery");
    return envelope as EncryptedEnvelope;
  };

  const resolveKey: KeyResolver = async (passphrase, salt, iterations) => {
    const generation = keyCacheGeneration;
    const cacheId = `${await passphraseFingerprint(passphrase)}:${bytesToBase64(salt)}:${iterations}`;
    const cached = keyCache.get(cacheId);
    if (cached) {
      return cached;
    }
    const derived = await deriveKey(passphrase, salt, iterations);
    // Lock can invalidate this resolution during either fingerprinting or PBKDF2.
    // A stale resolution must not evict a key a later unlock has already cached.
    if (generation === keyCacheGeneration) {
      if (keyCache.size >= MAX_CACHED_KEYS) {
        const oldest = keyCache.keys().next().value;
        if (oldest !== undefined) {
          keyCache.delete(oldest);
        }
      }
      keyCache.set(cacheId, derived);
    }
    return derived;
  };

  return {
    clearKeys() {
      keyCacheGeneration += 1;
      keyCache.clear();
    },
    async exists() {
      return (await store.get(key)) !== undefined;
    },
    health: currentHealth,
    async read(passphrase) {
      const envelope = await readEnvelope();
      if (envelope === undefined) {
        return undefined;
      }
      return decryptJson(envelope, passphrase, scope, resolveKey);
    },
    async readUnverified(passphrase) {
      return decryptJson(await requireUnverified(), passphrase, scope, resolveKey);
    },
    // A malformed envelope is removed too: removal is how a wallet that cannot
    // be opened is reset, and refusing to delete what cannot be parsed would
    // leave that wallet stuck.
    async remove() {
      const raw = await store.get(key);
      await store.remove(key);
      if (isEncryptedEnvelope(raw) && raw.version === 3) {
        await freshness.remove(raw.lineage);
      }
    },
    // A fresh lineage, so neither a missing record nor one naming a newer
    // commit for the old lineage has any say over the replacement. The old
    // lineage's records are removed only once the replacement is committed.
    async replaceUnverified(value, passphrase) {
      const previous = await requireUnverified();
      const lineage = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      await writeEnvelope(
        await encryptJson(value, passphrase, scope, resolveKey, lineage),
        undefined,
      );
      if (previous.version === 3) {
        await freshness.remove(previous.lineage);
      }
    },
    async upgradeLegacyEnvelope(passphrase) {
      const envelope = await readEnvelope();
      if (
        envelope === undefined ||
        (envelope.version === 3 && envelope.iterations === KDF_ITERATIONS)
      ) {
        return;
      }
      const decrypted = await decryptJson(envelope, passphrase, scope, resolveKey);
      assertJsonValue(decrypted);
      await encryptAndWrite(decrypted, passphrase);
    },
    async write(value, passphrase) {
      await encryptAndWrite(value, passphrase);
    },
  };
};
