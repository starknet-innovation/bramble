/**
 * Encrypted JSON store using Web Crypto for local-at-rest browser extension data.
 */
import { invariant, WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord, type Json } from "@bramble/core/json";
import { assertJsonValue, assertStorageKey, type KeyValueStore } from "@bramble/store/kv";
import { isVaultPassphrase } from "@bramble/wallet-model/passphrase";

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
const COMMIT_STATE_KEYS = ["current", "pending", "version"] as const;
const LEGACY_STATE_KEYS = ["lineage", "version"] as const;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const hasBase64Bytes = (value: string, byteLength?: number): boolean => {
  try {
    const bytes = base64ToBytes(value);
    return byteLength === undefined ? bytes.byteLength > 0 : bytes.byteLength === byteLength;
  } catch {
    return false;
  }
};

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
  invariant(isVaultPassphrase(passphrase), "Passphrase must be at least 12 characters");

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
    throw new WalletError("Invalid encrypted store envelope");
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
 */
export type EncryptedStore = {
  readonly clearKeys: () => void;
  readonly exists: () => Promise<boolean>;
  readonly read: (passphrase: string) => Promise<unknown>;
  readonly remove: () => Promise<void>;
  readonly upgradeLegacyEnvelope: (passphrase: string) => Promise<void>;
  readonly write: (value: Json, passphrase: string) => Promise<void>;
};

// Bounds the derived-key cache; salt changes each write, so a long-running
// unlocked session with many writes must not accumulate keys without limit.
const MAX_CACHED_KEYS = 8;

type CommitState = {
  readonly current: string | null;
  readonly pending: string | null;
  readonly version: 1;
};

type LegacyState = { readonly lineage: string; readonly version: 1 };

const isCommitState = (value: unknown): value is CommitState =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, COMMIT_STATE_KEYS) &&
  (value["current"] === null ||
    (typeof value["current"] === "string" && hasBase64Bytes(value["current"], 16))) &&
  (value["pending"] === null ||
    (typeof value["pending"] === "string" && hasBase64Bytes(value["pending"], 16))) &&
  value["version"] === 1;

const isLegacyState = (value: unknown): value is LegacyState =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, LEGACY_STATE_KEYS) &&
  typeof value["lineage"] === "string" &&
  /^[0-9a-f]{32}$/.test(value["lineage"]) &&
  value["version"] === 1;

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Creates an encrypted store for one key in the provided backend. The store
 * memoizes derived AES keys per (passphrase fingerprint, salt, iterations) so
 * the PBKDF2 work runs once per unlock rather than on every read or signature;
 * the keys are non-extractable and are dropped by `clearKeys` on lock.
 */
export const createEncryptedStore = (
  store: KeyValueStore,
  key: string,
  freshnessStore: KeyValueStore = store,
): EncryptedStore => {
  assertStorageKey(key);
  const scope = `mc-wallet:encrypted-store:${key}`;
  const commitKey = (lineage: string): string => `${key}:commit:${lineage}`;
  // This authority is deliberately store-wide, not keyed to the one v2
  // envelope present during migration. Once any v3 commit for this store is
  // current, every earlier authentic v2 envelope must be rejected.
  const legacyKey = `${key}:legacy`;
  const keyCache = new Map<string, CryptoKey>();

  const readRawEnvelope = async (): Promise<EncryptedEnvelope | undefined> => {
    const envelope = await store.get(key);
    if (envelope === undefined) {
      return undefined;
    }
    if (!isEncryptedEnvelope(envelope)) {
      throw new WalletError("Invalid encrypted store envelope");
    }
    return envelope as EncryptedEnvelope;
  };

  const readCommitState = async (lineage: string): Promise<CommitState | undefined> => {
    const state = await freshnessStore.get(commitKey(lineage));
    if (state === undefined) {
      return undefined;
    }
    if (!isCommitState(state)) {
      throw new WalletError("Invalid encrypted store commit state");
    }
    return state;
  };

  const recoverLegacyEnvelope = async (
    envelope: Extract<EncryptedEnvelope, { readonly version: 2 }>,
  ): Promise<EncryptedEnvelope> => {
    const legacy = await freshnessStore.get(legacyKey);
    if (legacy === undefined) {
      return envelope;
    }
    if (!isLegacyState(legacy)) {
      throw new WalletError("Invalid encrypted store commit state");
    }
    const state = await readCommitState(legacy.lineage);
    if (state === undefined) {
      // The legacy marker is written only after the pending commit state. Its
      // presence without that state cannot be a valid interrupted write; it is
      // lost/corrupt freshness authority and must not reopen v2 rollback.
      throw new WalletError("Encrypted store rollback detected");
    }
    if (state.current === null && state.pending !== null) {
      // Migration crashed after both prepare records but before replacing the
      // legacy envelope. Abort that uncommitted write and keep v2 recoverable.
      await freshnessStore.remove(commitKey(legacy.lineage));
      await freshnessStore.remove(legacyKey);
      return envelope;
    }
    throw new WalletError("Encrypted store rollback detected");
  };

  const recoverCommittedEnvelope = async (
    envelope: Extract<EncryptedEnvelope, { readonly version: 3 }>,
  ): Promise<EncryptedEnvelope> => {
    const state = await readCommitState(envelope.lineage);
    if (state === undefined) {
      throw new WalletError("Encrypted store commit state missing");
    }
    if (state.current !== envelope.commit && state.pending !== envelope.commit) {
      throw new WalletError("Encrypted store rollback detected");
    }
    if (state.pending !== null) {
      await freshnessStore.set(commitKey(envelope.lineage), {
        current: envelope.commit,
        pending: null,
        version: 1,
      });
    }
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
      return recoverLegacyEnvelope(envelope);
    }
    return recoverCommittedEnvelope(envelope);
  };

  const prepareLegacyState = async (lineage: string): Promise<void> => {
    const legacy = await freshnessStore.get(legacyKey);
    if (legacy !== undefined && !isLegacyState(legacy)) {
      throw new WalletError("Invalid encrypted store commit state");
    }
    if (legacy === undefined) {
      await freshnessStore.set(legacyKey, { lineage, version: 1 });
    }
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
    await freshnessStore.set(commitKey(envelope.lineage), {
      current,
      pending: commit,
      version: 1,
    });
    if (previous?.version !== 3) {
      await prepareLegacyState(envelope.lineage);
    }
    await store.set(key, envelope);
    await freshnessStore.set(commitKey(envelope.lineage), {
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

  const resolveKey: KeyResolver = async (passphrase, salt, iterations) => {
    const cacheId = `${await passphraseFingerprint(passphrase)}:${bytesToBase64(salt)}:${iterations}`;
    const cached = keyCache.get(cacheId);
    if (cached) {
      return cached;
    }
    const derived = await deriveKey(passphrase, salt, iterations);
    if (keyCache.size >= MAX_CACHED_KEYS) {
      const oldest = keyCache.keys().next().value;
      if (oldest !== undefined) {
        keyCache.delete(oldest);
      }
    }
    keyCache.set(cacheId, derived);
    return derived;
  };

  return {
    clearKeys() {
      keyCache.clear();
    },
    async exists() {
      return (await store.get(key)) !== undefined;
    },
    async read(passphrase) {
      const envelope = await readEnvelope();
      if (envelope === undefined) {
        return undefined;
      }
      return decryptJson(envelope, passphrase, scope, resolveKey);
    },
    async remove() {
      const envelope = await readRawEnvelope();
      await store.remove(key);
      if (envelope?.version === 3) {
        await freshnessStore.remove(commitKey(envelope.lineage));
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
