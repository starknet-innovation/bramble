/**
 * Local persistence for the feature-flag client, through the generic
 * key-value boundary (never raw browser storage).
 *
 * Two plain, non-secret records:
 * - the last accepted document's raw text plus the highest accepted sequence
 *   and the last check time. The raw text is kept, not the parsed payload, so
 *   every read re-runs full verification (Ed25519, channel, expiry) and a
 *   tampered or expired copy degrades to bundled defaults;
 * - the per-install rollout bucket, generated once and never sent anywhere.
 *
 * Malformed records read as "nothing stored". For the document that means
 * bundled defaults until the next good fetch; for the bucket it means a fresh
 * draw. Store failures never throw out of these helpers.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import type { KeyValueStore } from "@mc-wallet/store/kv";
import { MAX_FLAG_DOCUMENT_BYTES, MAX_ROLLOUT } from "./contract";

/** Storage key for the last accepted document record. */
export const FEATURE_FLAG_STORE_KEY = "mc-wallet:feature-flags";

/** Storage key for the per-install rollout bucket. */
export const FEATURE_FLAG_BUCKET_KEY = "mc-wallet:feature-flag-bucket";

const STATE_VERSION = 1;
const STATE_KEYS = ["checkedAt", "document", "schemaVersion", "sequence"];

/** Persisted client state. `sequence` 0 means nothing accepted yet. */
export type FlagState = {
  readonly checkedAt: number;
  readonly document: string | null;
  readonly sequence: number;
};

/** The state a fresh install (or an unreadable record) starts from. */
export const EMPTY_FLAG_STATE: FlagState = { checkedAt: 0, document: null, sequence: 0 };

const isTime = (value: unknown, now: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= now;

/** Reads the persisted state, or {@link EMPTY_FLAG_STATE} when absent or invalid. */
export const readFlagState = async (store: KeyValueStore, now: number): Promise<FlagState> => {
  const value = await store.get(FEATURE_FLAG_STORE_KEY).catch(() => undefined);
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, STATE_KEYS) ||
    value["schemaVersion"] !== STATE_VERSION ||
    !isTime(value["checkedAt"], now) ||
    typeof value["sequence"] !== "number" ||
    !Number.isSafeInteger(value["sequence"]) ||
    value["sequence"] < 0 ||
    !(
      value["document"] === null ||
      (typeof value["document"] === "string" && value["document"].length <= MAX_FLAG_DOCUMENT_BYTES)
    )
  ) {
    return EMPTY_FLAG_STATE;
  }
  return {
    checkedAt: value["checkedAt"],
    document: value["document"],
    sequence: value["sequence"],
  };
};

/** Persists client state; a failed write is swallowed (memory stays authoritative). */
export const writeFlagState = async (store: KeyValueStore, state: FlagState): Promise<void> => {
  await store
    .set(FEATURE_FLAG_STORE_KEY, {
      checkedAt: state.checkedAt,
      document: state.document,
      schemaVersion: STATE_VERSION,
      sequence: state.sequence,
    })
    .catch(() => undefined);
};

/** Whether a value is a valid rollout bucket, an integer in [0, 9999]. */
export const isFlagBucket = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < MAX_ROLLOUT;

/**
 * Returns the stored install bucket, drawing and persisting one from `draw`
 * (the RNG boundary) on first use or when the stored value is invalid. A draw
 * that fails validation throws: the caller falls back to bundled defaults.
 */
export const readOrCreateFlagBucket = async (
  store: KeyValueStore,
  draw: () => number,
): Promise<number> => {
  const stored = await store.get(FEATURE_FLAG_BUCKET_KEY).catch(() => undefined);
  if (isFlagBucket(stored)) {
    return stored;
  }
  const bucket = draw();
  if (!isFlagBucket(bucket)) {
    throw new RangeError("flag bucket draw out of range");
  }
  await store.set(FEATURE_FLAG_BUCKET_KEY, bucket).catch(() => undefined);
  return bucket;
};
