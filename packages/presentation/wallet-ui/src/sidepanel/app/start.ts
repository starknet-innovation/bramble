/** Primary side-panel UI and its scene-preserving paint loop. */
import type { LedgerConnector } from "@bramble/ledger-protocol/session";
import { withDefaultGroups } from "@bramble/settings/groups";
import type { WalletStatus } from "../../popup/responses/responses";
import { actionableApprovals } from "../journeys/approvals/approval-screen";
import { bindLedgerFirstRun } from "../journeys/ledger/first-run";
import { createLedgerOnboardEntry } from "../journeys/ledger/onboard-entry";
import { createLedgerSignRuntime } from "../journeys/ledger/sign-runtime";
import { createMultisigClient } from "../journeys/multisig/multisig-runtime";
import { shouldPreserveMultisigIntentSurface } from "../journeys/multisig/multisig-surface";
import { bindMultisigs } from "../journeys/multisig/multisig-ui";
import { locked, onboarding } from "../journeys/onboarding/gate-views";
import {
  bindOnboardingCompletion,
  bindOnboardingLaunch,
  onboardingComplete,
  onboardingLaunch,
} from "../journeys/onboarding/onboarding-surface";
import { bindOnboarding } from "../journeys/onboarding/onboarding-ui";
import { bindUnlock } from "../journeys/onboarding/unlock-ui";
import { bindHomeUi } from "../journeys/portfolio/home-ui";
import { createPrivacyController } from "../journeys/privacy/privacy-controller";
import type { SendIntent } from "../journeys/send/send-model";
import * as transfer from "../journeys/send/transfer-bindings";
import { bindEndpointSettings } from "../journeys/settings/endpoint-ui";
import { healTransientGroupState } from "../journeys/settings/group-state";
import { bindReveal } from "../journeys/settings/reveal-ui";
import { bindSettingsSurface } from "../journeys/settings/settings-surface";
import { createSwapClient } from "../journeys/swap/swap-client";
import { presetSwapPair } from "../journeys/swap/swap-ui";
import { createSidepanelRuntime } from "../runtime/runtime";
import type { WalletUiBrowser } from "../runtime/runtime-global";
import { bindDisclosures } from "../shared/disclosures";
import { bindCopyButtons, hiddenOverlayMount, showToast } from "../shared/dom";
import { closeAfterGuardedClear } from "../shared/guarded-copy";
import { isParkedCollectibleView } from "../shared/parts";
import { utcDayKey } from "../shared/timestamp";
import { bindAddressBook, bindApprovals } from "../shell/dashboard-bindings";
import { bindDrawerFolders, createDrawerFolderState } from "../shell/drawer-folders-ui";
import { applyEntryTheme, bindEntryNavigation } from "../shell/entry-ui";
import {
  bindDashboard,
  bindDeploy,
  bindPickers,
  deploymentPollScope,
} from "../shell/shell-bindings";
import type { NavDirection } from "./navigation/nav-direction";
import { popView, pushView, type ViewHistory } from "./navigation/nav-history";
import {
  emptyRenderCache,
  type RenderData,
  updateRenderScope,
  verificationForAccount,
} from "./rendering/render-cache";
import {
  createSceneRenderer,
  createScopeAnnouncer,
  scopeChangeAnnouncement,
} from "./rendering/scene-renderer";
import { sceneDirection, sceneFor } from "./rendering/scene-transition";
import { bindClusterScreens } from "./screens/cluster-ui";
import { dashboard, type WalletView } from "./screens/views";
import { createDeploymentCache } from "./sync/deployment-cache";
import { hydrateView } from "./sync/hydrate";
import { startRefreshLifecycle } from "./sync/lifecycle";
import type { RefreshReason } from "./sync/refresh-scheduler";
import { createMutationRuntime } from "./sync/runtime-refresh";

/** Starts the wallet with injected Ledger and clock (`now` only dates the activity feed); fails closed without its runtime or root. */
export const startWalletUi = async (
  ledgerConnector: LedgerConnector,
  extensionApi?: WalletUiBrowser,
  now: (() => number) | null = null,
): Promise<void> => {
  const app = document.querySelector("#app");
  const fullPageOnboarding = document.body.classList.contains("onboarding-surface");
  const runtime = extensionApi?.runtime;
  const mutationRuntime = createMutationRuntime(runtime);
  const wallet = createSidepanelRuntime(mutationRuntime);
  const multisig = createMultisigClient(mutationRuntime);
  const swapClient = createSwapClient(mutationRuntime);
  let activeView: WalletView = "home";
  const selectedNftId: string | null = null;
  let selectedMultisigId: string | null = null;
  let selectedMultisigIntentId: string | null = null;
  let lastNetworkId = "SN_MAIN";
  let lastScene = "";
  let lastContent = "";
  let lastSkinName = "";
  let lastActiveView: WalletView = "home";
  let viewHistory: ViewHistory = [];
  let forcedDirection: NavDirection | null = null;
  let selectedTokenId: string | null = null;
  let drawerOpen = false;
  const drawerFolders = createDrawerFolderState();
  let expandedGroupId: string | null = null;
  let snoozedApprovalIds: readonly string[] = [];
  let sendIntent: SendIntent | null = null;
  let hasPaintedScope = false;
  const renderScene = createSceneRenderer(app, () => bindAll());
  const deployment = createDeploymentCache(wallet);
  const cache: RenderData = emptyRenderCache();
  let privacy: ReturnType<typeof createPrivacyController>;
  const ledgerSignMount = hiddenOverlayMount("ledger-sign-overlay");
  const ledgerSign = createLedgerSignRuntime({
    connector: ledgerConnector,
    mount: ledgerSignMount,
    onSignatureReported: transfer.markTransferLedgerAuthorized,
    status: () => cache.status,
    wallet,
  });
  const ledgerOnboardMount = hiddenOverlayMount("ledger-onboard-overlay");
  const scopeAnnouncer = createScopeAnnouncer(document);
  const ledgerOnboard = createLedgerOnboardEntry({
    addHd: async (accountContractType) => {
      await wallet.addAccount(lastNetworkId, accountContractType);
      showToast("Account added", "success", app);
    },
    cache,
    connector: ledgerConnector,
    mount: ledgerOnboardMount,
    openImport: () => navigate("import-key"),
    openImportSeed: () => navigate("import-phrase"),
    openMultisig: () => navigate("multisig-add"),
    refresh: async () => render(await wallet.loadStatus()),
    wallet,
  });
  const bindAll = (): void => {
    bindEntryNavigation(app, navigate, goBack);
    bindCopyButtons(app);
    bindOnboardingCompletion(app, extensionApi, () =>
      closeAfterGuardedClear(
        app?.querySelector<HTMLElement>("#onboarding-complete-result") ?? null,
        () => globalThis.close(),
      ),
    );
    bindOnboardingLaunch(app, () => globalThis.close());
    bindOnboarding({ app, now, render, wallet });
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
        if (isParkedCollectibleView(view)) {
          return;
        }
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
      ...(extensionApi?.permissions ? { permissions: extensionApi.permissions } : {}),
      render,
      wallet,
    });
    bindHomeUi({
      app,
      drawerOpen: () => drawerOpen,
      networkId: () => lastNetworkId,
      render,
      selectPortfolio: (id: string | null) => {
        selectedMultisigId = id;
        activeView = id ? "multisig-home" : "home";
        viewHistory = [];
        forcedDirection = "swap";
        paint();
      },
      setDrawerOpen: (open) => {
        drawerOpen = open;
      },
      startAddAccount: ledgerOnboard.startAddAccount,
      wallet,
    });
    bindDrawerFolders({ ...drawerFolders, app, render, wallet });
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
      app,
      existingAccountIds: () => new Set(cache.status.accounts.map((account) => account.id)),
      expandedGroup: () => expandedGroupId,
      networkId: () => lastNetworkId,
      refresh: () => wallet.loadStatus(),
      render,
      setExpandedGroup: (id: string | null) => {
        expandedGroupId = id;
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
    bindClusterScreens({
      app,
      cache,
      leaveSwap: (view) => {
        if (activeView === "swap") navigate(view);
      },
      openWithToken: (view, tokenId) => {
        [sendIntent, selectedTokenId] = [null, tokenId];
        if (view === "swap") presetSwapPair(tokenId, cache.preferences?.tokens ?? []);
        navigate(view);
      },
      openToken: (tokenId) => {
        selectedTokenId = tokenId;
        navigate("token-detail");
      },
      render,
      swap: swapClient,
      wallet,
    });
    privacy.bind();
    bindMultisigs({
      app,
      multisig,
      openDetail: (id, destination = "multisig-home") => {
        selectedMultisigId = id;
        selectedMultisigIntentId = null;
        navigate(destination);
      },
      openIntent: (accountId, intentId) => {
        selectedMultisigId = accountId;
        selectedMultisigIntentId = intentId;
        navigate("multisig-detail");
      },
      openList: () => {
        selectedMultisigId = null;
        navigate("multisigs");
      },
      openFunding: async (intent) => {
        await wallet.setActiveAccount(intent.accountId);
        selectedMultisigId = intent.completeMultisigId ?? selectedMultisigId;
        sendIntent = intent;
        navigate("send");
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
    if (activeView !== "send") {
      sendIntent = null;
    }
    applyTheme();
    const actionable = actionableApprovals(cache.pending, snoozedApprovalIds);
    const scene = sceneFor(fullPageOnboarding, status, actionable[0]?.id, activeView);
    const previousScene = lastScene;
    const animate = scene !== lastScene;
    lastScene = scene;
    const direction = sceneDirection(
      forcedDirection,
      scene,
      previousScene,
      lastActiveView,
      activeView,
    );
    forcedDirection = null;
    const groups = withDefaultGroups(cache.preferences?.groups ?? []);
    const healed = healTransientGroupState(
      { collapsedFolderIds: drawerFolders.collapsedFolders(), expandedGroupId },
      groups,
    );
    expandedGroupId = healed.expandedGroupId;
    const collapsed = healed.collapsedFolderIds ?? [];
    if (collapsed.length !== drawerFolders.collapsedFolders().length) {
      drawerFolders.setCollapsedFolders(collapsed);
    }
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
            ? onboarding(status, ledgerConnector.isAvailable?.() ?? true)
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
                drawerFolders.collapsedFolders(),
                expandedGroupId,
                cache.priceStale,
                cache.priceAsOf,
                [],
                drawerFolders.addFolderOpen(),
                classHashVerification,
                cache.historyUnavailable,
                snoozedApprovalIds,
                cache.multisigsError,
                cache.multisigBalances,
                cache.multisigBalanceId,
                privacy.disclosure(),
                privacy.journey(),
                sendIntent,
                selectedMultisigIntentId,
                now === null ? null : utcDayKey(now()),
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
    deployment: () => cache.deployment,
    balances: () => cache.balances,
    navigate: (view) => navigate(view),
    openSend: (intent) => {
      sendIntent = intent;
      selectedTokenId = intent.tokenId;
      if (activeView === "privacy")
        ({ history: viewHistory, view: activeView } = popView(viewHistory));
      navigate("send");
    },
    noteDeployed: () =>
      cache.status.activeAccountId
        ? deployment.noteDeployed(cache.status.networkId, cache.status.activeAccountId)
        : undefined,
    paint,
    preferences: () => cache.preferences,
    status: () => cache.status,
    wallet,
  });
  let renderGeneration = 0;
  const render = async (status: WalletStatus, refreshReason?: RefreshReason): Promise<void> => {
    const generation = ++renderGeneration;
    const isCurrent = (): boolean => generation === renderGeneration;
    const scopeChanged = updateRenderScope(cache, status);
    if (scopeChanged && hasPaintedScope) {
      scopeAnnouncer.textContent = scopeChangeAnnouncement(scopeChanged);
    }
    hasPaintedScope = true;
    if (scopeChanged) {
      privacy.reset();
      sendIntent = null;
    }
    if (scopeChanged === "network" && selectedMultisigId !== null) {
      selectedMultisigId = null;
      activeView = "home";
      viewHistory = [];
    }
    // Preferences are display settings, not vault material — the background
    // serves them without an unlock — so they are read whenever a vault exists.
    // The lock screen then follows the chosen theme instead of the dark default.
    const [pending, nextPreferences] = await Promise.all([
      wallet.loadPendingApprovals(),
      status.hasVault ? wallet.loadPreferences().catch(() => null) : Promise.resolve(null),
    ]);
    if (!isCurrent()) {
      return;
    }
    cache.pending = pending;
    cache.preferences = nextPreferences;
    if (!status.hasVault || status.locked) {
      privacy.reset();
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
    if (!scopeChanged) paint();
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
      ...(refreshReason ? { refreshReason } : {}),
      isCurrent,
      paint,
    });
  };
  const navigate = (view: WalletView): void => {
    if (isParkedCollectibleView(view)) {
      return;
    }
    if (view !== activeView) {
      viewHistory = pushView(viewHistory, activeView);
    }
    activeView = view;
    if (view !== "multisig-detail") selectedMultisigIntentId = null;
    drawerOpen = false;
    paint();
    void wallet.loadStatus().then(render);
  };
  const goBack = (): void => {
    const popped = popView(viewHistory);
    viewHistory = popped.history;
    forcedDirection = "back";
    activeView = isParkedCollectibleView(popped.view) ? "home" : popped.view;
    if (activeView !== "multisig-detail") selectedMultisigIntentId = null;
    drawerOpen = false;
    paint();
    void wallet.loadStatus().then(render);
  };
  applyTheme();
  startRefreshLifecycle({ mutationRuntime, render, runtime, wallet });
  void render(await wallet.loadStatus());
};
