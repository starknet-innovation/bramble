/**
 * Primary side-panel UI. The shell re-renders from status, but screens animate
 * only on scene changes and restore keyboard focus across repaints.
 */
import type { WalletStatus } from "../popup/responses";
import { isWalletEventMessage } from "../provider/events";
import { applySkin } from "../ui/skin";
import { colorSchemeForChoice, skinForChoice } from "../ui/theme";
import { bindClusterScreens } from "./cluster-ui";
import { bindAddressBook, bindApprovals } from "./dashboard-bindings";
import { createDeploymentCache } from "./deployment-cache";
import { bindDisclosures } from "./disclosures";
import { bindCopyButtons, captureRepaintFocus, restoreRepaintFocus, showToast } from "./dom";
import { bindEndpointSettings } from "./endpoint-ui";
import { locked, onboarding } from "./gate-views";
import { healTransientGroupState } from "./group-state";
import type { HomeTab } from "./home-tabs";
import { bindHomeUi } from "./home-ui";
import { hydrateView } from "./hydrate";
import { bindImportKey } from "./import-key-ui";
import { bindLedgerFirstRun } from "./ledger/first-run";
import { createLedgerOnboardEntry } from "./ledger/onboard-entry";
import { ledgerConnector } from "./ledger/sign-connector";
import { createLedgerSignRuntime } from "./ledger/sign-runtime";
import { animateLiveValueChanges, captureLiveValues } from "./live-updates";
import { prefersReducedMotion } from "./motion";
import { createMultisigClient } from "./multisig-runtime";
import { bindMultisigs } from "./multisig-ui";
import { type NavDirection, navDirection } from "./nav-direction";
import { popView, pushView, type ViewHistory } from "./nav-history";
import {
  bindOnboardingCompletion,
  type OnboardingCompletionBrowser,
  onboardingComplete,
  onboardingLaunch,
} from "./onboarding-surface";
import { bindOnboarding, bindUnlock } from "./onboarding-ui";
import { createRefreshScheduler } from "./refresh-scheduler";
import {
  emptyRenderCache,
  type RenderData,
  updateRenderScope,
  verificationForAccount,
} from "./render-cache";
import { bindReveal } from "./reveal-ui";
import { createSidepanelRuntime, type RuntimeApi } from "./runtime";
import { createMutationRuntime } from "./runtime-refresh";
import {
  bindAccountLabel,
  bindAddAccount,
  bindAppearance,
  bindBackup,
  bindContacts,
  bindGroups,
} from "./settings-ui";
import { bindDashboard, bindDeploy, bindPickers } from "./shell-bindings";
import { SIDEPANEL_STYLES } from "./styles";
import { createSwapClient } from "./swap-client";
import { bindSwap } from "./swap-ui";
import * as transfer from "./transfer-bindings";
import { dashboard, isWalletView, type WalletView } from "./views";

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: OnboardingCompletionBrowser & { readonly runtime?: RuntimeApi };
};
const app = document.querySelector("#app");
const fullPageOnboarding = document.body.classList.contains("onboarding-surface");
const extensionApi = (globalThis as ExtensionGlobal).chrome;
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

type ViewTransition = { readonly finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

const bindNavigation = (): void => {
  app?.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset["view"];
      if (!isWalletView(view)) {
        return;
      }
      navigate(view);
    });
  });
};

const bindBack = (): void => {
  app?.querySelectorAll<HTMLButtonElement>("[data-nav-back]").forEach((button) => {
    button.addEventListener("click", goBack);
  });
};

const renderShell = (content: string, animate: boolean): void => {
  if (!app) {
    return;
  }
  const focus = captureRepaintFocus();
  const liveValues = captureLiveValues(app);
  app.innerHTML = `<style>${SIDEPANEL_STYLES}</style><section class="shell${animate ? " shell-animate" : ""}">${content}</section>`;
  restoreRepaintFocus(app, focus);
  animateLiveValueChanges(app, liveValues);
};

const renderScene = (content: string, animate: boolean, direction: NavDirection): void => {
  const doc = document as ViewTransitionDocument;
  if (!animate || prefersReducedMotion() || typeof doc.startViewTransition !== "function") {
    renderShell(content, animate);
    bindAll();
    return;
  }
  document.documentElement.dataset["navDirection"] = direction;
  const transition = doc.startViewTransition(() => {
    renderShell(content, false);
    bindAll();
  });
  void transition.finished.finally(() => {
    delete document.documentElement.dataset["navDirection"];
  });
};

const deployment = createDeploymentCache(wallet);
const cache: RenderData = emptyRenderCache();

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
  bindNavigation();
  bindBack();
  bindCopyButtons(app);
  bindOnboardingCompletion(app, extensionApi, () => globalThis.close());
  bindOnboarding({ app, render, wallet });
  bindLedgerFirstRun({ app, startLedgerSetup: ledgerOnboard.startLedgerSetup });
  bindUnlock({ app, render, wallet }, () => {
    activeView = "home";
  });
  const shellDeps = {
    app,
    render,
    setActiveView: (view: WalletView) => {
      activeView = view;
    },
    wallet,
  };
  bindDashboard(shellDeps);
  bindDeploy(shellDeps);
  bindPickers(shellDeps);
  bindEndpointSettings({ app, networkId: () => lastNetworkId, render, wallet });
  bindHomeUi({
    app,
    drawerGroupFilter: () => drawerGroupFilter,
    drawerOpen: () => drawerOpen,
    homeTab: () => homeTab,
    networkId: () => lastNetworkId,
    render,
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
  transfer.bindTransfer({ app, back: goBack, navigate: (view) => navigate(view), render, wallet });
  const settingsDeps = {
    activeAccountId: () => lastAccountId,
    app,
    expandedGroup: () => expandedGroupId,
    networkId: () => lastNetworkId,
    openAssign: () => openAssignId,
    refresh: () => wallet.loadStatus(),
    render,
    setExpandedGroup: (id: string | null) => {
      // Opens one panel in the manage-accounts Groups accordion — a group's bulk
      // editor or the "Create a group" panel. Set right after creating a group so
      // the new group's editor opens (collapsing the create panel) for immediate
      // rename/re-icon/bucketing.
      expandedGroupId = id;
    },
    setOpenAssign: (id: string | null) => {
      openAssignId = id;
    },
    startAddAccount: ledgerOnboard.startAddAccount,
    wallet,
  };
  bindAccountLabel(settingsDeps);
  bindAddAccount(settingsDeps);
  bindImportKey(settingsDeps);
  bindAppearance(settingsDeps);
  bindBackup(settingsDeps);
  bindContacts(settingsDeps);
  bindGroups(settingsDeps);
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
    // The success moment returns home on its own; guard so a user who already
    // navigated away is never yanked back.
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
  const choice = cache.preferences?.theme ?? "dark";
  const skin = skinForChoice(choice);
  if (skin.name !== lastSkinName) {
    lastSkinName = skin.name;
    document.documentElement.style.setProperty("color-scheme", colorSchemeForChoice(choice));
    applySkin(skin, document.documentElement);
  }
};

const paint = (): void => {
  const { status } = cache;
  lastNetworkId = status.networkId;
  lastAccountId = status.activeAccountId;
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
  // Self-heal stale group selections (filter/expanded/open panel) so a deleted
  // group or a departed account can never silently re-apply itself on repaint.
  const healed = healTransientGroupState(
    { drawerGroupFilter, expandedGroupId, openAssignId },
    cache.preferences?.groups ?? [],
    status.accounts.map((stored) => stored.id),
  );
  drawerGroupFilter = healed.drawerGroupFilter;
  expandedGroupId = healed.expandedGroupId;
  openAssignId = healed.openAssignId;
  // Key the class-hash verification by the account it was computed for, so a
  // stale badge from the previous account never shows against a freshly switched
  // one — it falls back to its honest "verifying…" state until the new account's
  // verification lands (mirrors how deployment-cache keys by accountId).
  const classHashVerification = verificationForAccount(
    cache.classHashVerification,
    status.activeAccountId,
  );
  snoozedApprovalIds = snoozedApprovalIds.filter((id) =>
    cache.pending.some((approval) => approval.id === id),
  );
  if (transfer.preserveSend(app, activeView, status, cache.pending, snoozedApprovalIds)) return;
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
            );
  lastActiveView = activeView;
  if (!animate && content === lastContent) {
    return;
  }
  lastContent = content;
  renderScene(content, animate, direction);
};
let renderGeneration = 0;
const render = async (status: WalletStatus): Promise<void> => {
  const generation = ++renderGeneration;
  const isCurrent = (): boolean => generation === renderGeneration;
  updateRenderScope(cache, status);
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

// Swap cached navigation state immediately, then hydrate it.
const navigate = (view: WalletView): void => {
  if (view !== activeView) {
    viewHistory = pushView(viewHistory, activeView);
  }
  activeView = view;
  drawerOpen = false;
  paint();
  void wallet.loadStatus().then(render);
};
// Return to the prior view with reverse-transition direction.
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
  refresh: async () => render(await wallet.loadStatus()),
  visible: () => document.visibilityState === "visible",
});
mutationRuntime.setListener(refreshScheduler.afterAction);

runtime?.onMessage?.addListener((message) => {
  if (isWalletEventMessage(message)) {
    refreshScheduler.afterAction();
  }
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
