/** Bounded Nostr relay transport for encrypted multisig coordination. */
import {
  isNostrPublicKey,
  isNostrRelayUrl,
  MAX_NOSTR_BATCH_ITEMS,
  type NostrEvent,
  parseNostrEventJson,
} from "@mc-wallet/wallet-model/nostr";
import {
  createNostrRelayPool,
  hasNostrRecipientTag,
  type RelaySocketFactory,
} from "./nostr-relay-socket";

const RELAY_IDLE_MS = 20_000;

/** Reviewed defaults used unless the user explicitly replaces them in settings. */
export const MULTISIG_NOSTR_RELAYS = ["wss://relay.primal.net", "wss://nos.lol"] as const;

/** Injectable WebSocket constructor used by deterministic transport tests. */
export type { RelaySocketFactory } from "./nostr-relay-socket";

/** Optional transport seam used for custom settings and deterministic tests. */
export type NostrRelayOptions = {
  readonly relayUrls?: readonly string[];
  readonly socketFactory?: RelaySocketFactory;
};

/** Narrow relay capability injected into coordination tests; it never handles plaintext. */
export type NostrRelayTransport = {
  readonly publish: (
    eventJson: string,
    recipientPublicKey: string,
    relayUrls: readonly string[],
  ) => Promise<number>;
  readonly publishMany?: (
    giftWraps: readonly NostrGiftWrapDelivery[],
    relayUrls: readonly string[],
  ) => Promise<readonly number[]>;
  readonly sync: (
    recipientPublicKey: string,
    since: number,
    relayUrls: readonly string[],
  ) => Promise<readonly NostrEvent[]>;
};

/** Managed production transport whose pooled sockets can be explicitly released. */
export type ManagedNostrRelayTransport = NostrRelayTransport & { readonly close: () => void };

/** One recipient-bound gift wrap awaiting relay acknowledgement. */
export type NostrGiftWrapDelivery = {
  readonly eventJson: string;
  readonly recipientPublicKey: string;
};

const nativeSocket: RelaySocketFactory = (url) => new WebSocket(url);

const validRelayUrls = (relayUrls: readonly string[]): readonly string[] => {
  if (
    relayUrls.length === 0 ||
    relayUrls.length > MULTISIG_NOSTR_RELAYS.length ||
    new Set(relayUrls).size !== relayUrls.length ||
    !relayUrls.every(isNostrRelayUrl)
  ) {
    throw new Error("Invalid Nostr relay configuration");
  }
  return relayUrls;
};

const parsedGiftWraps = (giftWraps: readonly NostrGiftWrapDelivery[]): readonly NostrEvent[] => {
  if (giftWraps.length === 0 || giftWraps.length > MAX_NOSTR_BATCH_ITEMS) {
    throw new Error("Invalid Nostr gift wrap batch");
  }
  const events = giftWraps.map(({ eventJson, recipientPublicKey }) => {
    const event = parseNostrEventJson(eventJson);
    if (
      !isNostrPublicKey(recipientPublicKey) ||
      event?.kind !== 1_059 ||
      !hasNostrRecipientTag(event, recipientPublicKey)
    ) {
      throw new Error("Invalid Nostr gift wrap");
    }
    return event;
  });
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    throw new Error("Invalid Nostr gift wrap batch");
  }
  return events;
};

const publishWithPool = async (
  pool: ReturnType<typeof createNostrRelayPool>,
  giftWraps: readonly NostrGiftWrapDelivery[],
  relayUrls: readonly string[],
  returnWhenDurable: boolean,
): Promise<readonly number[]> => {
  const events = parsedGiftWraps(giftWraps);
  const pending = new Map(
    validRelayUrls(relayUrls).map((relay, index) => [
      index,
      pool
        .publish(relay, events)
        .then((accepted) => ({ accepted, index }))
        .catch(() => ({ accepted: new Set<string>(), index })),
    ]),
  );
  const acknowledgements = events.map(() => 0);
  while (pending.size > 0) {
    const result = await Promise.race(pending.values());
    pending.delete(result.index);
    for (const [eventIndex, event] of events.entries()) {
      const current = acknowledgements[eventIndex];
      if (current !== undefined && result.accepted.has(event.id)) {
        acknowledgements[eventIndex] = current + 1;
      }
    }
    if (returnWhenDurable && acknowledgements.every((count) => count > 0)) {
      return acknowledgements;
    }
  }
  if (acknowledgements.every((count) => count === 0)) {
    throw new Error("Nostr relays are unavailable");
  }
  return acknowledgements;
};

const boundedRelayCandidates = (
  eventsByRelay: readonly (readonly NostrEvent[])[],
): readonly NostrEvent[] => {
  const candidates: NostrEvent[] = [];
  for (let index = 0; candidates.length < MAX_NOSTR_BATCH_ITEMS; index += 1) {
    let added = false;
    for (const events of eventsByRelay) {
      const event = events[index];
      if (!event) continue;
      candidates.push(event);
      added = true;
      if (candidates.length === MAX_NOSTR_BATCH_ITEMS) break;
    }
    if (!added) break;
  }
  return candidates;
};

const syncWithPool = async (
  pool: ReturnType<typeof createNostrRelayPool>,
  recipientPublicKey: string,
  since: number,
  relayUrls: readonly string[],
): Promise<readonly NostrEvent[]> => {
  if (!isNostrPublicKey(recipientPublicKey) || !Number.isSafeInteger(since) || since < 0) {
    throw new Error("Invalid Nostr sync request");
  }
  const results = await Promise.allSettled(
    validRelayUrls(relayUrls).map((relay) => pool.sync(relay, recipientPublicKey, since)),
  );
  const successful = results.filter(
    (result): result is PromiseFulfilledResult<readonly NostrEvent[]> =>
      result.status === "fulfilled",
  );
  if (successful.length === 0) throw new Error("Nostr relays are unavailable");
  // Relay-provided ids are untrusted until Krusty authenticates each wrap.
  // Round-robin the bounded relay results so one hostile relay cannot fill the
  // authentication batch or suppress a same-id candidate from another relay.
  return [...boundedRelayCandidates(successful.map((result) => result.value))].sort(
    (left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id),
  );
};

/** Creates one opportunistically pooled transport without any keepalive traffic. */
export const createNostrRelayTransport = (
  options: { readonly idleMs?: number; readonly socketFactory?: RelaySocketFactory } = {},
): ManagedNostrRelayTransport => {
  const idleMs = options.idleMs ?? RELAY_IDLE_MS;
  if (!Number.isSafeInteger(idleMs) || idleMs < 0 || idleMs > 60_000) {
    throw new Error("Invalid Nostr relay idle timeout");
  }
  const pool = createNostrRelayPool(options.socketFactory ?? nativeSocket, idleMs);
  return {
    close: () => pool.close(),
    async publish(eventJson, recipientPublicKey, relayUrls) {
      const published = await publishWithPool(
        pool,
        [{ eventJson, recipientPublicKey }],
        relayUrls,
        true,
      );
      return published[0] ?? 0;
    },
    publishMany: (giftWraps, relayUrls) => publishWithPool(pool, giftWraps, relayUrls, true),
    sync: (recipientPublicKey, since, relayUrls) =>
      syncWithPool(pool, recipientPublicKey, since, relayUrls),
  };
};

/** Publishes recipient gift wraps and waits for every selected relay in isolated calls/tests. */
export const publishManyNostrGiftWraps = async (
  giftWraps: readonly NostrGiftWrapDelivery[],
  options: NostrRelayOptions = {},
): Promise<readonly number[]> => {
  const pool = createNostrRelayPool(options.socketFactory ?? nativeSocket, 0);
  try {
    return await publishWithPool(
      pool,
      giftWraps,
      options.relayUrls ?? MULTISIG_NOSTR_RELAYS,
      false,
    );
  } finally {
    pool.close();
  }
};

/** Publishes one already-signed NIP-59 gift wrap to the selected relay set. */
export const publishNostrGiftWrap = async (
  eventJson: string,
  recipientPublicKey: string,
  options: NostrRelayOptions = {},
): Promise<number> => {
  const published = await publishManyNostrGiftWraps([{ eventJson, recipientPublicKey }], options);
  return published[0] ?? 0;
};

/** Reads recent recipient-specific gift wraps over isolated sockets for deterministic callers. */
export const syncNostrGiftWraps = async (
  recipientPublicKey: string,
  since: number,
  options: NostrRelayOptions = {},
): Promise<readonly NostrEvent[]> => {
  const pool = createNostrRelayPool(options.socketFactory ?? nativeSocket, 0);
  try {
    return await syncWithPool(
      pool,
      recipientPublicKey,
      since,
      options.relayUrls ?? MULTISIG_NOSTR_RELAYS,
    );
  } finally {
    pool.close();
  }
};

/** Production adapter: one shared WebSocket per relay, closed after a short quiet period. */
export const nativeNostrRelayTransport: NostrRelayTransport = createNostrRelayTransport();
