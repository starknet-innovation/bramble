/**
 * Side panel screen composition. Dock screens (Home, Activity, Settings)
 * share the account-bar header and account drawer. Signer Home, Activity, and
 * Settings also share the bottom dock. A selected multisig retains that shared
 * identity across Home, Activity, and Settings while signing remains delegated
 * to an explicitly selected owned signer.
 * Every other view renders as a dedicated flow screen from ./flows.ts with its
 * own back navigation, so each journey has a distinct place to complete its
 * goal. Home follows a compact portfolio structure: hero balance, primary
 * actions, a trusted Terminal handoff, then the Tokens section.
 */

import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import type { DisplayCurrency, WalletPreferences } from "@bramble/settings/preferences";
import type { ClassHashVerification } from "@bramble/starknet/class-hash-verify";
import type { ActivityEntry } from "@bramble/transactions/activity";
import type { AllowanceView } from "@bramble/transactions/allowance-discovery";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type {
  ConnectedSite,
  DiscoveredNft,
  PendingApproval,
  SignabilityVerdict,
  TokenBalance,
  WalletStatus,
} from "../../../popup/responses/responses";
import { actionableApprovals, approvalTakeover } from "../../journeys/approvals/approval-screen";
import { nftSendFlow } from "../../journeys/collectibles/nft-send-view";
import {
  nftDetailFlow,
  nftGalleryFlow,
  nftHiddenFlow,
  nftWatchFlow,
} from "../../journeys/collectibles/nft-views";
import {
  multisigAddFlow,
  multisigReceiveFlow,
  multisigSignersFlow,
  multisigTrackFlow,
  multisigWatchFlow,
} from "../../journeys/multisig/multisig-management-views";
import type { MultisigPortfolioData } from "../../journeys/multisig/multisig-portfolio";
import {
  multisigDeployFlow,
  multisigDetailFlow,
  multisigProposeFlow,
  multisigsFlow,
} from "../../journeys/multisig/multisig-views";
import { activityContacts } from "../../journeys/portfolio/activity-filter";
import { activityScreen, requestsFlow } from "../../journeys/portfolio/activity-views";
import { homeScreen, strkAvailableForFees } from "../../journeys/portfolio/home-view";
import { tokenCatalogFlow } from "../../journeys/portfolio/token-catalog-view";
import {
  DEFAULT_CURRENCY,
  tokenAddFlow,
  tokenDetailFlow,
  tokenDiscoverFlow,
  tokensFlow,
} from "../../journeys/portfolio/token-flows";
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "../../journeys/privacy/privacy-model";
import { privacyFlow } from "../../journeys/privacy/privacy-views";
import type { SendIntent } from "../../journeys/send/send-model";
import { revealFlow } from "../../journeys/settings/reveal-ui";
import { settingsScreen } from "../../journeys/settings/settings-views";
import type { BalanceState } from "../../runtime/runtime";
import { networkDataIssue, privacyDataIssue } from "../../shared/network-status";
import { activeAccount, isWalletView, WALLET_VIEWS, type WalletView } from "../../shared/parts";
import { accountDrawer } from "../../shell/account-drawer";
import { INITIAL_COLLAPSED_FOLDERS } from "../../shell/drawer-folders";
import { walletDock, walletHeader } from "../../shell/wallet-shell";
import { backupFlow, simpleFlowScreen } from "./flows";

/**
 * Re-exported screen contract so entrypoints and tests import one module.
 */
export { isWalletView, WALLET_VIEWS, type WalletView };

type JourneyContext = {
  readonly deployment: boolean | null;
  readonly account: AccountRef | null;
  readonly chart: readonly number[];
  readonly currency: DisplayCurrency;
  readonly discoveredNfts: readonly DiscoveredNft[];
  readonly multisigClassDeclared: boolean | "error" | null;
  readonly multisigPortfolio: MultisigPortfolioData;
  readonly multisigIntents: readonly ArgentMultisigSigningIntent[];
  readonly multisigs: readonly ArgentMultisigView[];
  readonly multisigsError: boolean;
  readonly preferences: WalletPreferences | null;
  readonly fundedForFees: boolean | null;
  readonly prices: Readonly<Record<string, number>>;
  readonly privacy: PrivacyDisclosureState;
  readonly privacyJourney: PrivacyJourneyState;
  /** A pre-configured send from a shield or unshield shortcut. */
  readonly sendIntent?: SendIntent | null;
  readonly selectedMultisigId: string | null;
  readonly selectedMultisigIntentId: string | null;
  readonly selectedNftId: string | null;
  readonly selectedTokenId: string | null;
  readonly status: WalletStatus;
  readonly trackedBalances: readonly TokenBalance[];
};

const selectedMultisig = (context: JourneyContext): ArgentMultisigView | null =>
  context.multisigs.find(
    (view) =>
      view.record.id === context.selectedMultisigId &&
      view.record.networkId === context.status.networkId,
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
      context.multisigIntents,
      context.multisigsError,
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
      selectedMultisig(context),
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
      context.multisigIntents,
      context.multisigsError,
      context.preferences,
      activeView,
      context.multisigPortfolio,
      context.selectedMultisigIntentId,
    );
  }
  if (activeView === "multisig-signers") {
    return multisigSignersFlow(context.status, context.account, selected, context.preferences);
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
  if (activeView === "token-catalog") {
    return tokenCatalogFlow(context.status);
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
    context.deployment,
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
  multisigs: readonly ArgentMultisigView[] = [],
  multisigIntents: readonly ArgentMultisigSigningIntent[] = [],
  selectedMultisigId: string | null = null,
  multisigClassDeclared: boolean | "error" | null = null,
  collapsedFolders: readonly string[] = INITIAL_COLLAPSED_FOLDERS,
  expandedGroupId: string | null = null,
  priceStale = false,
  priceAsOf: number | null = null,
  discoveredNfts: readonly DiscoveredNft[] = [],
  addFolderOpen = false,
  classHashVerification: ClassHashVerification | null = null,
  historyUnavailable = false,
  snoozedApprovalIds: readonly string[] = [],
  multisigsError = false,
  multisigBalances: BalanceState = { error: "multisig balances unavailable" },
  multisigBalanceId: string | null = null,
  privacy: PrivacyDisclosureState = {
    error: null,
    loading: false,
    value: null,
  },
  privacyJourney: PrivacyJourneyState = { stage: "idle" },
  sendIntent: SendIntent | null = null,
  selectedMultisigIntentId: string | null = null,
  todayKey: number | null = null,
  signability: SignabilityVerdict | null = null,
): string => {
  const account = activeAccount(status);
  const currency = preferences?.displayCurrency ?? DEFAULT_CURRENCY;
  const trackedBalances = "balances" in balances ? balances.balances : [];
  const fundedForFees = strkAvailableForFees(balances);
  const selectedPortfolioBalances =
    selectedMultisigId !== null && multisigBalanceId === selectedMultisigId
      ? multisigBalances
      : { error: "Multisig balances are loading." };
  const journeyContext: JourneyContext = {
    deployment,
    account,
    chart,
    currency,
    fundedForFees,
    discoveredNfts,
    multisigClassDeclared,
    multisigPortfolio: {
      balances: selectedPortfolioBalances,
      changes,
      currency,
      prices,
    },
    multisigIntents,
    multisigs,
    multisigsError,
    preferences,
    prices,
    privacy,
    privacyJourney,
    selectedMultisigId,
    selectedMultisigIntentId,
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
    return approvalTakeover(actionable, status, activeView);
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
    selectedMultisigId,
    privacy,
    selectedTokenId,
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
    return privacyFlow(status, preferences, privacyJourney, privacy);
  }
  const sharedIdentity =
    activeView === "multisig-home" || activeView === "activity" || activeView === "settings"
      ? selectedMultisig(journeyContext)
      : null;
  const privacyIssue = privacyDataIssue(
    activeView,
    account,
    status,
    privacy,
    sharedIdentity !== null,
  );
  const networkIssue = [
    ...networkDataIssue(
      sharedIdentity ? selectedPortfolioBalances : balances,
      priceStale,
      priceAsOf,
      Object.keys(prices).length > 0,
    ),
    ...(privacyIssue ? [privacyIssue] : []),
  ].join(" ");
  const screen =
    activeView === "multisig-home"
      ? multisigDetailFlow(
          status,
          account,
          sharedIdentity,
          multisigIntents,
          multisigsError,
          preferences,
          "multisig-home",
          journeyContext.multisigPortfolio,
        )
      : activeView === "activity"
        ? activityScreen(
            pending,
            status,
            transactions,
            historyUnavailable,
            sharedIdentity?.record,
            {
              currency,
              prices,
              tokens: preferences?.tokens ?? [],
            },
            todayKey,
            activityContacts(preferences, status.networkId, status.accounts),
          )
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
              privacy,
              signability,
            );
  return `
    ${walletHeader(status, account, preferences, sharedIdentity?.record, networkIssue || null)}
    ${screen}
    ${walletDock(activeView, pending.length, sharedIdentity !== null)}
    ${accountDrawer(
      status,
      account,
      preferences,
      collapsedFolders,
      addFolderOpen,
      multisigs,
      multisigIntents,
      selectedMultisigId,
    )}`;
};
