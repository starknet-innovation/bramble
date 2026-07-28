import type { HomeTab } from "../../../src/sidepanel/home-tabs";
import { bindHomeUi } from "../../../src/sidepanel/home-ui";
import type { SidepanelWallet } from "../../../src/sidepanel/runtime";
import { discoveredNft, softwareAccount, statusFor } from "./fixtures";
import {
  allowances,
  ETH_TOKEN,
  emptyNetworkStatus,
  journeyBalances,
  journeyChanges,
  journeyPreferences,
  journeyPrices,
  STRK_TOKEN,
} from "./journey-fixtures";
import { walletDashboard } from "./scenario-dashboard";
import type { FrameContext, WalletScenario } from "./types";

const bindFixtureHome = (context: FrameContext): void => {
  let tab: HomeTab = context.app.querySelector(
    '[data-home-tab="collectibles"][aria-selected="true"]',
  )
    ? "collectibles"
    : "tokens";
  let drawerOpen = context.app.querySelector(".drawer-root")?.getAttribute("data-open") === "true";
  let drawerGroupFilter: string | null = null;
  const wallet = {
    addAccount: async () => softwareAccount.id,
    loadStatus: async () => statusFor(),
    setAccountInGroup: async () => undefined,
    setActiveAccount: async () => undefined,
  } as unknown as SidepanelWallet;
  bindHomeUi({
    app: context.app,
    drawerGroupFilter: () => drawerGroupFilter,
    drawerOpen: () => drawerOpen,
    homeTab: () => tab,
    networkId: () => "SN_MAIN",
    render: async () => undefined,
    setDrawerGroupFilter: (value) => {
      drawerGroupFilter = value;
    },
    setDrawerOpen: (value) => {
      drawerOpen = value;
    },
    setHomeTab: (value) => {
      tab = value;
    },
    wallet,
  });
};

const selectHomeTab =
  (tab: "collectibles") =>
  (context: FrameContext): void => {
    bindFixtureHome(context);
    const control = context.app.querySelector<HTMLButtonElement>(`[data-home-tab="${tab}"]`);
    if (!control) {
      throw new Error("Missing production portfolio tabs");
    }
    control.click();
  };

const openDrawer = (context: FrameContext): void => {
  bindFixtureHome(context);
  const trigger = context.app.querySelector<HTMLButtonElement>("#account-trigger");
  if (!trigger) {
    throw new Error("Missing production account drawer");
  }
  trigger.click();
};

const openPortfolioMenu = (context: FrameContext): void => {
  bindFixtureHome(context);
  const trigger = context.app.querySelector<HTMLButtonElement>("#portfolio-menu-trigger");
  if (!trigger) {
    throw new Error("Missing production portfolio actions");
  }
  trigger.click();
};

export const portfolioScenario: WalletScenario = {
  checkpoints: [
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          changes: journeyChanges,
          preferences: journeyPreferences,
          prices: journeyPrices,
        }),
      id: "ready",
      label: "Portfolio ready",
      narrative:
        "Balances, fiat value, change, four compact actions, and tracked assets form the home overview.",
      prepare: bindFixtureHome,
      state: { actions: 4, assets: 4, pricing: "current", tab: "tokens" },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          changes: journeyChanges,
          preferences: journeyPreferences,
          prices: journeyPrices,
        }),
      id: "major-actions",
      label: "Four major actions",
      narrative:
        "Send, Swap, Receive, and the Terminal portfolio share one compact row of 60-pixel square tools.",
      prepare: bindFixtureHome,
      state: {
        actions: ["send", "swap", "receive", "terminal-portfolio"],
        density: "extra-compact",
      },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          changes: journeyChanges,
          preferences: journeyPreferences,
          prices: journeyPrices,
        }),
      id: "quick-actions",
      label: "Portfolio quick actions",
      narrative:
        "One overflow menu progressively discloses asset management, settings, and refresh.",
      prepare: openPortfolioMenu,
      state: { actions: 4, disclosure: "open" },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          changes: journeyChanges,
          discoveredNfts: [discoveredNft],
          preferences: journeyPreferences,
          prices: journeyPrices,
        }),
      id: "collectibles",
      label: "Collectibles tab",
      narrative: "The owned collectible appears at useful gallery scale without leaving Home.",
      prepare: selectHomeTab("collectibles"),
      state: { artwork: "ready", tab: "collectibles" },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          preferences: journeyPreferences,
          prices: journeyPrices,
        }),
      id: "account-drawer",
      label: "Account drawer",
      narrative:
        "Switching, hardware provenance, folders, and management entry stay in one drawer.",
      prepare: openDrawer,
      state: { accounts: 3, folders: 2, overlay: "open" },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          deployment: false,
          preferences: journeyPreferences,
          prices: journeyPrices,
        }),
      id: "undeployed",
      label: "Counterfactual account",
      narrative:
        "An undeployed account exposes a precise deploy action before the user tries to send.",
      prepare: bindFixtureHome,
      state: { accountDeployment: "required", fundsAtRisk: false },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          preferences: journeyPreferences,
          priceStale: true,
          prices: {},
        }),
      id: "prices-offline",
      label: "Prices unavailable",
      narrative:
        "Known token balances remain useful while unavailable fiat pricing is stated honestly.",
      prepare: bindFixtureHome,
      state: { balances: "available", pricing: "unavailable" },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { error: "RPC endpoints unavailable" },
          preferences: journeyPreferences,
          prices: journeyPrices,
        }),
      id: "balance-error",
      label: "Balance refresh failed",
      narrative:
        "A transport failure presents an explicit retry state instead of an empty portfolio.",
      prepare: bindFixtureHome,
      state: { balances: "error", recovery: "refresh" },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: [] },
          preferences: journeyPreferences,
          prices: {},
          status: emptyNetworkStatus,
        }),
      id: "empty-network",
      label: "No account on network",
      narrative:
        "A network without a derived account explains the next action and disables transfers.",
      prepare: bindFixtureHome,
      state: { account: null, network: "SN_SEPOLIA" },
    },
  ],
  description:
    "Portfolio hierarchy, quick actions, account switching, deployment, and honest loading/error/empty states.",
  id: "portfolio",
  surface: "sidepanel",
  title: "Home and portfolio",
  views: ["home"],
};

export const assetsScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "receive" }),
      id: "receive",
      label: "Receive",
      narrative:
        "The active address, QR, copy controls, and network warning form one receiving task.",
      state: { account: softwareAccount.id, network: "SN_MAIN" },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          preferences: journeyPreferences,
          prices: journeyPrices,
          view: "tokens",
        }),
      id: "tokens",
      label: "Manage tokens",
      narrative:
        "Tracked, hidden, and likely-spam assets remain distinguishable while adding and discovery stay one level deeper.",
      state: { hidden: 1, likelySpam: 1, tracked: 4 },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "token-add" }),
      id: "token-add",
      label: "Add token by contract",
      narrative: "Manual token import is a focused contract-identity task.",
      state: { task: "manual import", view: "token-add" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "token-discover" }),
      id: "token-discover",
      label: "Find held tokens",
      narrative: "Curated registry discovery is a separate scan with honest spam handling.",
      state: { source: "curated registry", view: "token-discover" },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: [] },
          preferences: { ...journeyPreferences, tokens: [] },
          prices: {},
          view: "tokens",
        }),
      id: "tokens-empty",
      label: "No tracked tokens",
      narrative: "The empty list keeps focused import and discovery routes immediately available.",
      state: { tracked: 0 },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          chart: [3_210, 3_260, 3_190, 3_330, 3_410, 3_380, 3_584.42],
          preferences: journeyPreferences,
          selectedTokenId: ETH_TOKEN.id,
          view: "token-detail",
        }),
      id: "token-detail",
      label: "Token detail",
      narrative: "Price history, holdings, and verified contract facts share one focused view.",
      state: { chartPoints: 7, symbol: "ETH" },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          chart: [],
          preferences: journeyPreferences,
          prices: {},
          selectedTokenId: STRK_TOKEN.id,
          view: "token-detail",
        }),
      id: "token-offline",
      label: "Token price offline",
      narrative: "Holdings and contract identity survive unavailable market data.",
      state: { chart: "unavailable", holdings: "available", symbol: "STRK" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "address-book" }),
      id: "address-book",
      label: "Address book",
      narrative: "Saved recipients remain network-scoped and reusable from Send.",
      state: { saved: 1 },
    },
    {
      content: () =>
        walletDashboard({
          allowances,
          preferences: journeyPreferences,
          view: "allowances",
        }),
      id: "allowances",
      label: "Outstanding allowances",
      narrative: "Wallet-granted and on-chain approvals show spender, cap, provenance, and revoke.",
      state: { external: 1, unlimited: 1 },
    },
    {
      content: () =>
        walletDashboard({ allowances: [], preferences: journeyPreferences, view: "allowances" }),
      id: "allowances-empty",
      label: "No allowances",
      narrative: "The empty state accurately scopes what the wallet scans.",
      state: { outstanding: 0 },
    },
  ],
  description:
    "Receive, token management/detail, contacts, and ERC20 allowance review across ready and degraded states.",
  id: "assets",
  surface: "sidepanel",
  title: "Assets and permissions",
  views: [
    "receive",
    "tokens",
    "token-add",
    "token-discover",
    "token-detail",
    "address-book",
    "allowances",
  ],
};
