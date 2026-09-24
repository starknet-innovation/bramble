import type { SidepanelWallet } from "@bramble/wallet-ui/lab";
import { bindAddressBook, bindHomeUi, bindReceiveWalletCard } from "@bramble/wallet-ui/lab";
import { softwareAccount, statusFor } from "../fixtures/fixtures";
import {
  allowances,
  ETH_TOKEN,
  emptyNetworkStatus,
  journeyBalances,
  journeyChanges,
  journeyPreferences,
  journeyPrices,
  STRK_TOKEN,
} from "../fixtures/journey-fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import type { FrameContext, WalletScenario } from "../runtime/types";

const NOSTR_PUBLIC_KEY = "22".repeat(32);

const hydrateReceiveCard = async (context: FrameContext): Promise<void> => {
  bindReceiveWalletCard({
    app: context.app,
    render: async () => undefined,
    wallet: {
      loadNostrPublicKey: async () => NOSTR_PUBLIC_KEY,
    } as unknown as SidepanelWallet,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const showAddressOnlyReceiveCard = async (context: FrameContext): Promise<void> => {
  bindReceiveWalletCard({
    app: context.app,
    render: async () => undefined,
    wallet: {
      loadNostrPublicKey: async () => Promise.reject(new Error("Coordination unavailable")),
    } as unknown as SidepanelWallet,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const bindFixtureHome = (context: FrameContext): void => {
  let drawerOpen = context.app.querySelector(".drawer-root")?.getAttribute("data-open") === "true";
  const wallet = {
    addAccount: async () => softwareAccount.id,
    loadStatus: async () => statusFor(),
    setAccountInGroup: async () => undefined,
    setActiveAccount: async () => undefined,
  } as unknown as SidepanelWallet;
  bindHomeUi({
    app: context.app,
    drawerOpen: () => drawerOpen,
    networkId: () => "SN_MAIN",
    render: async () => undefined,
    setDrawerOpen: (value) => {
      drawerOpen = value;
    },
    wallet,
  });
};

const openDrawer = (context: FrameContext): void => {
  bindFixtureHome(context);
  const trigger = context.app.querySelector<HTMLButtonElement>("#account-trigger");
  if (!trigger) {
    throw new Error("Missing production account drawer");
  }
  trigger.click();
};

// The Pro switch that reveals the wallet card and the keys is production
// behaviour, so the checkpoint binds the real form; saving is out of scope here.
const bindFixtureAddressBook = (context: FrameContext): void => {
  bindAddressBook({
    app: context.app,
    render: async () => undefined,
    wallet: {} as unknown as SidepanelWallet,
  });
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
          balanceState: {
            asOf: 1_787_121_000_000,
            balances: journeyBalances,
            stale: true,
          },
          preferences: journeyPreferences,
          priceAsOf: 1_787_120_700_000,
          priceStale: true,
          prices: journeyPrices,
          privacy: { error: null, loading: true, value: null },
        }),
      id: "saved-data",
      label: "Saved data during outage",
      narrative:
        "Last-known balances remain usable while the orange network indicator reveals capture times on hover or focus.",
      prepare: bindFixtureHome,
      state: { balances: "saved", pricing: "saved", recovery: "automatic" },
    },
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
          deployment: false,
          preferences: journeyPreferences,
          prices: journeyPrices,
          view: "deploy-account",
        }),
      id: "deploy-account",
      label: "Deploy account review",
      narrative:
        "Single-signer deployment uses a dedicated transaction review and receipt rather than expanding Home.",
      state: { accountDeployment: "required", task: "review deployment" },
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
  views: ["home", "deploy-account"],
};

export const assetsScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "receive" }),
      id: "receive",
      label: "Receive",
      narrative:
        "One versioned wallet card carries the active Starknet address, signer key, and private coordination identity without exposing secret material.",
      prepare: hydrateReceiveCard,
      state: { account: softwareAccount.id, contactCard: "complete", network: "SN_MAIN" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "receive" }),
      id: "receive-preparing",
      label: "Receive card preparing",
      narrative:
        "The share control waits for the complete local coordination identity rather than exposing a partial contact card.",
      state: { contactCard: "preparing", share: "disabled" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "receive" }),
      id: "receive-address-only",
      label: "Receive without coordination",
      narrative:
        "If secure coordination is unavailable, the address QR remains useful and the unavailable complete card is not presented as shareable.",
      prepare: showAddressOnlyReceiveCard,
      state: { contactCard: "address-only", coordination: "unavailable" },
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
      content: () => walletDashboard({ preferences: journeyPreferences, view: "token-catalog" }),
      id: "token-catalog",
      label: "AVNU token list",
      narrative:
        "AVNU's verified list is a directory: adding from it reads the contract on chain, never the catalog's own claims.",
      state: { source: "AVNU catalog", view: "token-catalog" },
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
      narrative:
        "Label and address are the whole form; a shared wallet card and the manual key fields wait behind Pro.",
      prepare: bindFixtureAddressBook,
      state: { coordination: "ready", import: "wallet card", saved: 1 },
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
    "token-catalog",
    "token-discover",
    "token-detail",
    "address-book",
    "allowances",
  ],
};
