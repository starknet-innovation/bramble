/** Durable public sync receipts for encrypted multisig coordination. */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";
import { isAccountId } from "@bramble/wallet-model/accounts";
import { isStarkFieldElement } from "@bramble/wallet-model/networks";
import { isNostrEventId, isNostrRelayUrl } from "@bramble/wallet-model/nostr";

/** Browser-local key for non-secret relay sync metadata. */
export const NOSTR_COORDINATION_STORE_KEY = "bramble:nostr-coordination:v1";

/**
 * Browser-local key for the intents a user removed, per multisig account, so
 * relay sync never brings one back. Public metadata: intent ids only.
 */
export const NOSTR_REMOVED_INTENTS_STORE_KEY = "bramble:nostr-coordination:removed:v1";

const MAX_CHECKPOINTS = 20;
const MAX_REMOVED_ACCOUNTS = 20;
const MAX_REMOVED_INTENTS = 100;
const MAX_SEEN_EVENT_IDS = 200;
const MAX_SYNC_SECONDS = 4_102_444_800;

/** Last successful relay scan and bounded event receipts for one multisig account. */
export type NostrSyncCheckpoint = {
  readonly accountId: string;
  readonly eventIds: readonly string[];
  readonly relayUrls: readonly string[];
  readonly syncedAt: number;
};

/** Public coordination metadata store; encrypted content and keys never enter it. */
export type NostrCoordinationStore = {
  readonly getCheckpoint: (
    accountId: string,
    relayUrls: readonly string[],
  ) => Promise<NostrSyncCheckpoint | null>;
  readonly recordSync: (
    checkpoint: NostrSyncCheckpoint,
    isAuthorized?: () => boolean,
  ) => Promise<"invalid" | "stored" | "unauthorized">;
  /**
   * Remembers that the user removed an intent. Relay sync refuses to import a
   * removed intent again, whatever event id a relay serves it under, because
   * relay event ids are never authenticated (Sherlock 168, 237). The newest
   * `MAX_REMOVED_INTENTS` per account are kept.
   */
  readonly recordRemovedIntent: (
    accountId: string,
    intentId: string,
    isAuthorized?: () => boolean,
  ) => Promise<"invalid" | "stored" | "unauthorized">;
  /** Whether the user removed this intent; false for malformed input. */
  readonly isRemovedIntent: (accountId: string, intentId: string) => Promise<boolean>;
};

/** Intents removed by the user on one multisig account, newest first. */
type RemovedIntents = { readonly accountId: string; readonly intentIds: readonly string[] };

// An intent id is its account id and its frozen transaction hash.
const isIntentIdFor = (accountId: string, intentId: unknown): intentId is string =>
  typeof intentId === "string" &&
  intentId.startsWith(`${accountId}:`) &&
  isStarkFieldElement(intentId.slice(accountId.length + 1));

const isRemovedIntents = (value: unknown): value is RemovedIntents =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "intentIds"]) &&
  isAccountId(value["accountId"]) &&
  Array.isArray(value["intentIds"]) &&
  value["intentIds"].length <= MAX_REMOVED_INTENTS &&
  value["intentIds"].every((id) => isIntentIdFor(String(value["accountId"]), id));

const readRemovedIntents = async (store: KeyValueStore): Promise<readonly RemovedIntents[]> => {
  const stored = await store.get(NOSTR_REMOVED_INTENTS_STORE_KEY);
  return Array.isArray(stored)
    ? stored.filter(isRemovedIntents).slice(0, MAX_REMOVED_ACCOUNTS)
    : [];
};

const isRelaySelection = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 2 &&
  new Set(value).size === value.length &&
  value.every(isNostrRelayUrl);

const isCheckpoint = (value: unknown): value is NostrSyncCheckpoint =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "eventIds", "relayUrls", "syncedAt"]) &&
  isAccountId(value["accountId"]) &&
  Array.isArray(value["eventIds"]) &&
  value["eventIds"].length <= MAX_SEEN_EVENT_IDS &&
  new Set(value["eventIds"]).size === value["eventIds"].length &&
  value["eventIds"].every(isNostrEventId) &&
  isRelaySelection(value["relayUrls"]) &&
  Number.isSafeInteger(value["syncedAt"]) &&
  Number(value["syncedAt"]) >= 0 &&
  Number(value["syncedAt"]) <= MAX_SYNC_SECONDS;

const sameRelays = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((relay, index) => relay === right[index]);

const readCheckpoints = async (store: KeyValueStore): Promise<readonly NostrSyncCheckpoint[]> => {
  const stored = await store.get(NOSTR_COORDINATION_STORE_KEY);
  return Array.isArray(stored) ? stored.filter(isCheckpoint).slice(0, MAX_CHECKPOINTS) : [];
};

const createMethods = (store: KeyValueStore): NostrCoordinationStore => ({
  async getCheckpoint(accountId, relayUrls) {
    if (!isAccountId(accountId) || !isRelaySelection(relayUrls)) return null;
    return (
      (await readCheckpoints(store)).find(
        (checkpoint) =>
          checkpoint.accountId === accountId && sameRelays(checkpoint.relayUrls, relayUrls),
      ) ?? null
    );
  },
  async recordSync(checkpoint, isAuthorized = () => true) {
    if (!isAuthorized()) return "unauthorized";
    if (!isCheckpoint(checkpoint)) return "invalid";
    const current = await readCheckpoints(store);
    const existing = current.find((stored) => stored.accountId === checkpoint.accountId);
    const eventIds = [
      ...new Set([
        ...checkpoint.eventIds,
        ...(existing && sameRelays(existing.relayUrls, checkpoint.relayUrls)
          ? existing.eventIds
          : []),
      ]),
    ].slice(0, MAX_SEEN_EVENT_IDS);
    const next = {
      ...checkpoint,
      eventIds,
    };
    if (!isAuthorized()) return "unauthorized";
    await store.set(
      NOSTR_COORDINATION_STORE_KEY,
      [next, ...current.filter((stored) => stored.accountId !== checkpoint.accountId)].slice(
        0,
        MAX_CHECKPOINTS,
      ),
    );
    return "stored";
  },
  async recordRemovedIntent(accountId, intentId, isAuthorized = () => true) {
    if (!isAuthorized()) return "unauthorized";
    if (!isAccountId(accountId) || !isIntentIdFor(accountId, intentId)) return "invalid";
    const current = await readRemovedIntents(store);
    const existing = current.find((entry) => entry.accountId === accountId);
    const intentIds = [intentId, ...(existing?.intentIds ?? []).filter((id) => id !== intentId)];
    const next: RemovedIntents = { accountId, intentIds: intentIds.slice(0, MAX_REMOVED_INTENTS) };
    if (!isAuthorized()) return "unauthorized";
    await store.set(
      NOSTR_REMOVED_INTENTS_STORE_KEY,
      [next, ...current.filter((entry) => entry.accountId !== accountId)].slice(
        0,
        MAX_REMOVED_ACCOUNTS,
      ),
    );
    return "stored";
  },
  async isRemovedIntent(accountId, intentId) {
    if (!isAccountId(accountId) || !isIntentIdFor(accountId, intentId)) return false;
    return (await readRemovedIntents(store)).some(
      (entry) => entry.accountId === accountId && entry.intentIds.includes(intentId),
    );
  },
});

/** Creates a serialized browser-local coordination receipt store. */
export const createNostrCoordinationStore = ({
  store,
}: {
  readonly store: KeyValueStore;
}): NostrCoordinationStore =>
  serializeStoreMutations(createMethods(store), ["getCheckpoint", "isRemovedIntent"]);

/** Creates isolated volatile receipts for tests and explicit fallback wiring. */
export const memoryNostrCoordinationStore = (): NostrCoordinationStore =>
  createNostrCoordinationStore({ store: createMemoryStore() });
