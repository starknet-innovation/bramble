/** Primary side-panel UI and its scene-preserving paint loop. */
import type { LedgerConnector } from "@mc-wallet/ledger-protocol/session";
import { isWalletEventMessage } from "@mc-wallet/wallet-protocol/events";
import type { WalletStatus } from "../popup/responses";
import { bindClusterScreens } from "./cluster-ui";
import { bindAddressBook, bindApprovals } from "./dashboard-bindings";
import { createDeploymentCache } from "./deployment-cache";
import { bindDisclosures } from "./disclosures";
import { bindCopyButtons, showToast } from "./dom";
import { bindEndpointSettings } from "./endpoint-ui";
import { applyEntryTheme, bindEntryNavigation } from "./entry-ui";
import { locked, onboarding } from "./gate-views";
import { healTransientGroupState } from "./group-state";
import type { HomeTab } from "./home-tabs";
import { bindHomeUi } from "./home-ui";
import { hydrateView } from "./hydrate";
import { bindLedgerFirstRun } from "./ledger/first-run";
import { createLedgerOnboardEntry } from "./ledger/onboard-entry";
import { createLedgerSignRuntime } from "./ledger/sign-runtime";
import { createMultisigClient } from "./multisig-runtime";
import { shouldPreserveMultisigProposalSurface } from "./multisig-surface";
import { bindMultisigs } from "./multisig-ui";
import { type NavDirection, navDirection } from "./nav-direction";
import { popView, pushView, type ViewHistory } from "./nav-history";
import {
  bindOnboardingCompletion,
  onboardingComplete,
  onboardingLaunch,
} from "./onboarding-surface";
import { bindOnboarding, bindUnlock } from "./onboarding-ui";
import { createPrivacyController } from "./privacy-controller";
import { createRefreshScheduler } from "./refresh-scheduler";
import {
  emptyRenderCache,
  type RenderData,
  updateRenderScope,
  verificationForAccount,
} from "./render-cache";
import { bindReveal } from "./reveal-ui";
import { createSidepanelRuntime } from "./runtime";
import type { WalletUiBrowser } from "./runtime-global";
import { createMutationRuntime } from "./runtime-refresh";
import { createSceneRenderer } from "./scene-renderer";
import type { SendIntent } from "./send-model";
import { bindSettingsSurface } from "./settings-surface";
import { bindDashboard, bindDeploy, bindPickers, deploymentPollScope } from "./shell-bindings";
import { createSwapClient } from "./swap-client";
import { bindSwap } from "./swap-ui";
import * as transfer from "./transfer-bindings";
import { withTransactionAlerts } from "./tx-alerts-ui";
import { dashboard, type WalletView } from "./views";

/**
 * Starts the wallet surface with an injected browser-owned Ledger capability.
 * Startup fails closed when the extension runtime or required DOM root is absent.
 */
export const startWalletUi = async (
  ledgerConnector: LedgerConnector,
  extensionApi?: WalletUiBrowser,
): Promise<void> => {
  const app = document.querySelector("#app");
  const fullPageOnboarding = document.body.classList.contains("onboarding-surface");
  const runtime = extensionApi?.runtime;
  const mutationRuntime = createMutationRuntime(runtime);
  const wallet = createSidepanelRuntime(mutationRuntime);
  const multisig = createMultisigClient(mutationRuntime);
  const swapClient = createSwapClient(mutationRuntime);
  let activeView: WalletView = "home";
  let selectedNftId: string | null = null;
  let selectedMultisigId: string | null = null;
  let lastAccountId: string | null = null;
  let lastNetworkId = "SN_MAIN";
  let lastScene = "";
  let lastContent = "";
  let lastSkinName = "";
  let lastActiveView: WalletView = "home";
  let viewHistory: ViewHistory = [];
  let forcedDirection: NavDirection | null = null;
  let selectedTokenId: string | null = null;
  let homeTab: HomeTab = "tokens";
  let drawerOpen = false;
  let drawerGroupFilter: string | null = null;
  let openAssignId: string | null = null;
  let expandedGroupId: string | null = null;
  let snoozedApprovalIds: readonly string[] = [];
  let sendIntent: SendIntent | null = null;

  const renderScene = createSceneRenderer(app, () => bindAll());

  const deployment = createDeploymentCache(wallet);
  const cache: RenderData = emptyRenderCache();
  let privacy: ReturnType<typeof createPrivacyController>;
  const ledgerSignMount = document.createElement("div");
  ledgerSignMount.className = "ledger-sign-overlay";
  ledgerSignMount.hidden = true;
  document.body.append(ledgerSignMount);
  const ledgerSign = createLedgerSignRuntime({
    connector: ledgerConnector,
    mount: ledgerSignMount,
    onSignatureReported: transfer.markTransferLedgerAuthorized,
    status: () => cache.status,
    wallet,
  });

  const ledgerOnboardMount = document.createElement("div");
  ledgerOnboardMount.className = "ledger-onboard-overlay";
  ledgerOnboardMount.hidden = true;
  document.body.append(ledgerOnboardMount);
  const ledgerOnboard = createLedgerOnboardEntry({
    addHd: async () => {
      await wallet.addAccount(lastNetworkId);
      showToast("Account added", "success");
    },
    cache,
    connector: ledgerConnector,
    mount: ledgerOnboardMount,
    openImport: () => navigate("import-key"),
    openMultisig: () => navigate("multisig-add"),
    refresh: async () => {
      await render(await wallet.loadStatus());
    },
    wallet,
  });

  const bindAll = (): void => {
    bindEntryNavigation(app, navigate, goBack);
    bindCopyButtons(app);
    bindOnboardingCompletion(app, extensionApi, () => globalThis.close());
    bindOnboarding({ app, render, wallet });
    bindLedgerFirstRun({ app, startLedgerSetup: ledgerOnboard.startLedgerSetup });
    bindUnlock({ app, render, wallet }, () => {
      activeView = "home";
      selectedMultisigId = null;
      viewHistory = [];
    });
    const shellDeps = {
      app,
      deploymentScope: () => deploymentPollScope(cache.status, () => cache.status),
      render,
      setActiveView: (view: WalletView) => {
        activeView = view;
        if (view === "home") selectedMultisigId = null;
      },
      wallet,
    };
    bindDashboard(shellDeps);
    bindDeploy(shellDeps);
    bindPickers(shellDeps);
    bindEndpointSettings({
      app,
      networkId: () => lastNetworkId,
      onStrk20ConfigChanged: () => privacy.reset(),
      render,
      wallet,
    });
    bindHomeUi({
      app,
      drawerGroupFilter: () => drawerGroupFilter,
      drawerOpen: () => drawerOpen,
      homeTab: () => homeTab,
      networkId: () => lastNetworkId,
      render,
      selectPortfolio: (id: string | null) => {
        selectedMultisigId = id;
        activeView = id ? "multisig-home" : "home";
        viewHistory = [];
        forcedDirection = "swap";
        paint();
      },
      setDrawerGroupFilter: (filter) => {
        drawerGroupFilter = filter;
      },
      setDrawerOpen: (open) => {
        drawerOpen = open;
      },
      setHomeTab: (tab) => {
        homeTab = tab;
      },
      startAddAccount: ledgerOnboard.startAddAccount,
      wallet,
    });
    bindReveal({ app, wallet });
    transfer.bindActivity({ app, render, wallet });
    transfer.bindTransfer({
      app,
      back: goBack,
      navigate: (view) => navigate(view),
      onPrivateSendSettled: () => privacy.invalidate(),
      privacy: () => privacy.disclosure(),
      publicBalances: () => ("balances" in cache.balances ? cache.balances.balances : []),
      render,
      reloadPrivacy: () => {
        void privacy.reload();
      },
      senderAddress: () =>
        cache.status.accounts.find((account) => account.id === cache.status.activeAccountId)
          ?.address ?? "",
      wallet,
    });
    bindSettingsSurface({
      activeAccountId: () => lastAccountId,
      app,
      expandedGroup: () => expandedGroupId,
      networkId: () => lastNetworkId,
      openAssign: () => openAssignId,
      refresh: () => wallet.loadStatus(),
      render,
      setExpandedGroup: (id: string | null) => {
        expandedGroupId = id;
      },
      setOpenAssign: (id: string | null) => {
        openAssignId = id;
      },
      startAddAccount: ledgerOnboard.startAddAccount,
      wallet,
    });
    bindAddressBook({ app, render, wallet });
    bindApprovals({
      app,
      render,
      snoozeApproval: (id) => {
        snoozedApprovalIds = [...snoozedApprovalIds, id];
        paint();
      },
      wallet,
    });
    bindDisclosures(app);
    ledgerOnboard.bindTriggers(app);
    bindSwap({
      app,
      balances: () => cache.balances,
      currency: () => cache.preferences?.displayCurrency ?? "usd",
      // Never yank a user who left while the swap completed.
      navigateHome: () => {
        if (activeView === "swap") {
          navigate("home");
        }
      },
      preferences: () => cache.preferences,
      render,
      status: () => cache.status,
      swap: swapClient,
      wallet,
    });
    bindClusterScreens({
      app,
      openNft: (id) => {
        selectedNftId = id;
        navigate("nft-detail");
      },
      openToken: (tokenId) => {
        selectedTokenId = tokenId;
        navigate("token-detail");
      },
      render,
      wallet,
    });
    privacy.bind();
    bindMultisigs({
      app,
      multisig,
      openDetail: (id) => {
        selectedMultisigId = id;
        navigate("multisig-home");
      },
      openList: () => {
        selectedMultisigId = null;
        navigate("multisigs");
      },
      render,
      selectedMultisigId: () => selectedMultisigId,
      wallet,
    });
  };

  const applyTheme = (): void => {
    lastSkinName = applyEntryTheme(
      cache.preferences?.theme ?? "dark",
      lastSkinName,
      document.documentElement,
    );
  };

  const paint = (): void => {
    const { status } = cache;
    lastNetworkId = status.networkId;
    lastAccountId = status.activeAccountId;
    // A shortcut's configuration seeds Send's first render and nothing else. Any
    // paint of another view means it was abandoned, so it cannot resurface on a
    // later visit to Send. Enforced here because this is the one place every view
    // transition passes through — five of the six assign activeView directly, and
    // guarding only `navigate` let a closed shield leak into the next send.
    if (activeView !== "send") {
      sendIntent = null;
    }
    applyTheme();
    const scene =
      fullPageOnboarding && status.hasVault
        ? "onboarding-complete"
        : !status.hasVault
          ? "onboarding"
          : status.locked
            ? "locked"
            : `dashboard:${activeView}`;
    const animate = scene !== lastScene;
    lastScene = scene;
    const direction = forcedDirection ?? navDirection(lastActiveView, activeView);
    forcedDirection = null;
    const healed = healTransientGroupState(
      { drawerGroupFilter, expandedGroupId, openAssignId },
      cache.preferences?.groups ?? [],
      status.accounts.map((stored) => stored.id),
    );
    drawerGroupFilter = healed.drawerGroupFilter;
    expandedGroupId = healed.expandedGroupId;
    openAssignId = healed.openAssignId;
    const classHashVerification = verificationForAccount(
      cache.classHashVerification,
      status.activeAccountId,
    );
    snoozedApprovalIds = snoozedApprovalIds.filter((id) =>
      cache.pending.some((approval) => approval.id === id),
    );
    if (transfer.preserveSend(app, activeView, status, cache.pending, snoozedApprovalIds)) return;
    if (
      shouldPreserveMultisigProposalSurface(
        app,
        activeView,
        selectedMultisigId,
        status,
        cache.pending,
        snoozedApprovalIds,
      )
    )
      return;
    const content =
      fullPageOnboarding && status.hasVault
        ? onboardingComplete()
        : !status.hasVault
          ? fullPageOnboarding
            ? onboarding(status)
            : onboardingLaunch()
          : status.locked
            ? locked(status, cache.pending)
            : dashboard(
                activeView,
                status,
                cache.pending,
                cache.preferences,
                cache.balances,
                cache.deployment,
                cache.transactions,
                cache.connectedSites,
                cache.prices,
                cache.chart,
                selectedTokenId,
                cache.allowances,
                selectedNftId,
                cache.changes,
                cache.multisigs.multisigs,
                cache.multisigs.proposals,
                selectedMultisigId,
                cache.multisigClassDeclared,
                drawerGroupFilter,
                expandedGroupId,
                cache.priceStale,
                cache.priceAsOf,
                cache.discoveredNfts,
                openAssignId,
                classHashVerification,
                cache.historyUnavailable,
                snoozedApprovalIds,
                cache.multisigsError,
                cache.multisigSync,
                cache.multisigBalances,
                cache.multisigBalanceId,
                cache.multisigNfts,
                cache.multisigNftId,
                privacy.disclosure(),
                privacy.journey(),
                sendIntent,
              );
    lastActiveView = activeView;
    if (!animate && content === lastContent) {
      return;
    }
    lastContent = content;
    renderScene(content, animate, direction);
  };
  privacy = createPrivacyController({
    app,
    balances: () => cache.balances,
    navigate: (view) => navigate(view),
    openSend: (intent) => {
      sendIntent = intent;
      selectedTokenId = intent.tokenId;
      navigate("send");
    },
    paint,
    preferences: () => cache.preferences,
    status: () => cache.status,
    wallet,
  });
  let renderGeneration = 0;
  const render = async (status: WalletStatus): Promise<void> => {
    const generation = ++renderGeneration;
    const isCurrent = (): boolean => generation === renderGeneration;
    const scopeChanged = updateRenderScope(cache, status);
    if (scopeChanged) {
      privacy.reset();
      sendIntent = null;
    }
    if (scopeChanged === "network" && selectedMultisigId !== null) {
      selectedMultisigId = null;
      activeView = "home";
      viewHistory = [];
    }
    const [pending, nextPreferences] = await Promise.all([
      wallet.loadPendingApprovals(),
      status.hasVault && !status.locked
        ? wallet.loadPreferences().catch(() => null)
        : Promise.resolve(null),
    ]);
    if (!isCurrent()) {
      return;
    }
    cache.pending = pending;
    cache.preferences = nextPreferences;
    if (!status.hasVault || status.locked) {
      privacy.reset();
      // Reset every view-scoped field from one source so stale state cannot leak
      // across a lock; preserve the status/pending/preferences just refreshed.
      Object.assign(cache, emptyRenderCache(), {
        pending: cache.pending,
        preferences: cache.preferences,
        status,
      });
      paint();
      return;
    }
    if (fullPageOnboarding) {
      paint();
      return;
    }
    paint();
    void ledgerSign.poll();
    await hydrateView({
      status,
      activeView,
      selectedMultisigId,
      selectedTokenId,
      cache,
      wallet,
      multisig,
      deployment,
      isCurrent,
      paint,
    });
  };

  const navigate = (view: WalletView): void => {
    if (view !== activeView) {
      viewHistory = pushView(viewHistory, activeView);
    }
    activeView = view;
    drawerOpen = false;
    paint();
    void wallet.loadStatus().then(render);
  };
  const goBack = (): void => {
    const popped = popView(viewHistory);
    viewHistory = popped.history;
    forcedDirection = "back";
    activeView = popped.view;
    drawerOpen = false;
    paint();
    void wallet.loadStatus().then(render);
  };

  const refreshScheduler = createRefreshScheduler({
    refresh: withTransactionAlerts(wallet, async () => render(await wallet.loadStatus())),
    visible: () => document.visibilityState === "visible",
  });
  mutationRuntime.setListener(refreshScheduler.afterAction);

  runtime?.onMessage?.addListener((message) => {
    if (isWalletEventMessage(message)) refreshScheduler.afterAction();
  });
  document.addEventListener("visibilitychange", refreshScheduler.visibilityChanged);
  window.addEventListener("focus", () => {
    refreshScheduler.start();
    refreshScheduler.afterAction();
  });
  window.addEventListener("pagehide", refreshScheduler.stop, { once: true });

  applyTheme();
  refreshScheduler.start();
  void render(await wallet.loadStatus());
};
