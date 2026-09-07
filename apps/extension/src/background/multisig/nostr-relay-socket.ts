/** Shared, bounded WebSocket connections for Nostr relay operations. */
import { isNostrEvent, MAX_NOSTR_BATCH_ITEMS, type NostrEvent } from "@bramble/wallet-model/nostr";

const RELAY_TIMEOUT_MS = 8_000;
const MAX_RELAY_FRAME_BYTES = 140_000;

/** Minimal native socket surface required by the relay pool. */
type RelaySocket = Pick<
  WebSocket,
  "close" | "onclose" | "onerror" | "onmessage" | "onopen" | "send"
>;

/** Injectable WebSocket constructor used only by deterministic transport tests. */
export type RelaySocketFactory = (url: string) => RelaySocket;

type PendingAck = {
  readonly promise: Promise<boolean>;
  readonly resolve: (accepted: boolean) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
};

type PendingSubscription = {
  readonly events: NostrEvent[];
  frames: number;
  readonly recipientPublicKey: string;
  readonly reject: (error: Error) => void;
  readonly resolve: (events: readonly NostrEvent[]) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
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

/** Returns whether a gift wrap is explicitly addressed to the requested recipient. */
export const hasNostrRecipientTag = (event: NostrEvent, recipientPublicKey: string): boolean =>
  event.tags.some((tag) => tag.length >= 2 && tag[0] === "p" && tag[1] === recipientPublicKey);

class RelayConnection {
  readonly #acks = new Map<string, PendingAck>();
  #closed = false;
  readonly #connectTimeout: ReturnType<typeof setTimeout>;
  #idleTimeout: ReturnType<typeof setTimeout> | null = null;
  readonly #onDiscard: () => void;
  readonly #ready: Promise<void>;
  readonly #rejectReady: (error: Error) => void;
  readonly #resolveReady: () => void;
  readonly #socket: RelaySocket;
  readonly #subscriptions = new Map<string, PendingSubscription>();
  #subscriptionSequence = 0;

  constructor(
    url: string,
    socketFactory: RelaySocketFactory,
    readonly idleMs: number,
    onDiscard: () => void,
  ) {
    this.#onDiscard = onDiscard;
    let resolveReady = (): void => {};
    let rejectReady = (_error: Error): void => {};
    this.#ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.#resolveReady = resolveReady;
    this.#rejectReady = rejectReady;
    this.#socket = socketFactory(url);
    this.#connectTimeout = setTimeout(
      () => this.#fail(new Error("Nostr relay connection timed out")),
      RELAY_TIMEOUT_MS,
    );
    this.#socket.onopen = () => {
      if (this.#closed) return;
      clearTimeout(this.#connectTimeout);
      this.#resolveReady();
    };
    this.#socket.onmessage = ({ data }) => this.#read(data);
    this.#socket.onerror = () => this.#fail(new Error("Nostr relay connection failed"));
    this.#socket.onclose = () => this.#fail(new Error("Nostr relay connection closed"));
  }

  async publish(events: readonly NostrEvent[]): Promise<ReadonlySet<string>> {
    await this.#ready;
    this.#cancelIdleClose();
    const pending = events.map((event) => ({ event, ...this.#ackFor(event.id) }));
    for (const { event, send } of pending) {
      if (!send) continue;
      try {
        this.#socket.send(JSON.stringify(["EVENT", event]));
      } catch {
        this.#fail(new Error("Nostr relay publish failed"));
        break;
      }
    }
    const accepted = await Promise.all(pending.map(({ promise }) => promise));
    return new Set(events.filter((_, index) => accepted[index]).map((event) => event.id));
  }

  async sync(recipientPublicKey: string, since: number): Promise<readonly NostrEvent[]> {
    await this.#ready;
    this.#cancelIdleClose();
    const subscriptionId = `mcw-${(++this.#subscriptionSequence).toString(36)}`;
    const result = new Promise<readonly NostrEvent[]>((resolve, reject) => {
      const timeout = setTimeout(
        () => this.#finishSubscription(subscriptionId, new Error("Nostr relay sync timed out")),
        RELAY_TIMEOUT_MS,
      );
      this.#subscriptions.set(subscriptionId, {
        events: [],
        frames: 0,
        recipientPublicKey,
        reject,
        resolve,
        timeout,
      });
    });
    try {
      this.#socket.send(
        JSON.stringify([
          "REQ",
          subscriptionId,
          { "#p": [recipientPublicKey], kinds: [1_059], limit: MAX_NOSTR_BATCH_ITEMS, since },
        ]),
      );
    } catch {
      this.#finishSubscription(subscriptionId, new Error("Nostr relay sync failed"));
    }
    return result;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#connectTimeout);
    if (this.#idleTimeout) clearTimeout(this.#idleTimeout);
    for (const pending of this.#acks.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(false);
    }
    this.#acks.clear();
    for (const [subscriptionId] of this.#subscriptions) {
      this.#finishSubscription(subscriptionId, new Error("Nostr relay connection closed"));
    }
    this.#socket.close();
    this.#onDiscard();
  }

  #ackFor(eventId: string): { readonly promise: Promise<boolean>; readonly send: boolean } {
    const existing = this.#acks.get(eventId);
    if (existing) return { promise: existing.promise, send: false };
    let resolve = (_accepted: boolean): void => {};
    const promise = new Promise<boolean>((settle) => {
      resolve = settle;
    });
    const timeout = setTimeout(() => this.#finishAck(eventId, false), RELAY_TIMEOUT_MS);
    this.#acks.set(eventId, { promise, resolve, timeout });
    return { promise, send: true };
  }

  #fail(error: Error): void {
    if (this.#closed) return;
    clearTimeout(this.#connectTimeout);
    this.#rejectReady(error);
    for (const eventId of this.#acks.keys()) this.#finishAck(eventId, false);
    for (const [subscriptionId] of this.#subscriptions) {
      this.#finishSubscription(subscriptionId, error);
    }
    this.close();
  }

  #cancelIdleClose(): void {
    if (!this.#idleTimeout) return;
    clearTimeout(this.#idleTimeout);
    this.#idleTimeout = null;
  }

  #finishAck(eventId: string, accepted: boolean): void {
    const pending = this.#acks.get(eventId);
    if (!pending) return;
    this.#acks.delete(eventId);
    clearTimeout(pending.timeout);
    pending.resolve(accepted);
    this.#scheduleIdleClose();
  }

  #finishSubscription(subscriptionId: string, error?: Error): void {
    const pending = this.#subscriptions.get(subscriptionId);
    if (!pending) return;
    this.#subscriptions.delete(subscriptionId);
    clearTimeout(pending.timeout);
    if (error && pending.events.length === 0) pending.reject(error);
    else pending.resolve(pending.events);
    this.#scheduleIdleClose();
  }

  #read(value: unknown): void {
    const frame = parseFrame(value);
    if (!frame) return;
    if (frame[0] === "OK") {
      const eventId = frame[1];
      const message = frame[3];
      if (typeof eventId !== "string" || typeof frame[2] !== "boolean") return;
      const duplicate =
        frame[2] === false &&
        typeof message === "string" &&
        message.toLowerCase().startsWith("duplicate:");
      this.#finishAck(eventId, frame[2] || duplicate);
      return;
    }
    this.#readSubscription(frame);
  }

  #readSubscription(frame: readonly unknown[]): void {
    const subscriptionId = frame[1];
    if (typeof subscriptionId !== "string") return;
    const pending = this.#subscriptions.get(subscriptionId);
    if (!pending) return;
    if (frame[0] === "EOSE") {
      try {
        this.#socket.send(JSON.stringify(["CLOSE", subscriptionId]));
      } finally {
        this.#finishSubscription(subscriptionId);
      }
      return;
    }
    if (frame[0] === "CLOSED") {
      this.#finishSubscription(subscriptionId, new Error("Nostr relay refused the subscription"));
      return;
    }
    if (frame[0] !== "EVENT") return;
    pending.frames += 1;
    if (
      isNostrEvent(frame[2]) &&
      frame[2].kind === 1_059 &&
      hasNostrRecipientTag(frame[2], pending.recipientPublicKey)
    ) {
      pending.events.push(frame[2]);
    }
    if (pending.frames >= MAX_NOSTR_BATCH_ITEMS) {
      try {
        this.#socket.send(JSON.stringify(["CLOSE", subscriptionId]));
      } finally {
        this.#finishSubscription(subscriptionId);
      }
    }
  }

  #scheduleIdleClose(): void {
    if (this.#acks.size > 0 || this.#subscriptions.size > 0 || this.#closed) return;
    this.#cancelIdleClose();
    this.#idleTimeout = setTimeout(() => {
      this.#idleTimeout = null;
      if (this.#acks.size === 0 && this.#subscriptions.size === 0) this.close();
    }, this.idleMs);
  }
}

/** Reuses one native WebSocket per relay and coalesces identical in-flight syncs. */
export const createNostrRelayPool = (socketFactory: RelaySocketFactory, idleMs: number) => {
  const connections = new Map<string, RelayConnection>();
  const syncs = new Map<string, Promise<readonly NostrEvent[]>>();
  const connectionFor = (relay: string): RelayConnection => {
    const existing = connections.get(relay);
    if (existing) return existing;
    let connection: RelayConnection;
    connection = new RelayConnection(relay, socketFactory, idleMs, () => {
      if (connections.get(relay) === connection) connections.delete(relay);
    });
    connections.set(relay, connection);
    return connection;
  };
  return {
    close(): void {
      for (const connection of [...connections.values()]) connection.close();
      connections.clear();
      syncs.clear();
    },
    async publish(relay: string, events: readonly NostrEvent[]): Promise<ReadonlySet<string>> {
      return connectionFor(relay).publish(events);
    },
    async sync(
      relay: string,
      recipientPublicKey: string,
      since: number,
    ): Promise<readonly NostrEvent[]> {
      const key = `${relay}|${recipientPublicKey}|${since}`;
      const existing = syncs.get(key);
      if (existing) return existing;
      const sync = connectionFor(relay)
        .sync(recipientPublicKey, since)
        .finally(() => syncs.delete(key));
      syncs.set(key, sync);
      return sync;
    },
  };
};
