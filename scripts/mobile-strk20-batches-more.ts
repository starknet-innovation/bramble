/**
 * The STRK20 job batches for the compiler paths the first thirteen leave untested (wallet-core
 * #182): two tokens, a transfer beside a withdrawal, subchannel and note-nonce indices, naive
 * selection with ties and across pages, an explicit self recipient, activation beside a third-party
 * credit, `OPEN` notes that open channels, a paged `outgoing_state` walk, and two refusals. Appended
 * after the first thirteen lines, which keep their bytes. Replies come from the same kit, so every
 * channel key and note id is still the pinned SDK's own hash.
 */

import type { Batch, BatchKit, In } from "./mobile-strk20-batches";
import { hex } from "./mobile-strk20-primitives";

const E18 = 1_000_000_000_000_000_000n;

/** The later batches, in fixture order. */
export const moreStrk20Batches = (kit: BatchKit): readonly Batch[] => {
  const { a, b, c, channelKey, deposit, eth, funds, incoming, job, outgoing, self } = kit;
  const { strk, toB, transfer, withdraw } = kit;
  const ethHex = hex(eth);
  const strkHex = hex(strk);
  const selfBoth = {
    created: true,
    to: a,
    tokens: [
      [strk, 1],
      [eth, 0],
    ] as const,
  };
  const none = { nonce: [], prover: [] };
  // Equal amounts in an order a stable sort keeps apart: [5, 9, 5, 9, 5] at indices 0..4.
  const ties = [5n, 9n, 5n, 9n, 5n].map((amount, index): In => ({ amount, from: b, index }));
  const pageOne = {
    channel_discovery_complete: false,
    channels: {
      [hex(b.address)]: {
        channel_key: hex(channelKey(b, a)),
        last_subchannel_index: 0,
        subchannel_discovery_complete: false,
        subchannels: { [strkHex]: { last_note_index: 1, note_discovery_complete: false } },
      },
    },
    last_channel_index: 0,
  };
  // A first outgoing page whose only cursor channel is complete, so the SDK prunes it.
  const outgoingPageOne = {
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
    job("two-tokens", "actions", [transfer(`${3n * E18}`, b), withdraw(`${2n * E18}`, ethHex)], {
      incoming: [
        incoming([
          { amount: 10n * E18, from: b, index: 0 },
          { amount: 5n * E18, from: b, index: 0, token: eth },
        ]),
      ],
      outgoing: [outgoing([selfBoth, toB], 2)],
    }),
    job(
      "transfer-and-withdraw-same-token",
      "actions",
      [transfer(`${3n * E18}`, b), withdraw(`${2n * E18}`)],
      { incoming: [funds], outgoing: [outgoing([self, toB], 2)] },
    ),
    job("transfer-new-subchannel", "actions", [transfer(`${3n * E18}`, b)], {
      incoming: [funds],
      outgoing: [outgoing([self, { created: true, to: b, tokens: [[eth, 0]] }], 2)],
    }),
    job("transfer-existing-note-nonce", "actions", [transfer(`${3n * E18}`, b)], {
      incoming: [funds],
      outgoing: [outgoing([self, { created: true, last: 4, to: b }], 2)],
    }),
    job("naive-ties-14", "actions", [transfer("14", b)], {
      incoming: [incoming(ties)],
      outgoing: [outgoing([self, toB], 2)],
    }),
    job("naive-ties-19", "actions", [transfer("19", b)], {
      incoming: [incoming(ties)],
      outgoing: [outgoing([self, toB], 2)],
    }),
    job("notes-two-pages", "actions", [transfer("19", b)], {
      incoming: [incoming(ties.slice(0, 2), pageOne), incoming(ties.slice(2), undefined, false)],
      outgoing: [outgoing([self, toB], 2)],
    }),
    job("deposit-explicit-self", "actions", [deposit(`${5n * E18}`, a)], {
      outgoing: [outgoing([self], 1)],
    }),
    job("activate-deposit-other", "activate", [deposit(`${2n * E18}`, b)], {
      outgoing: [outgoing([{ created: false, to: b }], 0)],
      prover: [],
    }),
    job("open-new-channel", "actions", [transfer("OPEN", c)], {
      outgoing: [outgoing([self, { created: false, to: c }], 2)],
    }),
    job("open-new-subchannel", "actions", [transfer("OPEN", b)], {
      outgoing: [outgoing([self, { created: true, to: b, tokens: [[eth, 0]] }], 2)],
    }),
    job("outgoing-two-pages", "actions", [transfer(`${3n * E18}`, b)], {
      incoming: [funds],
      outgoing: [
        outgoing(
          [
            { created: true, last: 1, to: a },
            { created: false, to: b },
          ],
          2,
          outgoingPageOne,
        ),
        outgoing([{ created: true, last: 0, to: b }], 2),
      ],
    }),
    job("recipient-unregistered", "actions", [deposit(`${2n * E18}`, c)], {
      outgoing: [outgoing([self], 1)],
      ...none,
    }),
    job("register-already-registered", "registration", [], {
      outgoing: [outgoing([self], 1)],
      ...none,
    }),
  ];
};
