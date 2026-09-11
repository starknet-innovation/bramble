import type { ActivityEntry } from "@bramble/transactions/activity";
import { receipt } from "@bramble/ui-kit/content";
import { balanceRow, transactionRow } from "@bramble/wallet-ui/lab";
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
      "Activity is account-partitioned and concise: an inline glyph and verb name the event, the counterparty or asset pair sits beneath, the signed fiat delta and asset amount trail on the right, and the verb opens the transaction on Starkscan.",
      catalogGroup(
        "Transaction types",
        "Distinct outline glyphs make transfers, swaps, staking, rewards, and other contract interactions scannable before reading; a row prices itself only when its token and price are both known.",
        catalogSample(
          "Activity rows",
          `<ul class="tx-list">${activityExamples.map((entry) => transactionRow(entry, pricing)).join("")}</ul>`,
          "catalog-card-limit",
        ),
      ),
      args.theme,
    ),
};
