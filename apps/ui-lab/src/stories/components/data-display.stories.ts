import type { ActivityEntry } from "@bramble/transactions/activity";
import { receipt } from "@bramble/ui-kit/content";
import { balanceRow, relayLinks, transactionRow } from "@bramble/wallet-ui/lab";
import type { Meta } from "@storybook/html-vite";
import {
  balances,
  preferences,
  RECIPIENT_ADDRESS,
  softwareActivity,
  USDC_ADDRESS,
} from "../../fixtures/fixtures";
import {
  CATALOG_META,
  type CatalogArgs,
  type CatalogStory,
  catalogFrame,
} from "../../runtime/catalog-frame";
import { catalogGroup, catalogSample } from "../../runtime/catalog-markup";

const meta = {
  ...CATALOG_META,
  title: "Design system/04 Data display",
} satisfies Meta<CatalogArgs>;

export default meta;

const balance = balances[0];
const accepted = softwareActivity[0];
if (!balance || !accepted) {
  throw new Error("Missing UI Lab data-display fixtures");
}
// Priced through the same fixture price the wallet frame uses, so the USDC
// rows carry a signed fiat delta while STRK (unpriced here) shows its amount alone.
const pricing = {
  currency: "usd" as const,
  prices: { [USDC_ADDRESS]: 1 },
  tokens: preferences.tokens,
};
// A bare base (no amount, counterparty, or token) so each example declares
// exactly the fields its row anatomy demonstrates.
const { amount: _amount, counterparty: _counterparty, token: _token, ...bareAccepted } = accepted;
const activityExamples: readonly ActivityEntry[] = [
  {
    ...bareAccepted,
    amount: "12.5",
    counterparty: RECIPIENT_ADDRESS,
    hash: "0x711",
    summary: "Received 12.5 USDC from 0x4567…cdef",
    token: "USDC",
  },
  accepted,
  {
    ...bareAccepted,
    amount: "50",
    hash: "0x702",
    kind: "invoke",
    summary: "Swap 50 USDC for STRK",
    token: "USDC",
  },
  {
    ...bareAccepted,
    amount: "20",
    hash: "0x703",
    kind: "invoke",
    summary: "Stake 20 STRK",
    token: "STRK",
  },
  { ...bareAccepted, hash: "0x704", kind: "invoke", summary: "Claim rewards" },
  {
    ...bareAccepted,
    hash: "0x705",
    kind: "invoke",
    status: "pending",
    summary: "Supplied 200 USDC to Vesu",
  },
];

// Relay rows: a local "signed for relay" authorisation and the execution a scan
// found for it. The pair shares a nonce, so relayLinks pairs them for display;
// the third row is a signed message still waiting for a relayer. Hashes and the
// dapp origin use the real shapes (a 62 digit felt, a full origin URL) so the
// wrapping and truncation of the rows are exercised, not just short specimens.
const RELAY_MESSAGE_HASH = `0x0${"9f1a".repeat(15)}0`;
const RELAY_EXECUTION_HASH = `0x0${"9f2b".repeat(15)}0`;
const RELAY_UNLINKED_HASH = `0x0${"9f3c".repeat(15)}0`;
const DAPP_ORIGIN = "https://relayer.example.org/dapp/outside-execution/approve?session=9f1a2b";
const relaySigned: ActivityEntry = {
  ...bareAccepted,
  hash: RELAY_MESSAGE_HASH,
  kind: "relay-signed",
  snip9: {
    callCount: 1,
    caller: "0x0",
    dappOrigin: DAPP_ORIGIN,
    messageHash: RELAY_MESSAGE_HASH,
    nonce: "0x2a",
    revision: "2",
  },
  status: "accepted",
  summary: "Signed for relay",
};
const relayExecution: ActivityEntry = {
  ...bareAccepted,
  counterparty: RECIPIENT_ADDRESS,
  hash: RELAY_EXECUTION_HASH,
  kind: "invoke",
  origin: "relay",
  snip9: { callCount: 1, caller: "0x0", nonce: "0x2a", revision: "2" },
  status: "accepted",
  summary: "Relayed execution",
};
const unlinkedSigned: ActivityEntry = {
  ...bareAccepted,
  hash: RELAY_UNLINKED_HASH,
  kind: "relay-signed",
  snip9: { callCount: 2, caller: "0x0", nonce: "0x3b", revision: "1" },
  status: "accepted",
  summary: "Signed for relay",
};
const relayPair: readonly ActivityEntry[] = [relaySigned, relayExecution];
const relayPairLinks = relayLinks(relayPair);

export const Receipts: CatalogStory = {
  render: (args) =>
    catalogFrame(
      "Receipts",
      "Review facts align labels and values on one calm surface so amounts, recipients, fees, and identifiers can be checked quickly.",
      catalogGroup(
        "Transaction facts",
        "Values are escaped and identifiers deliberately use the mono voice.",
        `<div class="catalog-card-limit">${receipt([
          { label: "Amount", value: "24 USDC" },
          {
            action: {
              attributes: { "data-copy": "0x031075ef90ad626d" },
              icon: "copy",
              label: "Copy recipient",
            },
            label: "Recipient",
            value: "0x031075ef…3755b9",
            valueStyle: "code",
          },
          { label: "Network fee", value: "≈ 0.0018 STRK" },
          { label: "Value change", value: "−4.2%", valueTone: "danger" },
        ])}</div>`,
      ),
      args.theme,
    ),
};

export const TokenRows: CatalogStory = {
  name: "Token rows",
  render: (args) =>
    catalogFrame(
      "Token rows",
      "A token row keeps identity, owned amount, fiat value, and directional change aligned without a card per asset.",
      catalogGroup(
        "Balance row",
        "This is the production home-row renderer with deterministic fixture data.",
        catalogSample(
          "Tracked token",
          `<ul class="token-list">${balanceRow(balance, 1, 0.01, "usd")}</ul>`,
          "catalog-card-limit",
        ),
      ),
      args.theme,
    ),
};

export const ActivityRows: CatalogStory = {
  name: "Activity rows",
  render: (args) =>
    catalogFrame(
      "Activity rows",
      "Activity is account-partitioned and concise: a 16px glyph and the verb name the event, the counterparty or asset pair sits flush beneath, the signed fiat delta and asset amount trail on the right, the token mark trails, only an unsettled row names its status, and the verb opens the transaction on Starkscan.",
      [
        catalogGroup(
          "Transaction types",
          "Distinct outline glyphs make transfers, swaps, staking, rewards, and other contract interactions scannable before reading; a row prices itself only when its token and price are both known.",
          catalogSample(
            "Activity rows",
            `<ul class="tx-list">${activityExamples.map((entry) => transactionRow(entry, pricing)).join("")}</ul>`,
            "catalog-card-limit",
          ),
        ),
        catalogGroup(
          "Relayed SNIP-9",
          "A signed-for-relay authorisation has no transaction of its own, so it shows its message hash without an explorer link or copy control and pairs with the execution found by nonce; a discovered execution keeps its explorer link, and an unrelayed signed message says so.",
          catalogSample(
            "Signed and relayed",
            `<ul class="tx-list">${[...relayPair, unlinkedSigned]
              .map((entry) => transactionRow(entry, pricing, relayPairLinks.get(entry) ?? null))
              .join("")}</ul>`,
            "catalog-card-limit",
          ),
        ),
      ].join(""),
      args.theme,
    ),
};
