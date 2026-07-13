/**
 * Encrypted JSON store using Web Crypto for local-at-rest browser extension data.
 */
import { invariant, WalletError } from "../shared/errors";
import { hasOnlyKnownKeys, isRecord, type Json } from "../shared/json";
import { assertJsonValue, assertStorageKey, type KeyValueStore } from "./kv";

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
 * Checks whether a value is acceptable for local vault encryption.
 */
export const isVaultPassphrase = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length >= 12;

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
  readonly version: 2;
};

/**
 * Validates encrypted envelope metadata before decryption.
 */
export const isEncryptedEnvelope = (value: unknown): value is EncryptedEnvelope =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ENVELOPE_KEYS) &&
  value["cipher"] === "AES-256-GCM" &&
  typeof value["data"] === "string" &&
  typeof value["iterations"] === "number" &&
  isAcceptedIterations(value["iterations"]) &&
  typeof value["iv"] === "string" &&
  hasBase64Bytes(value["iv"], 12) &&
  value["kdf"] === "PBKDF2-SHA-256" &&
  typeof value["salt"] === "string" &&
  hasBase64Bytes(value["salt"], 16) &&
  typeof value["scope"] === "string" &&
  value["scope"].length > 0 &&
  hasBase64Bytes(value["data"]) &&
  value["version"] === 2;

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

const encryptionParams = (iv: Uint8Array, scope: string): AesGcmParams => {
  invariant(scope.length > 0, "Encrypted store scope is required");
  return {
    additionalData: toArrayBuffer(encoder.encode(scope)),
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
): Promise<EncryptedEnvelope> => {
  assertJsonValue(value);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await resolveKey(passphrase, salt, KDF_ITERATIONS);
  const plaintext = encoder.encode(JSON.stringify(value));
  const data = await crypto.subtle.encrypt(encryptionParams(iv, scope), key, plaintext);

  return {
    cipher: "AES-256-GCM",
    data: bytesToBase64(new Uint8Array(data)),
    iterations: KDF_ITERATIONS,
    iv: bytesToBase64(iv),
    kdf: "PBKDF2-SHA-256",
    salt: bytesToBase64(salt),
    scope,
    version: 2,
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
    encryptionParams(base64ToBytes(envelope.iv), scope),
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

/**
 * Creates an encrypted store for one key in the provided backend. The store
 * memoizes derived AES keys per (passphrase fingerprint, salt, iterations) so
 * the PBKDF2 work runs once per unlock rather than on every read or signature;
 * the keys are non-extractable and are dropped by `clearKeys` on lock.
 */
export const createEncryptedStore = (store: KeyValueStore, key: string): EncryptedStore => {
  assertStorageKey(key);
  const scope = `mc-wallet:encrypted-store:${key}`;
  const keyCache = new Map<string, CryptoKey>();

  const readEnvelope = async (): Promise<EncryptedEnvelope | undefined> => {
    const envelope = await store.get(key);
    if (envelope === undefined) {
      return undefined;
    }
    if (!isEncryptedEnvelope(envelope)) {
      throw new WalletError("Invalid encrypted store envelope");
    }
    return envelope as EncryptedEnvelope;
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
      await store.remove(key);
    },
    async upgradeLegacyEnvelope(passphrase) {
      const envelope = await readEnvelope();
      if (envelope === undefined || envelope.iterations === KDF_ITERATIONS) {
        return;
      }
      const decrypted = await decryptJson(envelope, passphrase, scope, resolveKey);
      assertJsonValue(decrypted);
      await store.set(key, await encryptJson(decrypted, passphrase, scope, resolveKey));
    },
    async write(value, passphrase) {
      await store.set(key, await encryptJson(value, passphrase, scope, resolveKey));
    },
  };
};
