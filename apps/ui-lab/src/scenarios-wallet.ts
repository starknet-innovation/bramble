import {
  discoveredNft,
  ledgerAccount,
  softwareAccount,
  softwareActivity,
  statusFor,
} from "./fixtures";
import {
  allowances,
  connectedSites,
  ETH_TOKEN,
  emptyNetworkStatus,
  importedStatus,
  journeyBalances,
  journeyChanges,
  journeyPreferences,
  journeyPrices,
  STRK_TOKEN,
} from "./journey-fixtures";
import { walletDashboard } from "./scenario-dashboard";
import type { FrameContext, WalletScenario } from "./types";

const selectHomeTab =
  (tab: "activity" | "collectibles") =>
  (context: FrameContext): void => {
    const root = context.app.querySelector<HTMLElement>(".home-tabs");
    if (!root) {
      throw new Error("Missing production portfolio tabs");
    }
    root.dataset["activeTab"] = tab;
    root.querySelectorAll<HTMLButtonElement>("[data-home-tab]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset["homeTab"] === tab));
    });
    root.querySelectorAll<HTMLElement>("[data-tab-panel]").forEach((panel) => {
      panel.toggleAttribute("hidden", panel.dataset["tabPanel"] !== tab);
    });
    root.querySelectorAll<HTMLElement>("[data-tab-actions]").forEach((actions) => {
      actions.toggleAttribute("hidden", actions.dataset["tabActions"] !== tab);
    });
  };

const openDrawer = (context: FrameContext): void => {
  const drawer = context.app.querySelector<HTMLElement>(".drawer-root");
  if (!drawer) {
    throw new Error("Missing production account drawer");
  }
  drawer.dataset["open"] = "true";
  context.app.querySelector<HTMLElement>("#account-trigger")?.setAttribute("aria-expanded", "true");
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
        "Balances, fiat value, change, actions, and tracked assets form the home overview.",
      state: { assets: 4, pricing: "current", tab: "tokens" },
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
          activity: softwareActivity,
          balanceState: { balances: journeyBalances },
          preferences: journeyPreferences,
          prices: journeyPrices,
        }),
      id: "recent-activity",
      label: "Recent activity tab",
      narrative:
        "Recent account-scoped transactions are accessible without losing portfolio context.",
      prepare: selectHomeTab("activity"),
      state: { entries: 2, tab: "activity" },
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
      state: { account: null, network: "SN_SEPOLIA" },
    },
  ],
  description:
    "Portfolio content, tabs, account switching, deployment, and honest loading/error/empty states.",
  id: "portfolio",
  surface: "sidepanel",
  title: "Home and portfolio",
  views: ["home"],
};

const openAdvancedEndpoint = (context: FrameContext): void => {
  const disclosure = context.app.querySelector<HTMLDetailsElement>('[data-disclosure="rpc"]');
  if (!disclosure) {
    throw new Error("Missing production RPC disclosure");
  }
  disclosure.open = true;
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
      narrative: "Tracked, hidden, and likely-spam assets remain distinguishable and recoverable.",
      state: { hidden: 1, likelySpam: 1, tracked: 4 },
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
      narrative: "Token import and curated detection remain available from the empty state.",
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
  views: ["receive", "tokens", "token-detail", "address-book", "allowances"],
};

export const settingsScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "settings" }),
      id: "hub",
      label: "Settings hub",
      narrative:
        "Display, request routing, wallet, connections, and security are grouped by intent.",
      state: { requestSurface: "side-panel", theme: "dark" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "network" }),
      id: "network",
      label: "Choose network",
      narrative:
        "Network selection leads while custom infrastructure remains one deliberate level deeper.",
      state: { networks: 2, rpc: "custom" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "network" }),
      id: "advanced-endpoints",
      label: "Advanced endpoints",
      narrative:
        "RPC, privacy prover, and NFT indexer controls include their trust and fallback context.",
      prepare: openAdvancedEndpoint,
      state: { disclosure: "rpc", state: "open" },
    },
    {
      content: () =>
        walletDashboard({
          classHashVerification: {
            onChainClassHash: softwareAccount.classHash,
            status: "verified",
          },
          expandedGroupId: "operations",
          preferences: journeyPreferences,
          view: "account",
        }),
      id: "accounts",
      label: "Accounts and groups",
      narrative:
        "Switching, adding, importing, Ledger, folders, naming, and on-chain identity coexist.",
      state: { classHash: "verified", group: "operations" },
    },
    {
      content: () =>
        walletDashboard({
          classHashVerification: {
            expectedClassHash: softwareAccount.classHash,
            onChainClassHash: "0x999",
            status: "mismatch",
          },
          preferences: journeyPreferences,
          view: "account",
        }),
      id: "class-mismatch",
      label: "Account class mismatch",
      narrative:
        "A contract identity mismatch is assertive and never presented as a benign loading error.",
      state: { classHash: "mismatch", trust: "blocked" },
    },
    {
      content: () =>
        walletDashboard({
          connectedSites,
          preferences: journeyPreferences,
          view: "connected-sites",
        }),
      id: "connected-sites",
      label: "Connected sites",
      narrative: "Every active origin shows its granted account count and direct revocation.",
      state: { origins: 2 },
    },
    {
      content: () =>
        walletDashboard({
          connectedSites: [],
          preferences: journeyPreferences,
          view: "connected-sites",
        }),
      id: "connected-empty",
      label: "No connected sites",
      narrative: "The empty state explains exactly how a site will appear here.",
      state: { origins: 0 },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "backup" }),
      id: "backup",
      label: "Mixed-wallet backup",
      narrative:
        "Export scope and the separate Ledger recovery boundary are explicit before download.",
      state: { includesLedger: true, secretsExported: false },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "reveal" }),
      id: "reveal-software",
      label: "Software recovery",
      narrative: "Software secrets require fresh passphrase authentication and remain masked.",
      state: { accountKind: "software", reauthentication: true },
    },
    {
      content: () =>
        walletDashboard({
          preferences: {
            ...journeyPreferences,
            accountLabels: {
              ...journeyPreferences.accountLabels,
              [importedStatus.activeAccountId ?? ""]: "Imported signer",
            },
          },
          status: importedStatus,
          view: "reveal",
        }),
      id: "reveal-imported",
      label: "Imported-key recovery",
      narrative:
        "The wallet warns that its recovery phrase cannot restore a standalone imported key.",
      state: { accountKind: "imported", recoveryBoundary: "separate key" },
    },
    {
      content: () =>
        walletDashboard({
          preferences: journeyPreferences,
          status: statusFor(ledgerAccount),
          view: "reveal",
        }),
      id: "reveal-ledger",
      label: "Ledger recovery",
      narrative: "Hardware accounts never fabricate a wallet phrase or private-key reveal path.",
      state: { accountKind: "ledger", keysLeaveDevice: false },
    },
  ],
  description:
    "Settings, networks, accounts/groups, connected origins, backup, and recovery boundaries.",
  id: "settings-security",
  surface: "sidepanel",
  title: "Settings and security",
  views: ["settings", "network", "account", "backup", "connected-sites", "reveal"],
};
