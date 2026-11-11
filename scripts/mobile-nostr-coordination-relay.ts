/**
 * Relay-side parity vectors for Nostr multisig coordination (wallet-core plan, step 2.5): the
 * gift-wrap batch rule (`parsedGiftWraps`), acknowledgement counting, and sync paging, each
 * produced by the extension's own `nostr-relay.ts` over the scripted sockets its tests use
 * (`tests/support/nostr-relay-sockets.ts`). Nothing here restates a rule: every expected value is
 * what `publishManyNostrGiftWraps` or the transport's `sync` returned or threw.
 *
 * Events are the support module's stand-in gift wrap (`EVENT_TEMPLATE`) with the id `idOf(n)` and
 * a chosen `created_at`, so the fixture lists events by number. The relays never verify a
 * signature, so stand-ins are enough. Every request the extension sent is recorded as the exact
 * frame, with the numbers of the events the scripted relay answered, so a sans-IO port can replay
 * each case without sockets.
 */
import { MAX_NOSTR_BATCH_ITEMS } from "@bramble/wallet-model/nostr";
import {
  MULTISIG_NOSTR_RELAYS,
  publishManyNostrGiftWraps,
} from "../apps/extension/src/background/multisig/nostr-relay";
import { event, RECIPIENT, socketFactory } from "../tests/support/nostr-relay-sockets";

/** The 64-digit lowercase hex event id for event number `n`. */
export const idOf = (n: number): string => n.toString(16).padStart(64, "0");

/** The stand-in gift wrap every case builds on; `id` and `created_at` vary per event. */
const EVENT_TEMPLATE = event(idOf(0));

const wrapAt = (n: number, createdAt = 1, recipient = RECIPIENT) => ({
  ...event(idOf(n), recipient),
  created_at: createdAt,
});

const OTHER_RECIPIENT = "55".repeat(32);
const CUSTOM_RELAY = "wss://relay.team.example";
const range = (count: number, from = 0): number[] =>
  Array.from({ length: count }, (_, index) => from + index);
const errorOf = (error: unknown): string => (error instanceof Error ? error.message : "throw");

// ---- gift-wrap batches -------------------------------------------------------------------------

type Delivery = { readonly eventJson: string; readonly recipientPublicKey: string };

const delivery = (eventJson: unknown, recipientPublicKey = RECIPIENT): Delivery => ({
  eventJson: typeof eventJson === "string" ? eventJson : JSON.stringify(eventJson),
  recipientPublicKey,
});

const NOT_CANONICAL = "AA".repeat(32);

/** Deliveries are `ids` (`EVENT_TEMPLATE` numbered n, for `RECIPIENT`), then `extra` verbatim. */
const BATCH_CASES: readonly {
  readonly name: string;
  readonly ids: readonly number[];
  readonly extra?: readonly Delivery[];
}[] = [
  { ids: [0, 1], name: "two wraps" },
  { ids: range(MAX_NOSTR_BATCH_ITEMS), name: "at the bound" },
  { ids: range(MAX_NOSTR_BATCH_ITEMS + 1), name: "over the bound" },
  { ids: [], name: "empty" },
  { extra: [delivery({ ...wrapAt(0), kind: 1 })], ids: [], name: "wrong kind" },
  { extra: [delivery({ ...wrapAt(0), tags: [] })], ids: [], name: "missing p tag" },
  {
    extra: [delivery(wrapAt(0, 1, OTHER_RECIPIENT))],
    ids: [],
    name: "p tag for another recipient",
  },
  {
    extra: [delivery({ ...wrapAt(0), tags: [["p", RECIPIENT, CUSTOM_RELAY]] })],
    ids: [],
    name: "p tag with a relay hint",
  },
  {
    extra: [delivery(wrapAt(0, 1, NOT_CANONICAL), NOT_CANONICAL)],
    ids: [],
    name: "recipient not canonical",
  },
  { extra: [delivery("not json")], ids: [], name: "unparseable event" },
  { extra: [delivery({ ...wrapAt(0), extra: 1 })], ids: [], name: "event with an unknown key" },
  { ids: [0, 1, 0], name: "duplicate ids" },
  {
    extra: [delivery(wrapAt(0, 1, OTHER_RECIPIENT), OTHER_RECIPIENT)],
    ids: [0],
    name: "one id for two recipients",
  },
  {
    extra: [delivery(wrapAt(1, 1, OTHER_RECIPIENT), OTHER_RECIPIENT)],
    ids: [0],
    name: "two recipients",
  },
  {
    extra: [delivery("not json")],
    ids: range(MAX_NOSTR_BATCH_ITEMS),
    name: "over the bound with an invalid wrap",
  },
  {
    extra: [delivery({ ...wrapAt(1), kind: 1 })],
    ids: [0, 0],
    name: "invalid wrap after a duplicate",
  },
];

// One relay that accepts every wrap, so an accepted batch reports one acknowledgement each.
const acceptingRelay = () =>
  socketFactory([], (frame, socket) => {
    const published = frame[1] as { readonly id: string };
    socket.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(["OK", published.id, true, ""]) }),
    );
  });

const giftWrapBatches = async () => {
  const cases = [];
  for (const { extra = [], ids, name } of BATCH_CASES) {
    const deliveries = [...ids.map((n) => delivery(wrapAt(n))), ...extra];
    const outcome = await publishManyNostrGiftWraps(deliveries, {
      relayUrls: [CUSTOM_RELAY],
      socketFactory: acceptingRelay(),
    }).then(
      (acknowledgements) => ({ acknowledgements }),
      (error: unknown) => ({ error: errorOf(error) }),
    );
    cases.push({ extra, ids, name, ...outcome });
  }
  return { relayUrls: [CUSTOM_RELAY], cases };
};

// ---- acknowledgements --------------------------------------------------------------------------

/**
 * One relay's reply to each wrap, in delivery order: `[accepted, message]`, sent as
 * `["OK", idOf(n), accepted, message]` when that wrap arrives. "socket error" fails the socket at
 * the first wrap instead.
 */
type Replies = readonly (readonly [boolean, string])[] | "socket error";

const ACK_CASES: readonly {
  readonly name: string;
  readonly ids: readonly number[];
  readonly relays: readonly (readonly [string, Replies])[];
}[] = [
  {
    name: "both relays accept",
    ids: [0, 1],
    relays: MULTISIG_NOSTR_RELAYS.map(
      (url) =>
        [
          url,
          [
            [true, ""],
            [true, ""],
          ],
        ] as const,
    ),
  },
  {
    name: "one relay blocks one wrap",
    ids: [0, 1],
    relays: [
      [
        MULTISIG_NOSTR_RELAYS[0],
        [
          [true, ""],
          [true, ""],
        ],
      ],
      [
        MULTISIG_NOSTR_RELAYS[1],
        [
          [true, ""],
          [false, "blocked: parity"],
        ],
      ],
    ],
  },
  {
    name: "a duplicate refusal counts as stored",
    ids: [0],
    relays: [
      [MULTISIG_NOSTR_RELAYS[0], [[false, "duplicate: already have it"]]],
      [MULTISIG_NOSTR_RELAYS[1], [[false, "Duplicate: Already Have It"]]],
    ],
  },
  {
    name: "a refusal that only mentions duplicate does not count",
    ids: [0],
    relays: [
      [MULTISIG_NOSTR_RELAYS[0], [[false, "error: duplicate: no"]]],
      [MULTISIG_NOSTR_RELAYS[1], [[true, ""]]],
    ],
  },
  {
    name: "one relay fails",
    ids: [0, 1],
    relays: [
      [MULTISIG_NOSTR_RELAYS[0], "socket error"],
      [
        MULTISIG_NOSTR_RELAYS[1],
        [
          [true, ""],
          [true, ""],
        ],
      ],
    ],
  },
  {
    name: "one custom relay",
    ids: [0, 1, 2],
    relays: [
      [
        CUSTOM_RELAY,
        [
          [true, ""],
          [false, "blocked: parity"],
          [true, ""],
        ],
      ],
    ],
  },
  {
    name: "every relay refuses",
    ids: [0],
    relays: [
      [MULTISIG_NOSTR_RELAYS[0], [[false, "blocked: parity"]]],
      [MULTISIG_NOSTR_RELAYS[1], "socket error"],
    ],
  },
  { name: "no relays", ids: [0], relays: [] },
  {
    name: "three relays",
    ids: [0],
    relays: [...MULTISIG_NOSTR_RELAYS, CUSTOM_RELAY].map((url) => [url, [[true, ""]]] as const),
  },
  {
    name: "the same relay twice",
    ids: [0],
    relays: [
      [CUSTOM_RELAY, [[true, ""]]],
      [CUSTOM_RELAY, [[true, ""]]],
    ],
  },
  { name: "an insecure relay", ids: [0], relays: [["ws://relay.example", [[true, ""]]]] },
];

const replyFrames = (ids: readonly number[], replies: Replies) =>
  replies === "socket error"
    ? replies
    : replies.map(([accepted, message], index) =>
        JSON.stringify(["OK", idOf(ids[index] ?? -1), accepted, message]),
      );

const acknowledgementCases = async () => {
  const cases = [];
  for (const { ids, name, relays } of ACK_CASES) {
    const frames = new Map(relays.map(([url, replies]) => [url, replyFrames(ids, replies)]));
    const factory = socketFactory([], (frame, socket, url) => {
      const replies = frames.get(url);
      if (replies === "socket error") {
        socket.onerror?.(new Event("error"));
        return;
      }
      const index = ids.findIndex((n) => idOf(n) === (frame[1] as { readonly id: string }).id);
      const reply = replies?.[index];
      if (reply) socket.onmessage?.(new MessageEvent("message", { data: reply }));
    });
    const outcome = await publishManyNostrGiftWraps(
      ids.map((n) => ({ eventJson: JSON.stringify(wrapAt(n)), recipientPublicKey: RECIPIENT })),
      { relayUrls: relays.map(([url]) => url), socketFactory: factory },
    ).then(
      (acknowledgements) => ({ acknowledgements }),
      (error: unknown) => ({ error: errorOf(error) }),
    );
    cases.push({
      ids,
      name,
      relays: relays.map(([url, replies]) => ({ replies, url })),
      ...outcome,
    });
  }
  return cases;
};

export const relayParity = async () => ({
  acknowledgements: await acknowledgementCases(),
  event: EVENT_TEMPLATE,
  giftWrapBatches: await giftWrapBatches(),
  idOf: "event number n is its id as 64-digit lowercase hex; every other field is from `event`",
  recipient: RECIPIENT,
});
