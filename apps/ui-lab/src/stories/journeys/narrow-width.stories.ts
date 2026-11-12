import {
  assertInsidePanel,
  assertValueFits,
  LAB_META,
  type LabMeta,
  narrowSidepanelStory,
} from "../../runtime/story-helpers";

/**
 * Every main screen at the browser side panel's minimum width. The project
 * documents 320 CSS px as that panel's minimum (the 0.10.3 changelog records
 * "320px, and 256px under zoom"), and the panel has no horizontal scrollbar, so
 * a value that runs past the right edge is simply unreachable. These stories are
 * the regression guard: each renders an existing journey checkpoint through the
 * review bench's own 320 x 760 surface and fails if the panel scrolls
 * horizontally, any text overlaps other text or is cut off by its container,
 * or a named amount or address is clipped.
 */
const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "ready", scenarioId: "portfolio" },
  title: "Wallet journeys/11 Minimum panel width",
};

export default meta;

export const Portfolio = narrowSidepanelStory("Portfolio · 320px", "portfolio", "ready", [
  (document) => assertValueFits(document, ".hero-total"),
  (document) => assertValueFits(document, ".token-amount"),
]);

export const PortfolioPricesOffline = narrowSidepanelStory(
  "Portfolio prices offline · 320px",
  "portfolio",
  "prices-offline",
);

export const SendAmount = narrowSidepanelStory("Send amount · 320px", "send", "details", [
  (document) => assertValueFits(document, "#transfer-form"),
  (document) => assertInsidePanel(document, ".send-amount-meta"),
]);

export const SendReview = narrowSidepanelStory("Send review · 320px", "send", "review", [
  (document) => assertValueFits(document, "#send-review-fee .review-fee"),
]);

export const Activity = narrowSidepanelStory("Activity · 320px", "activity", "account-a", [
  (document) => assertInsidePanel(document, ".tx-hash"),
]);

export const Settings = narrowSidepanelStory("Settings hub · 320px", "settings-security", "hub");

export const PrivacyPortfolio = narrowSidepanelStory(
  "Private balances · 320px",
  "privacy",
  "public-portfolio",
);

export const Receive = narrowSidepanelStory("Receive · 320px", "assets", "receive", [
  (document) => assertValueFits(document, "[data-receive-address-text]"),
]);

export const ManageTokens = narrowSidepanelStory("Manage tokens · 320px", "assets", "tokens");

export const SettingsAppearance = narrowSidepanelStory(
  "Settings flow header · 320px",
  "settings-security",
  "appearance",
);

export const SettingsLanguage = narrowSidepanelStory(
  "Language choices · 320px",
  "settings-security",
  "language",
);

export const LedgerApproval = narrowSidepanelStory("Ledger approval · 320px", "ledger", "connect");

export const ConnectRequest = narrowSidepanelStory(
  "Connect request · 320px",
  "approvals",
  "connect",
);

export const MultisigReview = narrowSidepanelStory(
  "Multisig fee review · 320px",
  "multisig",
  "intent-fee-replacement",
);

export const StakingList = narrowSidepanelStory(
  "Staking list · 320px",
  "settings-security",
  "staking",
  [(document) => assertInsidePanel(document, ".staking-card")],
);

export const StakingListIncomplete = narrowSidepanelStory(
  "Staking list incomplete · 320px",
  "settings-security",
  "staking-incomplete",
  [(document) => assertInsidePanel(document, "[data-staking-paste]")],
);

export const StakingListUnreadable = narrowSidepanelStory(
  "Staking list couldn't load · 320px",
  "settings-security",
  "staking-paste-only",
  [(document) => assertInsidePanel(document, "[data-staking-paste]")],
);

export const StakingUnstakeReview = narrowSidepanelStory(
  "Staking unstake review · 320px",
  "settings-security",
  "staking-unstake-review",
  [(document) => assertInsidePanel(document, ".staking-review")],
);

export const StakingExitPending = narrowSidepanelStory(
  "Staking unstake waiting · 320px",
  "settings-security",
  "staking-exit-pending",
  [(document) => assertInsidePanel(document, ".staking-copy .hint")],
);

export const StakingClaimElsewhere = narrowSidepanelStory(
  "Staking claim paid elsewhere · 320px",
  "settings-security",
  "staking-claim-elsewhere",
  [(document) => assertInsidePanel(document, ".staking-review")],
);

export const HomeNftsDiscovered = narrowSidepanelStory(
  "Home NFTs, discovered · 320px",
  "nft-home",
  "home-nfts-discovered",
  [(document) => assertInsidePanel(document, ".nft-actions button")],
);
