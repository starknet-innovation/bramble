/** Primary side-panel UI and its scene-preserving paint loop. */
import type { LedgerConnector } from "@mc-wallet/ledger-protocol/session";
import type { WalletStatus } from "../../popup/responses/responses";
import { bindLedgerFirstRun } from "../journeys/ledger/first-run";
import { createLedgerOnboardEntry } from "../journeys/ledger/onboard-entry";
import { createLedgerSignRuntime } from "../journeys/ledger/sign-runtime";
import { createMultisigClient } from "../journeys/multisig/multisig-runtime";
import { shouldPreserveMultisigIntentSurface } from "../journeys/multisig/multisig-surface";
import { bindMultisigs } from "../journeys/multisig/multisig-ui";
import { locked, onboarding } from "../journeys/onboarding/gate-views";
import {
  bindOnboardingCompletion,
  onboardingComplete,
  onboardingLaunch,
} from "../journeys/onboarding/onboarding-surface";
import { bindOnboarding, bindUnlock } from "../journeys/onboarding/onboarding-ui";
import type { HomeTab } from "../journeys/portfolio/home-tabs";
import { bindHomeUi } from "../journeys/portfolio/home-ui";
import { createPrivacyController } from "../journeys/privacy/privacy-controller";
import type { SendIntent } from "../journeys/send/send-model";
import * as transfer from "../journeys/send/transfer-bindings";
import { bindEndpointSettings } from "../journeys/settings/endpoint-ui";
import { healTransientGroupState } from "../journeys/settings/group-state";
import { bindReveal } from "../journeys/settings/reveal-ui";
import { bindSettingsSurface } from "../journeys/settings/settings-surface";
import { createSwapClient } from "../journeys/swap/swap-client";
import { bindSwap } from "../journeys/swap/swap-ui";
import { createSidepanelRuntime } from "../runtime/runtime";
import type { WalletUiBrowser } from "../runtime/runtime-global";
import { bindDisclosures } from "../shared/disclosures";
import { bindCopyButtons, showToast } from "../shared/dom";
import { bindAddressBook, bindApprovals } from "../shell/dashboard-bindings";
import { applyEntryTheme, bindEntryNavigation } from "../shell/entry-ui";
import {
  bindDashboard,
  bindDeploy,
  bindPickers,
  deploymentPollScope,
} from "../shell/shell-bindings";
import { type NavDirection, navDirection } from "./navigation/nav-direction";
import { popView, pushView, type ViewHistory } from "./navigation/nav-history";
import {
  emptyRenderCache,
  type RenderData,
  updateRenderScope,
  verificationForAccount,
} from "./rendering/render-cache";
import { createSceneRenderer } from "./rendering/scene-renderer";
import { bindClusterScreens } from "./screens/cluster-ui";
import { dashboard, type WalletView } from "./screens/views";
import { createDeploymentCache } from "./sync/deployment-cache";
import { hydrateView } from "./sync/hydrate";
import { startRefreshLifecycle } from "./sync/lifecycle";
import { createMutationRuntime } from "./sync/runtime-refresh";

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
    addHd: async (accountContractType) => {
      await wallet.addAccount(lastNetworkId, accountContractType);
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
      shouldPreserveMultisigIntentSurface(
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
                cache.multisigs.intents,
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

  applyTheme();
  startRefreshLifecycle({ mutationRuntime, render, runtime, wallet });
  void render(await wallet.loadStatus());
};
