/** Durable public sync receipts for encrypted multisig coordination. */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { createMemoryStore, type KeyValueStore } from "@mc-wallet/store/kv";
import { serializeStoreMutations } from "@mc-wallet/store/mutation";
import { isAccountId } from "@mc-wallet/wallet-model/accounts";
import { isNostrEventId, isNostrRelayUrl } from "@mc-wallet/wallet-model/nostr";

/** Browser-local key for non-secret relay sync metadata. */
export const NOSTR_COORDINATION_STORE_KEY = "mc-wallet:nostr-coordination:v1";

const MAX_CHECKPOINTS = 20;
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
});

/** Creates a serialized browser-local coordination receipt store. */
export const createNostrCoordinationStore = ({
  store,
}: {
  readonly store: KeyValueStore;
}): NostrCoordinationStore => serializeStoreMutations(createMethods(store), ["getCheckpoint"]);

/** Creates isolated volatile receipts for tests and explicit fallback wiring. */
export const memoryNostrCoordinationStore = (): NostrCoordinationStore =>
  createNostrCoordinationStore({ store: createMemoryStore() });
