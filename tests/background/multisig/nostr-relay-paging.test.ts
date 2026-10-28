/** Relay sync pages past a burst of newer wraps, within a bounded number of requests (Sherlock 129). */
import { describe, expect, test } from "bun:test";
import { MAX_NOSTR_BATCH_ITEMS } from "@bramble/wallet-model/nostr";
import {
  createNostrRelayTransport,
  MULTISIG_NOSTR_RELAYS,
} from "../../../apps/extension/src/background/multisig/nostr-relay";
import { event, RECIPIENT, socketFactory } from "../../support/nostr-relay-sockets";

// A relay holding `stored` that answers like a real one: newest first, inside
// the filter's since/until, at most `limit` wraps.
const filteringRelay = (stored: readonly ReturnType<typeof event>[], requests: unknown[]) =>
  socketFactory([], (frame, socket) => {
    const subscriptionId = String(frame[1]);
    const filter = frame[2] as {
      readonly limit: number;
      readonly since: number;
      readonly until?: number;
    };
    requests.push(filter);
    const answer = [...stored]
      .filter(
        (candidate) =>
          candidate.created_at >= filter.since &&
          (filter.until === undefined || candidate.created_at <= filter.until),
      )
      .sort((left, right) => right.created_at - left.created_at)
      .slice(0, filter.limit);
    for (const candidate of answer) {
      socket.onmessage?.(
        new MessageEvent("message", { data: JSON.stringify(["EVENT", subscriptionId, candidate]) }),
      );
    }
    socket.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(["EOSE", subscriptionId]) }),
    );
  });

const wrapAt = (index: number, createdAt: number) => ({
  ...event(index.toString(16).padStart(64, "0")),
  created_at: createdAt,
});

describe("relay paging (Sherlock 129)", () => {
  const relayUrls = [MULTISIG_NOSTR_RELAYS[0]];

  test("reaches an older wrap that a burst of newer wraps pushed out of the window", async () => {
    const honest = { ...wrapAt(0, 100), content: "honest" };
    const burst = Array.from({ length: MAX_NOSTR_BATCH_ITEMS }, (_, index) =>
      wrapAt(index + 1, 200 + index),
    );
    const requests: unknown[] = [];
    const transport = createNostrRelayTransport({
      socketFactory: filteringRelay([honest, ...burst], requests),
    });
    const seen = new Set(burst.map((candidate) => candidate.id));

    const candidates = await transport.sync(RECIPIENT, 1, relayUrls, seen);
    transport.close();
    expect(candidates.map((candidate) => candidate.content)).toEqual(["honest"]);
    expect(requests).toHaveLength(2);
  });

  test("skips wraps already finished with before applying the batch bound", async () => {
    const stored = Array.from({ length: MAX_NOSTR_BATCH_ITEMS + 10 }, (_, index) =>
      wrapAt(index, 1_000 - index),
    );
    const seen = new Set(stored.slice(0, 10).map((candidate) => candidate.id));
    const transport = createNostrRelayTransport({ socketFactory: filteringRelay(stored, []) });

    const candidates = await transport.sync(RECIPIENT, 1, relayUrls, seen);
    transport.close();
    expect(candidates).toHaveLength(MAX_NOSTR_BATCH_ITEMS);
    expect(candidates.some((candidate) => seen.has(candidate.id))).toBe(false);
  });

  test("stops after a bounded number of pages", async () => {
    const stored = Array.from({ length: 1_000 }, (_, index) => wrapAt(index, 10_000 - index));
    const seen = new Set(stored.map((candidate) => candidate.id));
    const requests: unknown[] = [];
    const transport = createNostrRelayTransport({
      socketFactory: filteringRelay(stored, requests),
    });

    await expect(transport.sync(RECIPIENT, 1, relayUrls, seen)).resolves.toEqual([]);
    transport.close();
    expect(requests).toHaveLength(4);
  });

  test("moves past a full page whose wraps all share one second", async () => {
    const stored = [
      ...Array.from({ length: 2 * MAX_NOSTR_BATCH_ITEMS }, (_, index) => wrapAt(index + 1, 500)),
      { ...wrapAt(0, 400), content: "older" },
    ];
    const seen = new Set(stored.slice(0, -1).map((candidate) => candidate.id));
    const requests: { readonly until?: number }[] = [];
    const transport = createNostrRelayTransport({
      socketFactory: filteringRelay(stored, requests),
    });

    const candidates = await transport.sync(RECIPIENT, 1, relayUrls, seen);
    transport.close();
    expect(candidates.map((candidate) => candidate.content)).toEqual(["older"]);
    expect(requests.map((request) => request.until)).toEqual([undefined, 500, 499]);
  });
});
