/**
 * Scripted service replies for the mobile privacy fixture (docs/privacy.md §6, fixtures 3 and 4).
 * Each case is replayed through the extension's real read path (`mobile-privacy-wire.ts`) and,
 * from the committed fixture, through the Rust core's read plan; both must reach the same outcome.
 * Large cases are described by a `synth` spec that both sides expand the same way, so the fixture
 * stays small. Every value is synthetic.
 */
import { canonicalFelt, DEFAULT_TOKENS } from "@bramble/wallet-model/networks";

/** One HTTP reply; fee bodies carry `"id":0`, replaced with the request's id when served. */
export type ScriptedReply = { readonly body: string; readonly status: number };

/** A single complete page holding `tokens × notesPerToken` notes of `amount` each. */
export type SynthSpec = {
  readonly amount: string;
  readonly notesPerToken: number;
  readonly tokens: number;
};

/** One judged scenario. `mobile` names a documented deviation: the core's expected failure. */
export type PrivacyCase = {
  readonly fee: readonly ScriptedReply[];
  readonly id: string;
  readonly mobile?: string;
  readonly pages: readonly ScriptedReply[];
  readonly preflight: readonly ScriptedReply[];
  readonly synth?: SynthSpec;
};

const address = (symbol: string): string => {
  const token = DEFAULT_TOKENS.find(
    (entry) => entry.networkId === "SN_MAIN" && entry.symbol === symbol,
  );
  const felt = token ? canonicalFelt(token.address) : null;
  if (!felt) throw new Error(`missing ${symbol}`);
  return felt;
};

/** Synthetic sender and channel key. */
export const SENDER = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3";
const CHANNEL = { channel_key: "0x77", sender_addr: SENDER };
const ETH = address("ETH");
const STRK = address("STRK");
const P = (1n << 251n) + 17n * (1n << 192n) + 1n;
const BLOCK = "0x5a1f00d";

const ok = (value: unknown): ScriptedReply => ({ body: JSON.stringify(value), status: 200 });
const preflight = (registered: boolean): ScriptedReply =>
  ok({
    block_ref: BLOCK,
    channel_exists: registered,
    sender_registered: registered,
    subchannel_exists: false,
  });
const fee = (hex: string): ScriptedReply => ({
  body: `{"jsonrpc":"2.0","id":0,"result":["${hex}"]}`,
  status: 200,
});
const FEE = fee("0x53444835ec580000");
const note = (token: string, amount: string, index = 0, sender = SENDER) => ({
  amount,
  block_number: 7,
  index,
  note_id: `0x${(index + 1).toString(16)}`,
  salt: "12345",
  sender_addr: sender,
  token,
});
const DONE = { channel_discovery_complete: true };
const page = (
  notes: readonly unknown[],
  cursor: unknown = DONE,
  channels: readonly unknown[] = [CHANNEL],
  block: unknown = BLOCK,
) => ok({ block_ref: block, channels, cursor, notes, subchannels: [] });
const open = (subchannels: Record<string, unknown>) => ({
  channel_discovery_complete: false,
  channels: {
    [SENDER]: {
      channel_key: "0x77",
      last_subchannel_index: 0,
      subchannel_discovery_complete: false,
      subchannels,
    },
  },
  last_channel_index: 0,
});

/** Expands a synth spec into its one page, exactly as the Rust suite does. */
export const synthPages = (spec: SynthSpec): readonly ScriptedReply[] => {
  const notes = [];
  for (let t = 0; t < spec.tokens; t += 1) {
    const token = t === 0 ? ETH : t === 1 ? STRK : `0x${(0x1000 + t).toString(16)}`;
    for (let n = 0; n < spec.notesPerToken; n += 1) notes.push(note(token, spec.amount, n));
  }
  return [page(notes)];
};

const registered = (
  id: string,
  pages: readonly ScriptedReply[],
  extra: Partial<PrivacyCase> = {},
): PrivacyCase => ({
  fee: [FEE],
  id,
  pages,
  preflight: [preflight(true)],
  ...extra,
});
const failing = (status: number, body: string): ScriptedReply => ({ body, status });

/** Every scenario, in fixture order. */
export const PRIVACY_CASES: readonly PrivacyCase[] = [
  { fee: [FEE], id: "unregistered", pages: [], preflight: [preflight(false)] },
  registered("registered-empty", [page([])]),
  registered("one-token", [page([note(ETH, "1500000000000000000")])]),
  registered("several-tokens", [
    page([note(STRK, "7"), note(ETH, "3", 1), note("0x1234", "9", 2), note(STRK, "0x10", 3)]),
  ]),
  registered("three-pages", [
    page(
      [note(ETH, "1000000000000000")],
      open({ [ETH]: { last_note_index: 0, note_discovery_complete: false, total_n_notes: 2 } }),
    ),
    page(
      [note(ETH, "2000000000000000", 1), note(STRK, "5000000000000000000", 0)],
      open({
        [ETH]: { last_note_index: 1, note_discovery_complete: true },
        [STRK]: { last_note_index: 0, note_discovery_complete: false },
      }),
      [],
    ),
    page([note(STRK, "250000000000000000", 1)], DONE, []),
  ]),
  registered("nested-incomplete-subchannel", [
    page([], {
      channel_discovery_complete: true,
      channels: {
        [SENDER]: {
          channel_key: "0x77",
          subchannel_discovery_complete: true,
          subchannels: { [ETH]: { note_discovery_complete: false } },
        },
      },
    }),
    page([note(ETH, "42")], DONE, []),
  ]),
  registered("tokens-64", [], { synth: { amount: "1", notesPerToken: 1, tokens: 64 } }),
  registered("tokens-65", [], { synth: { amount: "1", notesPerToken: 1, tokens: 65 } }),
  registered("notes-4096", [], { synth: { amount: "1", notesPerToken: 4096, tokens: 1 } }),
  registered("notes-4097", [], { synth: { amount: "1", notesPerToken: 4097, tokens: 1 } }),
  registered("amount-p-minus-one", [page([note(ETH, (P - 1n).toString())])]),
  registered("amount-p", [page([note(ETH, P.toString())])]),
  registered("per-token-overflow", [page([note(ETH, (P - 1n).toString()), note(ETH, "1", 1)])]),
  registered("token-zero", [page([note("0x0", "1")])]),
  registered("sender-without-channel-key", [page([note(ETH, "1")], DONE, [])]),
  registered("reorg-409", [failing(409, '{"error":"BLOCK_REORGED"}')]),
  registered("bare-429-not-retried", [failing(429, "")]),
  registered("429-text-retried", [
    failing(429, '{"error":"Too Many Requests"}'),
    page([note(ETH, "5")]),
  ]),
  registered("429-text-exhausted", [
    failing(429, "rate limit exceeded"),
    failing(429, "rate limit exceeded"),
    failing(429, "rate limit exceeded"),
  ]),
  registered("server-500", [failing(500, "internal")]),
  registered("malformed-json", [failing(200, "{not json")]),
  {
    fee: [FEE],
    id: "preflight-rate-limited-then-ok",
    pages: [page([])],
    preflight: [failing(503, "HTTP 429 upstream"), preflight(true)],
  },
  registered("fee-max", [page([])], { fee: [fee(`0x${"f".repeat(32)}`)] }),
  registered("fee-over-max", [page([])], { fee: [fee(`0x1${"0".repeat(32)}`)] }),
  registered("fee-two-felts", [page([])], {
    fee: [{ body: '{"jsonrpc":"2.0","id":0,"result":["0x1","0x0"]}', status: 200 }],
  }),
  registered("fee-throttled-then-ok", [page([])], {
    fee: [
      { body: '{"jsonrpc":"2.0","id":0,"error":{"code":-32005,"message":"limit"}}', status: 200 },
      FEE,
    ],
  }),
  registered(
    "block-ref-changes",
    [
      page([note(ETH, "1")], open({ [ETH]: { note_discovery_complete: false } })),
      page([note(ETH, "2", 1)], DONE, [], "0x5a1f00e"),
    ],
    { mobile: "InvalidResponse" },
  ),
];
