/**
 * WebSocket client for Extended's public streams. Extended uses URL-path
 * subscription (one socket per stream at the channel URL — no JSON subscribe
 * frame), so `connectStream` opens a single connection, parses the
 * `{type,data,error,ts,seq}` envelope, and hands each frame to the caller. It
 * reconnects with exponential backoff, tears down cleanly, and degrades to a
 * no-op (reporting `closed`) when no `WebSocket` implementation is available
 * (e.g. jsdom under test) so callers can fall back to REST polling.
 *
 * `createOrderBookAggregator` maintains a live merged book: it seeds from a
 * SNAPSHOT (REST or WS), applies DELTAs in `seq` order (a level with qty 0 is
 * removed), and drops stale/duplicate deltas.
 */
import { parseOrderBook, parseStreamMessage } from "./parse";
import type { ExtendedOrderBook, StreamEnvelope } from "./types";

/** Connection status surfaced to callers so hooks can drive a REST fallback. */
export type StreamStatus = "connecting" | "open" | "closed";

/** Handle returned by `connectStream`; `close()` is idempotent. */
export type StreamHandle = {
  readonly close: () => void;
};

/** Options for opening a single stream connection. */
export type ConnectStreamOptions = {
  readonly url: string;
  /** Called for every decoded envelope frame. */
  readonly onMessage: (envelope: StreamEnvelope) => void;
  /** Called on socket/parse errors (non-fatal — a reconnect is scheduled). */
  readonly onError?: (message: string) => void;
  /** Called whenever the connection status changes. */
  readonly onStatus?: (status: StreamStatus) => void;
  /** Override the WebSocket constructor (tests inject a fake). */
  readonly WebSocketCtor?: typeof WebSocket;
  /** Initial reconnect delay in ms (doubles each attempt). Default 500. */
  readonly baseBackoffMs?: number;
  /** Max reconnect delay in ms. Default 15000. */
  readonly maxBackoffMs?: number;
};

/**
 * Opens a stream connection with automatic reconnect/backoff. Returns a handle
 * whose `close()` stops reconnection and tears down the socket. When no
 * `WebSocket` is available the handle is inert and `closed` is reported so the
 * caller can rely on REST polling instead.
 */
export const connectStream = (opts: ConnectStreamOptions): StreamHandle => {
  const Ctor = opts.WebSocketCtor ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  const baseBackoff = opts.baseBackoffMs ?? 500;
  const maxBackoff = opts.maxBackoffMs ?? 15_000;

  let socket: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  if (Ctor === undefined) {
    // No WS implementation (jsdom / SSR): report closed so the hook uses REST.
    opts.onStatus?.("closed");
    return { close: () => undefined };
  }

  const scheduleReconnect = (): void => {
    if (closedByUser) {
      return;
    }
    const delay = Math.min(maxBackoff, baseBackoff * 2 ** attempt);
    attempt += 1;
    reconnectTimer = setTimeout(open, delay);
  };

  function open(): void {
    if (closedByUser) {
      return;
    }
    opts.onStatus?.("connecting");
    let ws: WebSocket;
    try {
      ws = new Ctor!(opts.url);
    } catch (cause) {
      opts.onError?.(cause instanceof Error ? cause.message : "WebSocket open failed");
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = (): void => {
      attempt = 0;
      opts.onStatus?.("open");
    };
    ws.onmessage = (event: MessageEvent): void => {
      const envelope = parseStreamMessage(event.data);
      if (envelope === null) {
        return;
      }
      if (envelope.error !== null) {
        opts.onError?.(envelope.error);
        return;
      }
      opts.onMessage(envelope);
    };
    ws.onerror = (): void => {
      opts.onError?.("WebSocket error");
    };
    ws.onclose = (): void => {
      opts.onStatus?.("closed");
      if (!closedByUser) {
        scheduleReconnect();
      }
    };
  }

  open();

  return {
    close: (): void => {
      closedByUser = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
      }
      if (socket !== null) {
        // Detach handlers first so the user-initiated close doesn't reconnect.
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          // Ignore close races on an already-closing socket.
        }
        socket = null;
      }
    },
  };
};

/**
 * Live order-book aggregator. Seed with a SNAPSHOT (from REST or the WS SNAPSHOT
 * frame), then apply WS DELTAs; `snapshot()` returns the current merged book with
 * bids sorted high→low and asks low→high.
 */
export type OrderBookAggregator = {
  /** Applies a decoded stream envelope (SNAPSHOT resets, DELTA merges). */
  readonly apply: (envelope: StreamEnvelope) => void;
  /** Seeds/replaces the book from a full snapshot (e.g. the REST response). */
  readonly seed: (book: ExtendedOrderBook) => void;
  /** Current merged book. */
  readonly snapshot: () => ExtendedOrderBook;
  /** True once a snapshot has been applied. */
  readonly hasData: () => boolean;
};

/**
 * Creates an order-book aggregator for `market`. Delta application respects the
 * envelope `seq`: a delta whose `seq` is not greater than the last applied `seq`
 * is dropped as stale/duplicate; a `qty` of 0 removes that price level.
 */
export const createOrderBookAggregator = (market: string): OrderBookAggregator => {
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  let lastSeq: number | null = null;
  let seeded = false;

  const replace = (book: ExtendedOrderBook): void => {
    bids.clear();
    asks.clear();
    for (const level of book.bids) {
      if (level.qty > 0) {
        bids.set(level.price, level.qty);
      }
    }
    for (const level of book.asks) {
      if (level.qty > 0) {
        asks.set(level.price, level.qty);
      }
    }
    lastSeq = book.seq;
    seeded = true;
  };

  const mergeSide = (side: Map<number, number>, levels: ExtendedOrderBook["bids"]): void => {
    for (const level of levels) {
      if (level.qty <= 0) {
        side.delete(level.price);
      } else {
        side.set(level.price, level.qty);
      }
    }
  };

  return {
    seed: replace,
    apply: (envelope: StreamEnvelope): void => {
      const book = parseOrderBook(envelope.data, { seq: envelope.seq, ts: envelope.ts });
      const isSnapshot = envelope.type === "SNAPSHOT" || !seeded;
      if (isSnapshot) {
        replace(book);
        return;
      }
      // DELTA: drop stale/duplicate frames by seq (null seq always applies).
      if (envelope.seq !== null && lastSeq !== null && envelope.seq <= lastSeq) {
        return;
      }
      mergeSide(bids, book.bids);
      mergeSide(asks, book.asks);
      if (envelope.seq !== null) {
        lastSeq = envelope.seq;
      }
    },
    hasData: (): boolean => seeded,
    snapshot: (): ExtendedOrderBook => ({
      market,
      bids: Array.from(bids.entries())
        .map(([price, qty]) => ({ price, qty }))
        .sort((a, b) => b.price - a.price),
      asks: Array.from(asks.entries())
        .map(([price, qty]) => ({ price, qty }))
        .sort((a, b) => a.price - b.price),
      seq: lastSeq,
      ts: null,
    }),
  };
};
