import type { ActivityEntry } from "@bramble/transactions/activity";
import type { SidepanelWallet } from "@bramble/wallet-ui/lab";
import {
  bindAddressBook,
  bindHomeUi,
  bindReceiveWalletCard,
  confirmationOutcome,
  DEPLOY_RECEIPT_COPY,
  outcomeReceiptFor,
  paintOutcomeReceipt,
} from "@bramble/wallet-ui/lab";
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
const DEPLOY_HASH = "0x5f2a7c19b4e86d30af51c8b27e94d6013a8f45c2e7b91d0a3c6e8f24b71d9053";

// The stage the binder reveals once the chain answers the deployment, painted
// through the writer and the copy the binder uses, because the fixture runtime
// submits nothing. The answer comes off the production status table, so a
// failure checkpoint shows the reason a reader would.
const paintDeployAnswer =
  (chainStatus: ActivityEntry["status"]) =>
  (context: FrameContext): void => {
    context.app.querySelector("#deploy-review-stage")?.setAttribute("hidden", "");
    context.app.querySelector("#deploy-success")?.removeAttribute("hidden");
    paintOutcomeReceipt(
      context.app,
      "deploy-success",
      outcomeReceiptFor(confirmationOutcome(chainStatus), DEPLOY_RECEIPT_COPY, DEPLOY_HASH),
      "SN_MAIN",
    );
  };

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

// The Advanced switch that reveals the wallet card and the keys is production
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
          signability: { readOnly: true, reason: "undeployed" },
        }),
      id: "undeployed-braavos",
      label: "Undeployed Braavos account",
      narrative:
        "A Braavos counterfactual deploys only through its own step, so Send and Swap wait for it and Home says where to deploy.",
      state: { accountDeployment: "required", send: "disabled", signability: "undeployed" },
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
        "The fee is quoted onto the screen, so Deploy is a decision the reader already has the number for.",
      state: { accountDeployment: "required", task: "deploy" },
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
      id: "deploy-submitted",
      label: "Account deployed",
      narrative:
        "The receipt every settled transaction ends on: what happened, one line saying what it means, and the identifier.",
      prepare: paintDeployAnswer("preconfirmed"),
      state: { accountDeployment: "confirmed", task: "receipt" },
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
      id: "deploy-failed",
      label: "Deployment failed",
      narrative:
        'A deployment the chain rejects turns the same receipt into the failure: its mark, the chain\'s reason, and the hash to look it up by — never "Account deployed".',
      prepare: paintDeployAnswer("rejected"),
      state: { accountDeployment: "required", chain: "rejected", task: "receipt" },
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
        "Label and address are the whole form; a shared wallet card and the manual key fields wait behind Advanced.",
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
    {
      content: () =>
        walletDashboard({
          allowanceNotices: ["scan-incomplete", "multisig-unread", "retention-full"],
          allowances,
          preferences: journeyPreferences,
          view: "allowances",
        }),
      id: "allowances-partial",
      label: "Partial allowance listing",
      narrative:
        "A scan that stopped early, an unread multisig, and a full log are each stated above the list.",
      state: { notices: 3 },
    },
    {
      content: () =>
        walletDashboard({
          allowances: [],
          allowancesUnavailable: true,
          preferences: journeyPreferences,
          view: "allowances",
        }),
      id: "allowances-unavailable",
      label: "Allowances not loaded",
      narrative: "A failed listing says so instead of claiming nothing is outstanding.",
      state: { loaded: false },
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
