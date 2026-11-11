/**
 * Sync-paging parity vectors for Nostr multisig coordination (wallet-core plan, step 2.5): the
 * extension's transport `sync` (`nostr-relay.ts`) run against scripted relays that answer like a
 * real one (newest first, inside the filter's `since`/`until`, at most `limit` wraps), as
 * `tests/background/multisig/nostr-relay-paging.test.ts` does. Each case records what every relay
 * stores, the ids already seen, every REQ frame the extension sent with the events answered, and
 * the ordered candidates `sync` returned (or its error), so the unseen-first bound, the `until`
 * cursor, the page cap and the round-robin across relays can be replayed without sockets.
 */
import { MAX_NOSTR_BATCH_ITEMS } from "@bramble/wallet-model/nostr";
import {
  createNostrRelayTransport,
  MULTISIG_NOSTR_RELAYS,
} from "../apps/extension/src/background/multisig/nostr-relay";
import { event, RECIPIENT, socketFactory } from "../tests/support/nostr-relay-sockets";
import { idOf } from "./mobile-nostr-coordination-relay";

const N = MAX_NOSTR_BATCH_ITEMS;
const [PRIMARY, SECONDARY] = MULTISIG_NOSTR_RELAYS;
const CUSTOM_RELAY = "wss://relay.team.example";

/** What one scripted relay stores: event numbers and their `created_at`, index for index. */
type StoredRelay = {
  readonly url: string;
  readonly ids: readonly number[];
  readonly createdAt: readonly number[];
  /** The relay answers every REQ with CLOSED. */
  readonly refuses?: true;
};

type PagingCase = {
  readonly name: string;
  readonly since: number;
  readonly seen: readonly number[];
  readonly relays: readonly StoredRelay[];
  readonly recipient?: string;
};

const range = (count: number, from = 0): number[] =>
  Array.from({ length: count }, (_, index) => from + index);

const relay = (url: string, ids: readonly number[], createdAt: (n: number) => number) => ({
  createdAt: ids.map(createdAt),
  ids,
  url,
});

const CASES: readonly PagingCase[] = [
  {
    // Sherlock 129: a burst of seen wraps pushed an unseen one off the first page.
    name: "a burst of newer wraps hides an older one",
    relays: [relay(PRIMARY, range(N + 1), (n) => (n === 0 ? 100 : 199 + n))],
    seen: range(N, 1),
    since: 1,
  },
  {
    name: "seen wraps are skipped before the batch bound",
    relays: [relay(PRIMARY, range(N + 10), (n) => 1_000 - n)],
    seen: range(10),
    since: 1,
  },
  {
    name: "paging stops after the page cap",
    relays: [relay(PRIMARY, range(4 * N + 1), (n) => 10_000 - n)],
    seen: range(4 * N + 1),
    since: 1,
  },
  {
    name: "a full page from one second steps below it",
    relays: [relay(PRIMARY, range(2 * N + 1), (n) => (n === 0 ? 400 : 500))],
    seen: range(2 * N, 1),
    since: 1,
  },
  {
    name: "the cursor stops at since",
    relays: [relay(PRIMARY, range(N + 5), (n) => (n < N ? 100 : 99))],
    seen: range(N),
    since: 100,
  },
  {
    name: "a short page ends paging",
    relays: [relay(PRIMARY, range(3), (n) => 300 - n)],
    seen: [],
    since: 1,
  },
  {
    name: "each relay gets room in the batch",
    relays: [
      relay(PRIMARY, range(N, 100), (n) => 2_000_000_000 - n),
      relay(SECONDARY, [7], () => 5),
    ],
    seen: [],
    since: 1,
  },
  {
    name: "candidates interleave across relays",
    relays: [
      relay(PRIMARY, range(30), (n) => 1_000 + n),
      relay(SECONDARY, range(30, 30), (n) => n),
    ],
    seen: [],
    since: 1,
  },
  {
    name: "the same id from two relays stays twice",
    relays: [relay(PRIMARY, [9, 1], () => 50), relay(SECONDARY, [9], () => 50)],
    seen: [],
    since: 1,
  },
  {
    name: "a refusing relay is skipped",
    relays: [
      relay(PRIMARY, [1, 2], (n) => 10 + n),
      { ...relay(SECONDARY, [3], () => 1), refuses: true },
    ],
    seen: [1],
    since: 1,
  },
  {
    name: "every relay refuses",
    relays: [{ ...relay(CUSTOM_RELAY, [1], () => 1), refuses: true }],
    seen: [],
    since: 1,
  },
  {
    name: "three relays",
    relays: [PRIMARY, SECONDARY, CUSTOM_RELAY].map((url) => relay(url, [], () => 0)),
    seen: [],
    since: 1,
  },
  { name: "negative since", relays: [relay(CUSTOM_RELAY, [], () => 0)], seen: [], since: -1 },
  {
    name: "recipient not canonical",
    recipient: "AA".repeat(32),
    relays: [relay(CUSTOM_RELAY, [], () => 0)],
    seen: [],
    since: 1,
  },
];

type Request = { readonly frame: string; readonly answer: readonly number[] };

// A relay that answers like a real one, recording each REQ frame exactly as sent.
const scriptedRelays = (relays: readonly StoredRelay[], requests: Map<string, Request[]>) =>
  socketFactory([], (frame, socket, url) => {
    const stored = relays.find((candidate) => candidate.url === url);
    const log = requests.get(url);
    if (!stored || !log) return;
    const subscriptionId = String(frame[1]);
    const reply = (data: unknown) =>
      socket.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
    const filter = frame[2] as {
      readonly limit: number;
      readonly since: number;
      readonly until?: number;
    };
    const answer = stored.refuses
      ? []
      : stored.ids
          .map((n, index) => ({ createdAt: stored.createdAt[index] ?? 0, n }))
          .filter(
            ({ createdAt }) =>
              createdAt >= filter.since &&
              (filter.until === undefined || createdAt <= filter.until),
          )
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, filter.limit);
    log.push({ answer: answer.map(({ n }) => n), frame: JSON.stringify(frame) });
    if (stored.refuses) {
      reply(["CLOSED", subscriptionId, "restricted: parity"]);
      return;
    }
    for (const { createdAt, n } of answer) {
      reply(["EVENT", subscriptionId, { ...event(idOf(n)), created_at: createdAt }]);
    }
    reply(["EOSE", subscriptionId]);
  });

const runCase = async ({ recipient, relays, seen, since }: PagingCase) => {
  const requests = new Map(relays.map(({ url }) => [url, [] as Request[]]));
  const transport = createNostrRelayTransport({ socketFactory: scriptedRelays(relays, requests) });
  try {
    const candidates = await transport.sync(
      recipient ?? RECIPIENT,
      since,
      relays.map(({ url }) => url),
      new Set(seen.map(idOf)),
    );
    return { requests, result: candidates.map(({ id }) => Number.parseInt(id, 16)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "throw", requests };
  } finally {
    transport.close();
  }
};

/** Every paging case, with the requests the extension made and what `sync` returned. */
export const pagingParity = async () => {
  const cases = [];
  for (const pagingCase of CASES) {
    const { requests, ...outcome } = await runCase(pagingCase);
    cases.push({
      name: pagingCase.name,
      ...(pagingCase.recipient ? { recipient: pagingCase.recipient } : {}),
      since: pagingCase.since,
      seen: pagingCase.seen,
      relays: pagingCase.relays.map((stored) => ({
        ...stored,
        requests: requests.get(stored.url) ?? [],
      })),
      ...outcome,
    });
  }
  return cases;
};
