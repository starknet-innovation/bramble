/**
 * Encrypted JSON store using Web Crypto for local-at-rest browser extension data.
 */
import { invariant, WalletError } from "../shared/errors";
import { hasOnlyKnownKeys, isRecord, type Json } from "../shared/json";
import { assertJsonValue, assertStorageKey, type KeyValueStore } from "./kv";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KDF_ITERATIONS = 310_000;
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
  value.cipher === "AES-256-GCM" &&
  typeof value.data === "string" &&
  typeof value.iterations === "number" &&
  value.iterations === KDF_ITERATIONS &&
  typeof value.iv === "string" &&
  hasBase64Bytes(value.iv, 12) &&
  value.kdf === "PBKDF2-SHA-256" &&
  typeof value.salt === "string" &&
  hasBase64Bytes(value.salt, 16) &&
  typeof value.scope === "string" &&
  value.scope.length > 0 &&
  hasBase64Bytes(value.data) &&
  value.version === 2;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const deriveKey = async (passphrase: string, salt: Uint8Array, iterations: number) => {
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
): Promise<EncryptedEnvelope> => {
  assertJsonValue(value);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
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
): Promise<unknown> => {
  if (envelope.scope !== scope) {
    throw new WalletError("Invalid encrypted store envelope");
  }

  const key = await deriveKey(passphrase, base64ToBytes(envelope.salt), envelope.iterations);
  const plaintext = await crypto.subtle.decrypt(
    encryptionParams(base64ToBytes(envelope.iv), scope),
    key,
    toArrayBuffer(base64ToBytes(envelope.data)),
  );

  return JSON.parse(decoder.decode(plaintext)) as unknown;
};

/**
 * Passphrase-protected JSON store over a key-value backend.
 */
export type EncryptedStore = {
  readonly exists: () => Promise<boolean>;
  readonly read: (passphrase: string) => Promise<unknown>;
  readonly remove: () => Promise<void>;
  readonly write: (value: Json, passphrase: string) => Promise<void>;
};

/**
 * Creates an encrypted store for one key in the provided backend.
 */
export const createEncryptedStore = (store: KeyValueStore, key: string): EncryptedStore => {
  assertStorageKey(key);
  const scope = `mc-wallet:encrypted-store:${key}`;

  return {
    async exists() {
      return (await store.get(key)) !== undefined;
    },
    async read(passphrase) {
      const envelope = await store.get(key);
      if (envelope === undefined) {
        return undefined;
      }
      if (!isEncryptedEnvelope(envelope)) {
        throw new WalletError("Invalid encrypted store envelope");
      }
      return decryptJson(envelope as EncryptedEnvelope, passphrase, scope);
    },
    async remove() {
      await store.remove(key);
    },
    async write(value, passphrase) {
      await store.set(key, await encryptJson(value, passphrase, scope));
    },
  };
};
