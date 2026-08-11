import { approvalCard } from "@mc-wallet/wallet-ui/sidepanel/approval-cards";
import { collectibleCard } from "@mc-wallet/wallet-ui/sidepanel/home-tabs";
import { nftGalleryCard, visibleNftItems } from "@mc-wallet/wallet-ui/sidepanel/nft-views";
import { reviewPanel } from "@mc-wallet/wallet-ui/sidepanel/review-render";
import type { Meta } from "@storybook/html-vite";
import { CATALOG_META, type CatalogArgs, type CatalogStory, catalogFrame } from "./catalog-frame";
import { catalogGroup, catalogSample } from "./catalog-markup";
import { discoveredNft, invokeApproval, preferences, statusFor } from "./fixtures";

const meta = {
  ...CATALOG_META,
  title: "Design system/05 Cards",
} satisfies Meta<CatalogArgs>;

export default meta;

const collectible = visibleNftItems(preferences.nfts ?? [], [discoveredNft], "SN_MAIN")[0];
if (!collectible) {
  throw new Error("Missing UI Lab collectible fixture");
}

export const RequestCards: CatalogStory = {
  name: "Request cards",
  render: (args) =>
    catalogFrame(
      "Request cards",
      "Security-sensitive requests make origin, account context, decoded calls, risk information, and the decision explicit.",
      catalogGroup(
        "Transaction request",
        "Rendered by the production approval-card dispatcher.",
        `<div class="catalog-card-limit"><ul class="request-list">${approvalCard(invokeApproval, statusFor())}</ul></div>`,
      ),
      args.theme,
    ),
};

export const CollectibleCards: CatalogStory = {
  name: "Collectible cards",
  render: (args) =>
    catalogFrame(
      "Collectible cards",
      "Compact portfolio and gallery cards share the resolved NFT model while preserving image privacy and provenance.",
      catalogGroup(
        "Portfolio and gallery",
        "Both specimens are the exact production renderers.",
        `<div class="catalog-grid wide">
          ${catalogSample("Portfolio card", `<ul class="collectible-grid catalog-nft-limit">${collectibleCard(collectible, true)}</ul>`)}
          ${catalogSample("Gallery card", `<ul class="nft-grid catalog-nft-limit">${nftGalleryCard(collectible, true)}</ul>`)}
        </div>`,
      ),
      args.theme,
    ),
};

export const ReviewPanels: CatalogStory = {
  name: "Review panels",
  render: (args) =>
    catalogFrame(
      "Review panels",
      "The same risk vocabulary is shared by dapp approvals and in-wallet transaction review.",
      catalogGroup(
        "Risk and insight",
        "Flags name the concrete issue and remain neutral when no issue exists.",
        `<div class="catalog-card-limit">${reviewPanel([
          "This approval is broader than the amount being sent.",
          "The destination contract is not in the wallet token registry.",
        ])}</div>`,
      ),
      args.theme,
    ),
};
