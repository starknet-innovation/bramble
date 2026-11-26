/**
 * STRK20 job batches for three compiler and walk paths no earlier job observed (wallet-core #182):
 * two created notes to one recipient and token in a proof (the note nonce between them), a
 * `Deposit` beside a `UseNote` (the order of the two phases), and a discovery walk whose first page
 * answers at another `block_ref` than the proving block (what page two echoes). Appended after the
 * earlier lines, which keep their bytes.
 */
import type { Batch, BatchKit } from "./mobile-strk20-batches";
import { hex } from "./mobile-strk20-primitives";

const E18 = 1_000_000_000_000_000_000n;
/** The first page's `block_ref` in the moved-walk jobs: a number, and a block-hash string. */
const MOVED_BLOCK = 1_234_560;
const MOVED_HASH = "0x5ca1ab1eb10c";

type Reply = NonNullable<Batch["script"]["outgoing"]>[number];

/** The same reply, answered at `blockRef` instead of the proving block. */
const at =
  (reply: Reply, blockRef: unknown): Reply =>
  (request) => {
    const served = reply(request);
    const body = JSON.parse(served.body) as Record<string, unknown>;
    return { ...served, body: JSON.stringify({ ...body, block_ref: blockRef }) };
  };

/** The batches, in fixture order. */
export const repeatStrk20Batches = (kit: BatchKit): readonly Batch[] => {
  const { a, b, channelKey, deposit, eth, funds, incoming, job, outgoing, self } = kit;
  const { strk, toB, transfer, withdraw } = kit;
  const strkHex = hex(strk);
  const ethHex = hex(eth);
  const selfBoth = {
    created: true,
    to: a,
    tokens: [
      [strk, 1],
      [eth, 0],
    ] as const,
  };
  const bWithEth = { created: true, to: b, tokens: [[eth, 0]] as const };
  const notesPageOne = {
    channel_discovery_complete: false,
    channels: {
      [hex(b.address)]: {
        channel_key: hex(channelKey(b, a)),
        last_subchannel_index: 0,
        subchannel_discovery_complete: false,
        subchannels: { [strkHex]: { last_note_index: 0, note_discovery_complete: false } },
      },
    },
    last_channel_index: 0,
  };
  const channelsPageOne = {
    channel_discovery_complete: false,
    channels: {
      [hex(a.address)]: {
        channel_key: hex(channelKey(a, a)),
        last_subchannel_index: 0,
        subchannel_discovery_complete: true,
        subchannels: { [strkHex]: { last_note_index: 1, note_discovery_complete: true } },
      },
    },
    last_channel_index: 0,
  };

  return [
    job(
      "two-transfers-same-recipient",
      "actions",
      [transfer(`${2n * E18}`, b), transfer(`${3n * E18}`, b)],
      { incoming: [funds], outgoing: [outgoing([self, { created: true, last: 3, to: b }], 2)] },
    ),
    job(
      "deposit-to-recipient-plus-transfer",
      "actions",
      [deposit(`${2n * E18}`, b), transfer(`${3n * E18}`, b)],
      { incoming: [funds], outgoing: [outgoing([self, bWithEth], 2)] },
    ),
    job("deposit-and-transfer", "actions", [deposit(`${2n * E18}`), transfer(`${5n * E18}`, b)], {
      incoming: [funds],
      outgoing: [outgoing([self, toB], 2)],
    }),
    job(
      "deposit-strk-withdraw-eth",
      "actions",
      [deposit(`${2n * E18}`), withdraw(`${E18}`, ethHex)],
      {
        incoming: [incoming([{ amount: 5n * E18, from: b, index: 0, token: eth }])],
        outgoing: [outgoing([selfBoth], 1)],
      },
    ),
    job("outgoing-moved-block-ref", "actions", [transfer(`${3n * E18}`, b)], {
      incoming: [funds],
      outgoing: [
        at(outgoing([self, { created: false, to: b }], 2, channelsPageOne), MOVED_BLOCK),
        at(outgoing([{ created: true, last: 0, to: b }], 2), MOVED_BLOCK),
      ],
    }),
    job("incoming-moved-block-ref", "actions", [transfer(`${3n * E18}`, b)], {
      incoming: [
        at(incoming([{ amount: 2n * E18, from: b, index: 0 }], notesPageOne), MOVED_HASH),
        at(incoming([{ amount: 4n * E18, from: b, index: 1 }], undefined, false), MOVED_HASH),
      ],
      outgoing: [outgoing([self, toB], 2)],
    }),
  ];
};
