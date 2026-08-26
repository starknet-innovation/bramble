/** Bounded one-shot Nostr relay transport for multisig coordination. */
import {
  isNostrEvent,
  isNostrPublicKey,
  type NostrEvent,
  parseNostrEventJson,
} from "@mc-wallet/wallet-model/nostr";

const RELAY_TIMEOUT_MS = 8_000;
const MAX_RELAY_FRAME_BYTES = 140_000;
const MAX_EVENTS_PER_RELAY = 50;

/** Fixed reviewed relays. Contacts cannot expand the extension's network reach. */
export const MULTISIG_NOSTR_RELAYS = ["wss://relay.primal.net", "wss://nos.lol"] as const;

type RelaySocket = Pick<
  WebSocket,
  "close" | "onclose" | "onerror" | "onmessage" | "onopen" | "send"
>;

/** Injectable WebSocket constructor used only by deterministic transport tests. */
export type RelaySocketFactory = (url: string) => RelaySocket;

const nativeSocket: RelaySocketFactory = (url) => new WebSocket(url);

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
): NostrEvent | "eose" | null => {
  const frame = parseFrame(value);
  if (!frame || frame[1] !== subscriptionId) return null;
  if (frame[0] === "EOSE") return "eose";
  return frame[0] === "EVENT" &&
    isNostrEvent(frame[2]) &&
    frame[2].kind === 1_059 &&
    hasRecipientTag(frame[2], recipientPublicKey)
    ? frame[2]
    : null;
};

const publishToRelay = (
  relay: string,
  event: NostrEvent,
  socketFactory: RelaySocketFactory,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = socketFactory(relay);
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      error ? reject(error) : resolve();
    };
    const timeout = setTimeout(
      () => finish(new Error("Nostr relay publish timed out")),
      RELAY_TIMEOUT_MS,
    );
    socket.onopen = () => socket.send(JSON.stringify(["EVENT", event]));
    socket.onmessage = ({ data }) => {
      const frame = parseFrame(data);
      if (frame?.[0] !== "OK" || frame[1] !== event.id || typeof frame[2] !== "boolean") return;
      finish(frame[2] ? undefined : new Error("Nostr relay refused the event"));
    };
    socket.onerror = () => finish(new Error("Nostr relay connection failed"));
    socket.onclose = () => finish(new Error("Nostr relay closed before acknowledging the event"));
  });

/** Publishes one already-signed NIP-59 gift wrap to the fixed relay set. */
export const publishNostrGiftWrap = async (
  eventJson: string,
  recipientPublicKey: string,
  socketFactory: RelaySocketFactory = nativeSocket,
): Promise<number> => {
  const event = parseNostrEventJson(eventJson);
  if (
    !isNostrPublicKey(recipientPublicKey) ||
    event?.kind !== 1_059 ||
    !hasRecipientTag(event, recipientPublicKey)
  ) {
    throw new Error("Invalid Nostr gift wrap");
  }
  const results = await Promise.allSettled(
    MULTISIG_NOSTR_RELAYS.map((relay) => publishToRelay(relay, event, socketFactory)),
  );
  const published = results.filter((result) => result.status === "fulfilled").length;
  if (published === 0) throw new Error("Nostr relays are unavailable");
  return published;
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
      error ? reject(error) : resolve(events);
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
          { "#p": [recipientPublicKey], kinds: [1_059], limit: MAX_EVENTS_PER_RELAY, since },
        ]),
      );
    socket.onmessage = ({ data }) => {
      const frame = readSyncFrame(data, subscriptionId, recipientPublicKey);
      if (frame === "eose") {
        finish();
        return;
      }
      if (frame && events.length < MAX_EVENTS_PER_RELAY) events.push(frame);
    };
    socket.onerror = () => finish(new Error("Nostr relay connection failed"));
    socket.onclose = () => finish(new Error("Nostr relay closed before completing sync"));
  });

/** Reads recent recipient-specific gift wraps once, then closes every relay. */
export const syncNostrGiftWraps = async (
  recipientPublicKey: string,
  since: number,
  socketFactory: RelaySocketFactory = nativeSocket,
): Promise<readonly NostrEvent[]> => {
  if (!isNostrPublicKey(recipientPublicKey) || !Number.isSafeInteger(since) || since < 0) {
    throw new Error("Invalid Nostr sync request");
  }
  const results = await Promise.allSettled(
    MULTISIG_NOSTR_RELAYS.map((relay) =>
      syncRelay(relay, recipientPublicKey, since, socketFactory),
    ),
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
  ].slice(0, MAX_EVENTS_PER_RELAY);
};
