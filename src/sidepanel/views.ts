/**
 * Side panel screen composition. Dock screens (Home, Activity, Settings)
 * share the account-bar header and account drawer. Signer Home, Activity, and
 * Settings also share the bottom dock. A selected multisig retains that shared
 * identity across Home, Activity, and Settings while signing remains delegated
 * to an explicitly selected owned signer.
 * Every other view renders as a dedicated flow screen from ./flows.ts with its
 * own back navigation, so each journey has a distinct place to complete its
 * goal. Home follows a compact portfolio structure: hero balance, primary
 * actions, a trusted Terminal handoff, then the Tokens/Collectibles section.
 */

import type { MultisigClassState } from "../popup/multisig-responses";
import type {
  ConnectedSite,
  DiscoveredNft,
  PendingApproval,
  TokenBalance,
  WalletStatus,
} from "../popup/responses";
import type { AllowanceView } from "../starknet/allowance-discovery";
import type { ClassHashVerification } from "../starknet/class-hash-verify";
import type { ActivityEntry } from "../storage/activity-store";
import type { MultisigProposalRecord, MultisigRecord } from "../storage/multisig-store";
import type { DisplayCurrency, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { accountDrawer } from "./account-drawer";
import { activityScreen, requestsFlow } from "./activity-views";
import { actionableApprovals, approvalTakeover } from "./approval-screen";
import { backupFlow, simpleFlowScreen } from "./flows";
import { homeScreen } from "./home-view";
import {
  multisigAddFlow,
  multisigReceiveFlow,
  multisigSignersFlow,
  multisigTrackFlow,
  multisigWatchFlow,
} from "./multisig-management-views";
import type { MultisigPortfolioData } from "./multisig-portfolio";
import type { MultisigSyncState } from "./multisig-sync";
import {
  multisigDeployFlow,
  multisigDetailFlow,
  multisigProposeFlow,
  multisigsFlow,
} from "./multisig-views";
import { nftSendFlow } from "./nft-send-view";
import { nftDetailFlow, nftGalleryFlow, nftHiddenFlow, nftWatchFlow } from "./nft-views";
import { activeAccount, isWalletView, WALLET_VIEWS, type WalletView } from "./parts";
import type { PrivacyDisclosureState, PrivacyJourneyState } from "./privacy-model";
import { privacyFlow } from "./privacy-views";
import { revealFlow } from "./reveal-ui";
import type { BalanceState } from "./runtime";
import type { SendIntent } from "./send-model";
import { settingsScreen } from "./settings-views";
import {
  DEFAULT_CURRENCY,
  tokenAddFlow,
  tokenDetailFlow,
  tokenDiscoverFlow,
  tokensFlow,
} from "./token-flows";
import { walletDock, walletHeader } from "./wallet-shell";

/**
 * Re-exported screen contract so entrypoints and tests import one module.
 */
export { isWalletView, WALLET_VIEWS, type WalletView };

type JourneyContext = {
  readonly account: AccountRef | null;
  readonly chart: readonly number[];
  readonly currency: DisplayCurrency;
  readonly discoveredNfts: readonly DiscoveredNft[];
  readonly multisigClassDeclared: MultisigClassState | "error" | null;
  readonly multisigPortfolio: MultisigPortfolioData;
  readonly multisigProposals: readonly MultisigProposalRecord[];
  readonly multisigSync: MultisigSyncState;
  readonly multisigs: readonly MultisigRecord[];
  readonly multisigsError: boolean;
  readonly preferences: WalletPreferences | null;
  readonly prices: Readonly<Record<string, number>>;
  readonly privacy: PrivacyDisclosureState;
  readonly privacyJourney: PrivacyJourneyState;
  /** A pre-configured send from a shield or unshield shortcut. */
  readonly sendIntent?: SendIntent | null;
  readonly selectedMultisigId: string | null;
  readonly selectedNftId: string | null;
  readonly selectedTokenId: string | null;
  readonly status: WalletStatus;
  readonly trackedBalances: readonly TokenBalance[];
};

const selectedMultisig = (context: JourneyContext): MultisigRecord | null =>
  context.multisigs.find(
    (record) =>
      record.id === context.selectedMultisigId && record.networkId === context.status.networkId,
  ) ?? null;

const multisigJourneyScreen = (activeView: WalletView, context: JourneyContext): string | null => {
  if (activeView === "multisig-home") {
    return null;
  }
  if (activeView === "multisig-add") {
    return multisigAddFlow(context.status, context.account);
  }
  if (activeView === "multisigs") {
    return multisigsFlow(
      context.status,
      context.account,
      context.multisigs,
      context.multisigProposals,
      context.multisigsError,
      context.multisigSync,
    );
  }
  if (activeView === "multisig-watch") {
    return multisigWatchFlow(context.status, context.account);
  }
  if (activeView === "multisig-deploy") {
    return multisigDeployFlow(
      context.status,
      context.account,
      context.multisigClassDeclared,
      context.preferences,
    );
  }
  if (
    activeView !== "multisig-detail" &&
    activeView !== "multisig-propose" &&
    activeView !== "multisig-signers" &&
    activeView !== "multisig-track" &&
    activeView !== "multisig-receive"
  ) {
    return null;
  }
  const selected = selectedMultisig(context);
  if (activeView === "multisig-detail") {
    return multisigDetailFlow(
      context.status,
      context.account,
      selected,
      context.multisigProposals,
      context.multisigsError,
      context.multisigSync,
      context.preferences,
      activeView,
      context.multisigPortfolio,
    );
  }
  if (activeView === "multisig-signers") {
    return multisigSignersFlow(context.status, context.account, selected);
  }
  if (activeView === "multisig-receive") {
    return multisigReceiveFlow(context.status, selected);
  }
  return activeView === "multisig-track"
    ? multisigTrackFlow(context.status, selected)
    : multisigProposeFlow(context.status, selected, context.preferences, context.multisigPortfolio);
};

const collectibleJourneyScreen = (
  activeView: WalletView,
  context: JourneyContext,
): string | null => {
  if (activeView === "nfts") {
    return nftGalleryFlow(
      context.status,
      context.account,
      context.preferences,
      context.discoveredNfts,
    );
  }
  if (activeView === "nft-watch") {
    return nftWatchFlow(context.status, context.account);
  }
  if (activeView === "nft-hidden") {
    return nftHiddenFlow(
      context.status,
      context.preferences,
      context.account,
      context.discoveredNfts,
    );
  }
  if (activeView === "nft-detail") {
    return nftDetailFlow(
      context.status,
      context.account,
      context.preferences,
      context.selectedNftId,
      context.discoveredNfts,
    );
  }
  return activeView === "nft-send"
    ? nftSendFlow(
        context.status,
        context.account,
        context.preferences,
        context.selectedNftId,
        context.discoveredNfts,
      )
    : null;
};

const assetJourneyScreen = (activeView: WalletView, context: JourneyContext): string | null => {
  if (activeView === "tokens") {
    return tokensFlow(
      context.status,
      context.preferences,
      context.trackedBalances,
      context.prices,
      context.currency,
    );
  }
  if (activeView === "token-add") {
    return tokenAddFlow(context.status);
  }
  if (activeView === "token-discover") {
    return tokenDiscoverFlow(context.status);
  }
  if (activeView !== "token-detail") {
    return null;
  }
  const token = (context.preferences?.tokens ?? []).find(
    (stored) =>
      stored.id === context.selectedTokenId && stored.networkId === context.status.networkId,
  );
  if (!token) {
    return null;
  }
  const price =
    context.chart.length > 0
      ? (context.chart[context.chart.length - 1] ?? null)
      : (context.prices[token.address] ?? null);
  return tokenDetailFlow(
    context.status,
    token,
    context.trackedBalances.find((balance) => balance.id === token.id),
    context.chart,
    price,
    context.currency,
    context.privacy,
  );
};

/**
 * Renders the unlocked wallet for the active screen: dock screens with the
 * shared shell, flow screens standalone. `deployment` is the active account's
 * on-chain contract status (null while unknown).
 */
export const dashboard = (
  activeView: WalletView,
  status: WalletStatus,
  pending: readonly PendingApproval[],
  preferences: WalletPreferences | null,
  balances: BalanceState,
  deployment: boolean | null = null,
  transactions: readonly ActivityEntry[] = [],
  connectedSites: readonly ConnectedSite[] = [],
  prices: Readonly<Record<string, number>> = {},
  chart: readonly number[] = [],
  selectedTokenId: string | null = null,
  allowances: readonly AllowanceView[] = [],
  selectedNftId: string | null = null,
  changes: Readonly<Record<string, number>> = {},
  multisigs: readonly MultisigRecord[] = [],
  multisigProposals: readonly MultisigProposalRecord[] = [],
  selectedMultisigId: string | null = null,
  multisigClassDeclared: MultisigClassState | "error" | null = null,
  drawerGroupFilter: string | null = null,
  expandedGroupId: string | null = null,
  priceStale = false,
  _priceAsOf: number | null = null,
  discoveredNfts: readonly DiscoveredNft[] = [],
  openAssignId: string | null = null,
  classHashVerification: ClassHashVerification | null = null,
  historyUnavailable = false,
  snoozedApprovalIds: readonly string[] = [],
  multisigsError = false,
  multisigSync: MultisigSyncState = null,
  multisigBalances: BalanceState = { error: "multisig balances unavailable" },
  multisigBalanceId: string | null = null,
  multisigNfts: readonly DiscoveredNft[] = [],
  multisigNftId: string | null = null,
  privacy: PrivacyDisclosureState = {
    error: null,
    loading: false,
    value: null,
  },
  privacyJourney: PrivacyJourneyState = { stage: "idle" },
  sendIntent: SendIntent | null = null,
): string => {
  const account = activeAccount(status);
  const currency = preferences?.displayCurrency ?? DEFAULT_CURRENCY;
  const trackedBalances = "balances" in balances ? balances.balances : [];
  const selectedPortfolioBalances =
    selectedMultisigId !== null && multisigBalanceId === selectedMultisigId
      ? multisigBalances
      : { error: "Shared balances are loading." };
  const journeyContext: JourneyContext = {
    account,
    chart,
    currency,
    discoveredNfts,
    multisigClassDeclared,
    multisigPortfolio: {
      balances: selectedPortfolioBalances,
      changes,
      currency,
      nfts:
        selectedMultisigId !== null && multisigNftId === selectedMultisigId ? multisigNfts : null,
      prices,
    },
    multisigProposals,
    multisigSync,
    multisigs,
    multisigsError,
    preferences,
    prices,
    privacy,
    privacyJourney,
    selectedMultisigId,
    selectedNftId,
    selectedTokenId,
    ...(sendIntent ? { sendIntent } : {}),
    status,
    trackedBalances,
  };
  // A fresh external request always becomes the wallet's foreground task,
  // regardless of which dock or flow screen was previously open. The user may
  // explicitly snooze it back to Activity after seeing it.
  const actionable = actionableApprovals(pending, snoozedApprovalIds);
  if (actionable.length > 0) {
    return approvalTakeover(actionable, status);
  }
  if (activeView === "requests") {
    return requestsFlow(pending, status);
  }
  const simpleFlow = simpleFlowScreen(activeView, {
    account,
    allowances,
    balances: trackedBalances,
    changes,
    classHashVerification,
    connectedSites,
    currency,
    deployment,
    expandedGroupId,
    multisigs,
    preferences,
    prices,
    privacy,
    selectedMultisigId,
    ...(sendIntent ? { sendIntent } : {}),
    status,
  });
  if (simpleFlow !== null) {
    return simpleFlow;
  }
  const multisigScreen = multisigJourneyScreen(activeView, journeyContext);
  if (multisigScreen !== null) {
    return multisigScreen;
  }
  const collectibleScreen = collectibleJourneyScreen(activeView, journeyContext);
  if (collectibleScreen !== null) {
    return collectibleScreen;
  }
  if (activeView === "backup") {
    return backupFlow(status);
  }
  const assetScreen = assetJourneyScreen(activeView, journeyContext);
  if (assetScreen !== null) {
    return assetScreen;
  }
  if (activeView === "reveal") {
    return revealFlow(status);
  }
  if (activeView === "privacy") {
    return privacyFlow(status, preferences, privacyJourney);
  }
  const sharedIdentity =
    activeView === "multisig-home" || activeView === "activity" || activeView === "settings"
      ? selectedMultisig(journeyContext)
      : null;
  const screen =
    activeView === "multisig-home"
      ? multisigDetailFlow(
          status,
          account,
          sharedIdentity,
          multisigProposals,
          multisigsError,
          multisigSync,
          preferences,
          "multisig-home",
          journeyContext.multisigPortfolio,
        )
      : activeView === "activity"
        ? activityScreen(pending, status, transactions, historyUnavailable, sharedIdentity)
        : activeView === "settings"
          ? settingsScreen(status, preferences)
          : homeScreen(
              status,
              account,
              balances,
              pending.length,
              deployment,
              preferences,
              prices,
              changes,
              currency,
              priceStale,
              discoveredNfts,
              privacy,
            );
  return `
    ${walletHeader(status, account, preferences, sharedIdentity)}
    ${screen}
    ${walletDock(activeView, pending.length, sharedIdentity !== null)}
    ${accountDrawer(
      status,
      account,
      preferences,
      drawerGroupFilter,
      openAssignId,
      multisigs,
      multisigProposals,
      selectedMultisigId,
    )}`;
};
