/**
 * Verification of a fetched (or re-read) bramble-ff flag file.
 *
 * Order matters and mirrors the publisher's `src/verify.ts`: size cap ->
 * JSON -> envelope shape -> trusted keyId -> Ed25519 over canonical(payload)
 * -> schema version -> full payload validation -> channel -> time window ->
 * rollback. Nothing in the payload is interpreted before the Ed25519 check
 * passes against a key bundled in this build; keys are never fetched.
 *
 * The Ed25519 value checked here is the publisher's public signature over
 * public flag data. It is not wallet secret material and it never touches
 * the vault, Krusty, or any signing path.
 *
 * Never throws: every failure is a {@link FlagRejection} the caller turns into
 * "keep the last good document, else bundled defaults".
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { canonicalBytes, decodeBase64url } from "./canonical";
import {
  FLAG_SCHEMA_VERSION,
  type FlagChannel,
  type FlagPayload,
  MAX_FLAG_DOCUMENT_BYTES,
  parseFlagPayload,
} from "./contract";

/** Why a document was refused. Carries no document content. */
export type FlagRejection =
  | "bad-signature"
  | "expired"
  | "malformed"
  | "not-yet-valid"
  | "rollback"
  | "too-large"
  | "unknown-key"
  | "wrong-channel"
  | "wrong-schema";

/** Outcome of {@link verifyFlagDocument}. */
export type FlagVerification =
  | { readonly ok: true; readonly payload: FlagPayload }
  | { readonly ok: false; readonly reason: FlagRejection };

/** Imported Ed25519 verification keys, by publisher keyId. */
export type TrustedFlagKeys = ReadonlyMap<string, CryptoKey>;

/** Inputs to {@link verifyFlagDocument}; `now` is injected, never read. */
export type FlagVerifyOptions = {
  readonly channel: FlagChannel;
  /** Last accepted sequence; lower is a rollback, equal is a refetch. */
  readonly minSequence: number;
  readonly now: number;
  readonly trustedKeys: TrustedFlagKeys;
};

const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ED25519_B64URL_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const ENVELOPE_KEYS = ["keyId", "payload", "signature"];
// Tolerated client clock skew for an `issuedAt` slightly in the future.
const MAX_CLOCK_SKEW_MS = 300_000;

const reject = (reason: FlagRejection): FlagVerification => ({ ok: false, reason });

/**
 * Imports the bundled public keys (`keyId` -> base64url raw 32-byte Ed25519).
 * Throws when any bundled entry is malformed: that is a build defect, and the
 * caller fails closed to bundled flag defaults.
 */
export const importTrustedFlagKeys = async (
  keys: Readonly<Record<string, string>>,
): Promise<TrustedFlagKeys> => {
  const imported = new Map<string, CryptoKey>();
  for (const [keyId, encoded] of Object.entries(keys)) {
    const raw = decodeBase64url(encoded);
    if (!KEY_ID_PATTERN.test(keyId) || raw.length !== 32) {
      throw new TypeError("bundled flag key is malformed");
    }
    imported.set(
      keyId,
      await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]),
    );
  }
  return imported;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const verifyEd25519 = async (
  key: CryptoKey,
  encoded: string,
  payload: unknown,
): Promise<boolean | null> => {
  try {
    const message = canonicalBytes(payload);
    const proof = decodeBase64url(encoded);
    return proof.length === 64
      ? await crypto.subtle.verify({ name: "Ed25519" }, key, proof, message)
      : null;
  } catch {
    return null;
  }
};

const checkPayload = (payload: FlagPayload, options: FlagVerifyOptions): FlagVerification => {
  if (payload.channel !== options.channel) {
    return reject("wrong-channel");
  }
  if (payload.issuedAt > options.now + MAX_CLOCK_SKEW_MS) {
    return reject("not-yet-valid");
  }
  if (options.now >= payload.expiresAt) {
    return reject("expired");
  }
  if (payload.sequence < options.minSequence) {
    return reject("rollback");
  }
  return { ok: true, payload };
};

/** Verifies one document's raw text against the bundled keys and build channel. */
export const verifyFlagDocument = async (
  text: string,
  options: FlagVerifyOptions,
): Promise<FlagVerification> => {
  if (new TextEncoder().encode(text).length > MAX_FLAG_DOCUMENT_BYTES) {
    return reject("too-large");
  }
  const envelope = parseJson(text);
  if (
    !isRecord(envelope) ||
    !hasOnlyKnownKeys(envelope, ENVELOPE_KEYS) ||
    !Object.hasOwn(envelope, "payload") ||
    typeof envelope["keyId"] !== "string" ||
    !KEY_ID_PATTERN.test(envelope["keyId"]) ||
    typeof envelope["signature"] !== "string" ||
    !ED25519_B64URL_PATTERN.test(envelope["signature"])
  ) {
    return reject("malformed");
  }
  const key = options.trustedKeys.get(envelope["keyId"]);
  if (!key) {
    return reject("unknown-key");
  }
  const verified = await verifyEd25519(key, envelope["signature"], envelope["payload"]);
  if (verified === null) {
    return reject("malformed");
  }
  if (!verified) {
    return reject("bad-signature");
  }
  const payload = envelope["payload"];
  if (isRecord(payload) && payload["schema"] !== FLAG_SCHEMA_VERSION) {
    return reject("wrong-schema");
  }
  try {
    return checkPayload(parseFlagPayload(payload), options);
  } catch {
    return reject("malformed");
  }
};
