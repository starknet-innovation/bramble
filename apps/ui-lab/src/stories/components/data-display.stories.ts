import { receipt } from "@mc-wallet/ui-kit/content";
import { balanceRow, transactionRow } from "@mc-wallet/wallet-ui/lab";
import type { Meta } from "@storybook/html-vite";
import { balances, softwareActivity } from "../../fixtures/fixtures";
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
const activityExamples = [
  accepted,
  { ...accepted, hash: "0x702", kind: "invoke" as const, summary: "Swap 50 USDC for STRK" },
  { ...accepted, hash: "0x703", kind: "invoke" as const, summary: "Stake 20 STRK" },
  { ...accepted, hash: "0x704", kind: "invoke" as const, summary: "Claim rewards" },
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
      "Activity is account-partitioned in data and concise in presentation: action summary, hash, liveness state, and copy affordance.",
      catalogGroup(
        "Transaction types",
        "Distinct glyphs make transfers, swaps, staking, and other contract interactions scannable before reading.",
        catalogSample(
          "Accepted activity",
          `<ul class="tx-list">${activityExamples.map(transactionRow).join("")}</ul>`,
          "catalog-card-limit",
        ),
      ),
      args.theme,
    ),
};
