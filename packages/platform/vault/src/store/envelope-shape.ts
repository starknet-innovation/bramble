/**
 * The encrypted envelope's stored shape and its validator, checked before any
 * decryption. Split from `encrypted-store.ts` (size budget); that module
 * re-exports both, so callers keep importing them from there.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { hasBase64Bytes } from "./envelope-bytes";

/** PBKDF2-SHA-256 iterations every new envelope is written at. */
export const KDF_ITERATIONS = 600_000;
// Envelopes written before the iteration bump. Reads accept these exact
// values (never arbitrary ones, so a tampered-down envelope still fails
// closed) and the store transparently re-encrypts at the current strength on
// the next successful read. Accepting a legacy count does not weaken those
// vaults: they were produced at that strength, and forging a replacement
// envelope still requires the password.
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
