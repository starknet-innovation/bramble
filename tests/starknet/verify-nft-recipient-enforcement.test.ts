/**
 * Recipient enforcement is a property of the SELECTOR, not of whether the wallet
 * can render a pretty summary for the span.
 *
 * The gap this pins: the canonical five-felt ERC721 `safe_transfer_from` (empty
 * data span) and every ERC1155 batch transfer decoded as opaque, and because the
 * recipient was only extracted from calls that had decoded as a transfer, the
 * address-poisoning hard refusal and the self-send warning never ran on them. A
 * dapp invoke or a stored multisig proposal could therefore move an NFT to a
 * lookalike of a saved contact while the review card said only
 * "Call safe_transfer_from on 0x…".
 *
 * Fixtures come from ../support/poisoned-recipients so this suite attacks the
 * same address pair as every other recipient-parity suite.
 */
import { describe, expect, test } from "bun:test";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@mc-wallet/transactions/verify";
import {
  BATCH_TRANSFER_FROM_ENTRYPOINTS,
  PLAIN_TRANSFER_FROM_ENTRYPOINTS,
  recipientFeltIndex,
  SAFE_TRANSFER_FROM_ENTRYPOINTS,
} from "@mc-wallet/transactions/verify-selectors";
import {
  CLEAN_RECIPIENT,
  POISONED_RECIPIENT,
  POISONING_CONTACT,
  POISONING_REFUSAL,
  poisoningAccount,
} from "../support/poisoned-recipients";

const COLLECTION = "0x0511a2b3c4d5e6f7a8b9c0d1e2f30411223344556677889900aabbccddeeff00";

const context = verificationContext(poisoningAccount, {
  addressBook: [
    {
      address: POISONING_CONTACT,
      id: `SN_MAIN:${POISONING_CONTACT}`,
      label: "Friend",
      networkId: "SN_MAIN",
    },
  ],
  tokens: [],
});

const owner = poisoningAccount.address;

const callTo = (entrypoint: string, calldata: readonly string[]) => ({
  calldata: [...calldata],
  contractAddress: COLLECTION,
  entrypoint,
});

const reportFor = (entrypoint: string, calldata: readonly string[]) =>
  verifyCalls([callTo(entrypoint, calldata)], context);

const refusalFor = (entrypoint: string, calldata: readonly string[]) =>
  refuseOnPoisonedRecipient(reportFor(entrypoint, calldata));

// Every real span shape a Starknet NFT transfer takes, as a function of the
// recipient felt so the same row can be run poisoned and clean. Serializations
// follow OpenZeppelin's Cairo ERC721/ERC1155: an ERC721 safe transfer is
// [from, to, id_low, id_high, data_len, ...data]; an ERC1155 single transfer is
// [from, to, id_low, id_high, value_low, value_high, data_len, ...data]; and an
// ERC1155 batch is [from, to, ids_len, ...2n id felts, values_len,
// ...2n value felts, data_len, ...data].
const SPANS: readonly { readonly label: string; readonly span: (to: string) => string[] }[] = [
  { label: "ERC721 plain, 4 felts", span: (to) => [owner, to, "5", "0"] },
  { label: "ERC721 safe, empty data, 5 felts", span: (to) => [owner, to, "5", "0", "0"] },
  { label: "ERC721 safe, 1 data felt, 6 felts", span: (to) => [owner, to, "5", "0", "1", "0xa"] },
  {
    label: "ERC721 safe, 2 data felts, 7 felts",
    span: (to) => [owner, to, "5", "0", "2", "0xa", "0xb"],
  },
  {
    label: "ERC721 safe, 3 data felts, 8 felts",
    span: (to) => [owner, to, "5", "0", "3", "0xa", "0xb", "0xc"],
  },
  {
    label: "ERC1155 single, empty data, 7 felts",
    span: (to) => [owner, to, "342", "0", "1", "0", "0"],
  },
  {
    label: "ERC1155 single, 2 data felts, 9 felts",
    span: (to) => [owner, to, "342", "0", "1", "0", "2", "0xa", "0xb"],
  },
  {
    label: "ERC1155 batch, 0 ids, 5 felts",
    span: (to) => [owner, to, "0", "0", "0"],
  },
  {
    label: "ERC1155 batch, 1 id, 9 felts",
    span: (to) => [owner, to, "1", "5", "0", "1", "1", "0", "0"],
  },
  {
    label: "ERC1155 batch, 2 ids, 13 felts",
    span: (to) => [owner, to, "2", "5", "0", "6", "0", "2", "1", "0", "1", "0", "0"],
  },
  // Shapes no standard produces. They must still refuse: an attacker choosing an
  // unparseable span is choosing exactly the case the wallet describes worst.
  {
    label: "malformed: trailing felt after an empty ERC721 data span",
    span: (to) => [owner, to, "5", "0", "0", "0xa"],
  },
  {
    label: "malformed: ERC1155 batch with mismatched values length",
    span: (to) => [owner, to, "1", "5", "0", "2", "1", "0", "1", "0", "0"],
  },
  { label: "malformed: recipient felt and nothing after it", span: (to) => [owner, to] },
];

const ALIASES: readonly string[] = [
  ...PLAIN_TRANSFER_FROM_ENTRYPOINTS,
  ...SAFE_TRANSFER_FROM_ENTRYPOINTS,
  ...BATCH_TRANSFER_FROM_ENTRYPOINTS,
];

describe("recipient enforcement is span- and alias-independent", () => {
  test("every transfer alias refuses a poisoned recipient in every span shape", () => {
    const allowed = ALIASES.flatMap((entrypoint) =>
      SPANS.filter(({ span }) => refusalFor(entrypoint, span(POISONED_RECIPIENT)) === null).map(
        ({ label }) => `${entrypoint}: ${label}`,
      ),
    );

    expect(allowed).toEqual([]);
  });

  test("the refusal every alias raises is the shared verifier's own sentence", () => {
    // Asserting the message, not merely non-null: a per-shape refusal wording
    // would mean the user reads a different sentence depending on which span an
    // attacker chose, which is the parity the shared rule exists to give.
    for (const entrypoint of ALIASES) {
      for (const { label, span } of SPANS) {
        expect({
          label: `${entrypoint}: ${label}`,
          ...refusalFor(entrypoint, span(POISONED_RECIPIENT)),
        }).toEqual({
          error: POISONING_REFUSAL,
          label: `${entrypoint}: ${label}`,
        });
      }
    }
  });

  test("no alias refuses a recipient that mimics nothing the wallet trusts", () => {
    // Load-bearing negative half: a rule that refused every NFT transfer would
    // pass the two tests above while making the wallet unusable.
    const refused = ALIASES.flatMap((entrypoint) =>
      SPANS.filter(({ span }) => refusalFor(entrypoint, span(CLEAN_RECIPIENT)) !== null).map(
        ({ label }) => `${entrypoint}: ${label}`,
      ),
    );

    expect(refused).toEqual([]);
  });

  test("the from field is never mistaken for the recipient", () => {
    // calldata[0] is the owner being debited. Reading it as the recipient would
    // refuse legitimate transfers pulled from a saved contact's lookalike.
    for (const entrypoint of ALIASES) {
      const span = [POISONED_RECIPIENT, CLEAN_RECIPIENT, "5", "0", "0"];
      expect({ entrypoint, refusal: refusalFor(entrypoint, span) }).toEqual({
        entrypoint,
        refusal: null,
      });
    }
  });

  test("a self-send warning reaches the shapes that decoded as opaque", () => {
    // The five-felt ERC721 safe transfer raised only `unknown-contract`, so a
    // transfer routed back to the wallet's own address said nothing about it.
    const report = reportFor("safe_transfer_from", [owner, owner, "5", "0", "0"]);

    expect(report.flags.map((flag) => flag.code)).toContain("self-transfer");
  });
});

describe("the enforcement vocabulary and the risk rule cannot drift apart", () => {
  test("every alias the vocabulary knows names calldata[1] as the recipient", () => {
    for (const entrypoint of ALIASES) {
      expect({ entrypoint, index: recipientFeltIndex(entrypoint) }).toEqual({
        entrypoint,
        index: 1,
      });
    }
    expect(recipientFeltIndex("transfer")).toBe(0);
  });

  test("a spelling added to the vocabulary is enforced without a second edit", () => {
    // Iterates the exported lists rather than a copy of them, so a seventh alias
    // added to ./verify-selectors is checked here the moment it lands — the
    // enforced-derived-list pattern this repo already uses for DAPP_MESSAGES.
    const unenforced = [...ALIASES, "transfer"].filter((entrypoint) => {
      const index = recipientFeltIndex(entrypoint);
      if (index === null) {
        return true;
      }
      const span = index === 0 ? [POISONED_RECIPIENT] : [owner, POISONED_RECIPIENT];
      return refusalFor(entrypoint, span) === null;
    });

    expect(unenforced).toEqual([]);
  });

  test("a grant is not a payment: approvals raise no recipient rule", () => {
    // `approve(spender, …)` and `set_approval_for_all(operator, …)` put a party
    // at felt zero that the user is AUTHORIZING, not paying. Treating it as a
    // recipient would turn every lookalike-spender approval into a hard refusal
    // and change what the wallet means by a refusal.
    for (const entrypoint of ["approve", "increase_allowance", "set_approval_for_all"]) {
      expect({ entrypoint, index: recipientFeltIndex(entrypoint) }).toEqual({
        entrypoint,
        index: null,
      });
    }
    expect(recipientFeltIndex("mint")).toBeNull();
  });
});

describe("safe-transfer summaries state only what the span proves", () => {
  const summaryOf = (entrypoint: string, calldata: readonly string[]) =>
    reportFor(entrypoint, calldata).calls[0];

  test("an unambiguous ERC721 span names the item, with no invented quantity", () => {
    expect(summaryOf("safe_transfer_from", [owner, CLEAN_RECIPIENT, "5", "0", "0"])).toMatchObject({
      kind: "transfer",
      summary: "Send NFT #5 to 0x777b…bbcc",
    });
  });

  test("an unambiguous ERC1155 span still names the edition count", () => {
    // The shape the wallet's own ERC1155 builder emits: this must not regress
    // into the conservative wording, or the user loses real information.
    expect(
      summaryOf("safe_transfer_from", [owner, CLEAN_RECIPIENT, "342", "0", "1", "0", "0"]),
    ).toMatchObject({ kind: "transfer", summary: "Send 1 of NFT #342 to 0x777b…bbcc" });
  });

  test("a span that fits both standards states the id and refuses to guess a count", () => {
    // [from, to, id, 0, 2, 0, 0] is an ERC1155 transfer of 2 editions AND an
    // ERC721 transfer with a two-felt zero data span. Nothing on chain or in
    // storage tells the wallet which, so the count is omitted rather than picked.
    expect(
      summaryOf("safeTransferFrom", [owner, CLEAN_RECIPIENT, "5", "0", "2", "0", "0"]),
    ).toMatchObject({ kind: "transfer", summary: "Safe transfer of NFT #5 to 0x777b…bbcc" });
  });

  test("ERC721 data felts are never read as an edition count", () => {
    // Previously "Send 19397796326328097109729669496647946894049282 of NFT #5":
    // the 0xdead data felts landed in the ERC1155 value's limbs and were shown
    // to the user as a quantity.
    expect(
      summaryOf("safe_transfer_from", [owner, CLEAN_RECIPIENT, "5", "0", "2", "0xdead", "0xdead"]),
    ).toMatchObject({ kind: "transfer", summary: "Send NFT #5 to 0x777b…bbcc" });
  });

  test("a batch states how many ids move and to whom, not a total", () => {
    expect(
      summaryOf("safe_batch_transfer_from", [
        owner,
        CLEAN_RECIPIENT,
        "2",
        "5",
        "0",
        "6",
        "0",
        "2",
        "1",
        "0",
        "1",
        "0",
        "0",
      ]),
    ).toMatchObject({
      kind: "transfer",
      summary: "Send 2 token ids of collection 0x511a…ff00 to 0x777b…bbcc",
    });
    expect(
      summaryOf("safeBatchTransferFrom", [
        owner,
        CLEAN_RECIPIENT,
        "1",
        "5",
        "0",
        "1",
        "1",
        "0",
        "0",
      ])?.summary,
    ).toBe("Send 1 token id of collection 0x511a…ff00 to 0x777b…bbcc");
  });

  test("a span that fits no standard stays opaque rather than being described", () => {
    // Fail toward showing the user LESS confidence: the enforcement above still
    // ran on these, so an opaque summary costs nothing but a wrong one would.
    for (const span of [
      [owner, CLEAN_RECIPIENT, "5", "0", "0", "0xa"],
      [owner, CLEAN_RECIPIENT, "1", "5", "0", "2", "1", "0", "1", "0", "0"],
      [owner, CLEAN_RECIPIENT],
    ]) {
      expect({ length: span.length, kind: summaryOf("safe_transfer_from", span)?.kind }).toEqual({
        length: span.length,
        kind: "unknown",
      });
      expect(summaryOf("safe_batch_transfer_from", span)?.kind).toBe("unknown");
    }
  });
});
