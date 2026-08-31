/** Public Nostr values accepted at contact-card and relay trust boundaries. */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isWebSocketServiceUrl } from "@mc-wallet/core/service-url";

/** Largest signed event JSON accepted from a relay or Krusty. */
export const MAX_NOSTR_EVENT_JSON_BYTES = 131_070;
/** Largest raw application payload considered before Krusty validates nested envelope expansion. */
export const MAX_NOSTR_APPLICATION_DATA_BYTES = 32_768;
/** Largest one-action batch accepted from a relay or wrapped for co-signers. */
export const MAX_NOSTR_BATCH_ITEMS = 50;
const encodedLength = (value: string): number => new TextEncoder().encode(value).length;

/** Bounded plaintext accepted by Krusty's application-data envelope. */
export const isNostrApplicationData = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_NOSTR_APPLICATION_DATA_BYTES &&
  encodedLength(value) <= MAX_NOSTR_APPLICATION_DATA_BYTES;

const isNostrHex32 = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

/** Canonical 32-byte event identifier spelling Nostr uses. */
export const isNostrEventId = (value: unknown): value is string => isNostrHex32(value);

/** Canonical 32-byte x-only public-key spelling Nostr uses. */
export const isNostrPublicKey = (value: unknown): value is string => isNostrHex32(value);

/** Secure Nostr relay URL accepted from wallet settings. */
export const isNostrRelayUrl = isWebSocketServiceUrl;

/** Fully signed Nostr event accepted from Krusty or an untrusted relay. */
export type NostrEvent = {
  readonly content: string;
  readonly created_at: number;
  readonly id: string;
  readonly kind: number;
  readonly pubkey: string;
  readonly sig: string;
  readonly tags: readonly (readonly string[])[];
};

const isTag = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= 8 &&
  value.every((part) => typeof part === "string" && part.length <= 512);

/** Validates a bounded signed event without trusting its authenticity or content. */
export const isNostrEvent = (value: unknown): value is NostrEvent =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["content", "created_at", "id", "kind", "pubkey", "sig", "tags"]) &&
  typeof value["content"] === "string" &&
  value["content"].length > 0 &&
  value["content"].length <= MAX_NOSTR_EVENT_JSON_BYTES &&
  encodedLength(value["content"]) <= MAX_NOSTR_EVENT_JSON_BYTES &&
  Number.isSafeInteger(value["created_at"]) &&
  (value["created_at"] as number) >= 0 &&
  isNostrEventId(value["id"]) &&
  Number.isSafeInteger(value["kind"]) &&
  (value["kind"] as number) >= 0 &&
  (value["kind"] as number) <= 65_535 &&
  isNostrPublicKey(value["pubkey"]) &&
  typeof value["sig"] === "string" &&
  /^[0-9a-f]{128}$/.test(value["sig"]) &&
  Array.isArray(value["tags"]) &&
  value["tags"].length <= 32 &&
  value["tags"].every(isTag);

/** Parses one bounded JSON event; cryptographic authentication remains Krusty's job. */
export const parseNostrEventJson = (value: unknown): NostrEvent | null => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_NOSTR_EVENT_JSON_BYTES ||
    encodedLength(value) > MAX_NOSTR_EVENT_JSON_BYTES
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isNostrEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
