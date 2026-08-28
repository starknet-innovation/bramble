/** Bounded one-shot Nostr relay transport for multisig coordination. */
import {
  isNostrEvent,
  isNostrPublicKey,
  isNostrRelayUrl,
  MAX_NOSTR_BATCH_ITEMS,
  type NostrEvent,
  parseNostrEventJson,
} from "@mc-wallet/wallet-model/nostr";

const RELAY_TIMEOUT_MS = 8_000;
const MAX_RELAY_FRAME_BYTES = 140_000;

/** Reviewed defaults used unless the user explicitly replaces them in settings. */
export const MULTISIG_NOSTR_RELAYS = ["wss://relay.primal.net", "wss://nos.lol"] as const;

type RelaySocket = Pick<
  WebSocket,
  "close" | "onclose" | "onerror" | "onmessage" | "onopen" | "send"
>;

/** Injectable WebSocket constructor used only by deterministic transport tests. */
export type RelaySocketFactory = (url: string) => RelaySocket;

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

/** One recipient-bound gift wrap awaiting relay acknowledgement. */
export type NostrGiftWrapDelivery = {
  readonly eventJson: string;
  readonly recipientPublicKey: string;
};

const nativeSocket: RelaySocketFactory = (url) => new WebSocket(url);

const relayOptions = (
  options: NostrRelayOptions,
): { readonly relayUrls: readonly string[]; readonly socketFactory: RelaySocketFactory } => {
  const relayUrls = options.relayUrls ?? MULTISIG_NOSTR_RELAYS;
  if (
    relayUrls.length === 0 ||
    relayUrls.length > MULTISIG_NOSTR_RELAYS.length ||
    new Set(relayUrls).size !== relayUrls.length ||
    !relayUrls.every(isNostrRelayUrl)
  ) {
    throw new Error("Invalid Nostr relay configuration");
  }
  return { relayUrls, socketFactory: options.socketFactory ?? nativeSocket };
};

const parseFrame = (value: unknown): readonly unknown[] | null => {
  if (
    typeof value !== "string" ||
    value.length > MAX_RELAY_FRAME_BYTES ||
    new TextEncoder().encode(value).length > MAX_RELAY_FRAME_BYTES
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length <= 4 ? parsed : null;
  } catch {
    return null;
  }
};

const hasRecipientTag = (event: NostrEvent, recipientPublicKey: string): boolean =>
  event.tags.some((tag) => tag.length >= 2 && tag[0] === "p" && tag[1] === recipientPublicKey);

const readSyncFrame = (
  value: unknown,
  subscriptionId: string,
  recipientPublicKey: string,
): NostrEvent | "closed" | "eose" | null => {
  const frame = parseFrame(value);
  if (!frame || frame[1] !== subscriptionId) return null;
  if (frame[0] === "EOSE") return "eose";
  if (frame[0] === "CLOSED") return "closed";
  return frame[0] === "EVENT" &&
    isNostrEvent(frame[2]) &&
    frame[2].kind === 1_059 &&
    hasRecipientTag(frame[2], recipientPublicKey)
    ? frame[2]
    : null;
};

const publishToRelay = (
  relay: string,
  events: readonly NostrEvent[],
  socketFactory: RelaySocketFactory,
): Promise<ReadonlySet<string>> =>
  new Promise((resolve) => {
    const socket = socketFactory(relay);
    const pending = new Set(events.map((event) => event.id));
    const accepted = new Set<string>();
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      resolve(accepted);
    };
    const timeout = setTimeout(finish, RELAY_TIMEOUT_MS);
    socket.onopen = () => {
      for (const event of events) socket.send(JSON.stringify(["EVENT", event]));
    };
    socket.onmessage = ({ data }) => {
      const frame = parseFrame(data);
      const eventId = frame?.[1];
      if (
        frame?.[0] !== "OK" ||
        typeof eventId !== "string" ||
        typeof frame[2] !== "boolean" ||
        !pending.delete(eventId)
      ) {
        return;
      }
      if (frame[2]) accepted.add(eventId);
      if (pending.size === 0) finish();
    };
    socket.onerror = finish;
    socket.onclose = finish;
  });

const parsedGiftWraps = (giftWraps: readonly NostrGiftWrapDelivery[]): readonly NostrEvent[] => {
  if (giftWraps.length === 0 || giftWraps.length > MAX_NOSTR_BATCH_ITEMS) {
    throw new Error("Invalid Nostr gift wrap batch");
  }
  const events = giftWraps.map(({ eventJson, recipientPublicKey }) => {
    const event = parseNostrEventJson(eventJson);
    if (
      !isNostrPublicKey(recipientPublicKey) ||
      event?.kind !== 1_059 ||
      !hasRecipientTag(event, recipientPublicKey)
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

/** Publishes recipient gift wraps over one connection per relay, preserving per-recipient acks. */
export const publishManyNostrGiftWraps = async (
  giftWraps: readonly NostrGiftWrapDelivery[],
  options: NostrRelayOptions = {},
): Promise<readonly number[]> => {
  const { relayUrls, socketFactory } = relayOptions(options);
  const events = parsedGiftWraps(giftWraps);
  const results = await Promise.allSettled(
    relayUrls.map((relay) => publishToRelay(relay, events, socketFactory)),
  );
  const acknowledgements = events.map(
    (event) =>
      results.filter((result) => result.status === "fulfilled" && result.value.has(event.id))
        .length,
  );
  if (acknowledgements.every((count) => count === 0)) {
    throw new Error("Nostr relays are unavailable");
  }
  return acknowledgements;
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

const syncRelay = (
  relay: string,
  recipientPublicKey: string,
  since: number,
  socketFactory: RelaySocketFactory,
): Promise<readonly NostrEvent[]> =>
  new Promise((resolve, reject) => {
    const socket = socketFactory(relay);
    const events: NostrEvent[] = [];
    const subscriptionId = `mcw-${recipientPublicKey.slice(0, 8)}-${since}`;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      error && events.length === 0 ? reject(error) : resolve(events);
    };
    const timeout = setTimeout(
      () => finish(new Error("Nostr relay sync timed out")),
      RELAY_TIMEOUT_MS,
    );
    socket.onopen = () =>
      socket.send(
        JSON.stringify([
          "REQ",
          subscriptionId,
          { "#p": [recipientPublicKey], kinds: [1_059], limit: MAX_NOSTR_BATCH_ITEMS, since },
        ]),
      );
    socket.onmessage = ({ data }) => {
      const frame = readSyncFrame(data, subscriptionId, recipientPublicKey);
      if (frame === "eose") {
        try {
          socket.send(JSON.stringify(["CLOSE", subscriptionId]));
        } finally {
          finish();
        }
        return;
      }
      if (frame === "closed") {
        finish(new Error("Nostr relay refused the subscription"));
        return;
      }
      if (frame && events.length < MAX_NOSTR_BATCH_ITEMS) events.push(frame);
    };
    socket.onerror = () => finish(new Error("Nostr relay connection failed"));
    socket.onclose = () => finish(new Error("Nostr relay closed before completing sync"));
  });

/** Reads recent recipient-specific gift wraps once, then closes every relay. */
export const syncNostrGiftWraps = async (
  recipientPublicKey: string,
  since: number,
  options: NostrRelayOptions = {},
): Promise<readonly NostrEvent[]> => {
  const { relayUrls, socketFactory } = relayOptions(options);
  if (!isNostrPublicKey(recipientPublicKey) || !Number.isSafeInteger(since) || since < 0) {
    throw new Error("Invalid Nostr sync request");
  }
  const results = await Promise.allSettled(
    relayUrls.map((relay) => syncRelay(relay, recipientPublicKey, since, socketFactory)),
  );
  const successful = results.filter(
    (result): result is PromiseFulfilledResult<readonly NostrEvent[]> =>
      result.status === "fulfilled",
  );
  if (successful.length === 0) throw new Error("Nostr relays are unavailable");
  return [
    ...new Map(
      successful.flatMap((result) => result.value).map((event) => [event.id, event]),
    ).values(),
  ]
    .sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))
    .slice(0, MAX_NOSTR_BATCH_ITEMS);
};

/** Production adapter over native one-shot WebSocket operations. */
export const nativeNostrRelayTransport: NostrRelayTransport = {
  publish: (eventJson, recipientPublicKey, relayUrls) =>
    publishNostrGiftWrap(eventJson, recipientPublicKey, { relayUrls }),
  publishMany: (giftWraps, relayUrls) => publishManyNostrGiftWraps(giftWraps, { relayUrls }),
  sync: (recipientPublicKey, since, relayUrls) =>
    syncNostrGiftWraps(recipientPublicKey, since, { relayUrls }),
};
