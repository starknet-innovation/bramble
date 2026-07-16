/**
 * Side panel wallet app. This is the primary extension UI.
 *
 * Rendering contract: the whole shell re-renders from status, but screens
 * only animate when the scene actually changes, and keyboard focus is
 * restored across re-renders so controls never jump under the user.
 */

import type { WalletStatus } from "../popup/responses";
import { isWalletEventMessage } from "../provider/events";
import { applySkin } from "../ui/skin";
import { colorSchemeForChoice, skinForChoice } from "../ui/theme";
import { bindClusterScreens } from "./cluster-ui";
import { bindAddressBook, bindApprovals } from "./dashboard-bindings";
import { createDeploymentCache } from "./deployment-cache";
import {
  bindCopyButtons,
  buttonBusy,
  captureRepaintFocus,
  errorMessage,
  restoreRepaintFocus,
  showToast,
} from "./dom";
import { bindEndpointSettings } from "./endpoint-ui";
import { locked, onboarding } from "./gate-views";
import { healTransientGroupState } from "./group-state";
import type { HomeTab } from "./home-tabs";
import { bindHomeUi } from "./home-ui";
import { prefersReducedMotion } from "./motion";
import { createMultisigClient } from "./multisig-runtime";
import { bindMultisigs } from "./multisig-ui";
import { type NavDirection, navDirection } from "./nav-direction";
import { popView, pushView, type ViewHistory } from "./nav-history";
import { bindOnboarding } from "./onboarding-ui";
import { emptyRenderCache, type RenderData } from "./render-cache";
import { bindReveal } from "./reveal-ui";
import { createSidepanelRuntime, type RuntimeApi } from "./runtime";
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
import { bindActivity, bindTransfer } from "./transfer-ui";
import { dashboard, isWalletView, type WalletView } from "./views";

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: { readonly runtime?: RuntimeApi };
};
const app = document.querySelector("#app");
const runtime = (globalThis as ExtensionGlobal).chrome?.runtime;
const wallet = createSidepanelRuntime(runtime);
const multisig = createMultisigClient(runtime);
let activeView: WalletView = "home";
let selectedNftId: string | null = null;
let selectedMultisigId: string | null = null;
let lastAccountId: string | null = null;
let lastNetworkId = "SN_MAIN";
let lastScene = "";
let lastContent = "";
let lastSkinName = "";
let lastActiveView: WalletView = "home";
// Back-stack of screens to return to (see ./nav-history). navigate() pushes the
// screen being left; goBack() pops to the true previous one.
let viewHistory: ViewHistory = [];
// Set to "back" by goBack() so a pop animates as a reverse transition even when
// the depth-based navDirection would read it as a lateral swap; consumed and
// cleared by the next paint().
let forcedDirection: NavDirection | null = null;
let selectedTokenId: string | null = null;
let homeTab: HomeTab = "tokens";
let drawerOpen = false;
let drawerGroupFilter: string | null = null;
// Transient group UI selections, held here so they survive full re-renders and
// are self-healed in paint(): which account's quick folder picker is open in the
// drawer, and which panel is open in the manage-accounts Groups accordion (a
// group's bulk editor or the "Create a group" panel; null = all collapsed).
let openAssignId: string | null = null;
let expandedGroupId: string | null = null;

// The View Transitions API is progressively enhanced: typed locally so the
// build does not depend on the lib.dom version shipping the declarations.
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

const bindUnlock = (): void => {
  const form = app?.querySelector<HTMLFormElement>("#unlock-form");
  const result = app?.querySelector<HTMLElement>("#form-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const vaultPassphrase = String(new FormData(form).get("vaultPassphrase") ?? "");
    buttonBusy(submitButton, true);
    void wallet.unlockVault(vaultPassphrase).then(
      async (status) => {
        activeView = "home";
        showToast("Vault unlocked", "success");
        await render(status);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Unlock failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "Unlock failed");
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};

const renderShell = (content: string, animate: boolean): void => {
  if (!app) {
    return;
  }
  const focus = captureRepaintFocus();
  app.innerHTML = `<style>${SIDEPANEL_STYLES}</style><section class="shell${animate ? " shell-animate" : ""}">${content}</section>`;
  restoreRepaintFocus(app, focus);
};

// Swaps the shell markup and re-binds listeners. When the scene changed and the
// View Transitions API is available (and motion is allowed), the swap runs
// inside a direction-aware transition; otherwise it falls back to the instant
// swap with the CSS scene-enter class. Overlapping navigations let the browser
// skip the in-flight transition, keeping it interruptible.
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

const bindAll = (): void => {
  bindNavigation();
  bindBack();
  bindCopyButtons(app);
  bindOnboarding({ app, render, wallet });
  bindUnlock();
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
    wallet,
  });
  bindReveal({ app, wallet });
  bindActivity({ app, render, wallet });
  bindTransfer({ app, render, wallet });
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
    wallet,
  };
  bindAccountLabel(settingsDeps);
  bindAddAccount(settingsDeps);
  bindAppearance(settingsDeps);
  bindBackup(settingsDeps);
  bindContacts(settingsDeps);
  bindGroups(settingsDeps);
  bindAddressBook({ app, render, wallet });
  bindApprovals({ app, render, wallet });
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
      navigate("multisig-detail");
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

// Applies the skin and CSS `color-scheme` for the current theme choice, but
// only when the resolved skin actually changed — cheap enough to call on every
// paint. Swapping skin tokens on the root re-themes the whole panel through CSS
// custom properties without re-rendering any markup. Both themes are pinned
// palettes; `color-scheme` is pinned alongside so native form controls render
// on the same ground and a browser scheme flip can never re-theme the panel.
// A legacy stored "system" choice resolves to the default dark skin.
const applyTheme = (): void => {
  const choice = cache.preferences?.theme ?? "dark";
  const skin = skinForChoice(choice);
  if (skin.name !== lastSkinName) {
    lastSkinName = skin.name;
    document.documentElement.style.setProperty("color-scheme", colorSchemeForChoice(choice));
    applySkin(skin, document.documentElement);
  }
};

// Synchronous paint from the current cache. Navigation calls this first so the
// screen swaps instantly, then hydrate() streams fresh data in and repaints.
const paint = (): void => {
  const { status } = cache;
  lastNetworkId = status.networkId;
  lastAccountId = status.activeAccountId;
  applyTheme();
  const scene = !status.hasVault
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
  const content = !status.hasVault
    ? onboarding(status)
    : status.locked
      ? locked(status)
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
        );
  lastActiveView = activeView;
  if (!animate && content === lastContent) {
    return;
  }
  lastContent = content;
  renderScene(content, animate, direction);
};

// Refreshes cache from the background, painting once from fast local data and
// again after view-scoped network data (balances, prices, activity) resolves
// in parallel — so the screen is never blocked on RPC or price round-trips.
const render = async (status: WalletStatus): Promise<void> => {
  cache.status = status;
  cache.pending = await wallet.loadPendingApprovals();
  cache.preferences =
    status.hasVault && !status.locked ? await wallet.loadPreferences().catch(() => null) : null;
  if (!status.hasVault || status.locked) {
    cache.balances = { error: "wallet locked" };
    cache.deployment = null;
    cache.transactions = [];
    cache.connectedSites = [];
    cache.prices = {};
    cache.changes = {};
    cache.priceAsOf = null;
    cache.priceStale = false;
    cache.chart = [];
    cache.allowances = [];
    cache.discoveredNfts = [];
    paint();
    return;
  }
  paint();
  const jobs: Promise<unknown>[] = [];
  const fill = <T>(load: Promise<T>, assign: (value: T) => void): void => {
    jobs.push(load.then(assign).catch(() => undefined));
  };
  if (activeView === "home" || activeView === "tokens" || activeView === "token-detail") {
    fill(wallet.loadBalances(), (value) => {
      cache.balances = value;
    });
    fill(wallet.loadPrices(), (value) => {
      cache.prices = value.prices;
      cache.changes = value.changes;
      cache.priceAsOf = value.asOf;
      cache.priceStale = value.stale;
    });
  }
  if (activeView === "home") {
    fill(deployment.load(status, activeView), (value) => {
      cache.deployment = value;
    });
  }
  if (activeView === "activity" || activeView === "home") {
    fill(wallet.loadActivity(), (value) => {
      cache.transactions = value;
    });
  }
  if (activeView === "connected-sites") {
    fill(wallet.connectedSites(), (value) => {
      cache.connectedSites = value;
    });
  }
  if (activeView === "allowances") {
    fill(wallet.loadAllowances(), (value) => {
      cache.allowances = value;
    });
  }
  if (activeView === "nfts" || activeView === "nft-detail") {
    fill(wallet.discoverNfts(), (value) => {
      cache.discoveredNfts = value;
    });
  }
  if (
    activeView === "multisigs" ||
    activeView === "multisig-detail" ||
    activeView === "multisig-propose" ||
    activeView === "multisig-deploy"
  ) {
    fill(multisig.loadMultisigs(), (value) => {
      cache.multisigs = value;
    });
  }
  if (activeView === "multisig-deploy") {
    fill(multisig.loadClassStatus(), (value) => {
      cache.multisigClassDeclared = value;
    });
  }
  if (activeView === "token-detail") {
    const selected = cache.preferences?.tokens.find((token) => token.id === selectedTokenId);
    if (selected) {
      fill(wallet.loadTokenChart(selected.address), (value) => {
        cache.chart = value;
      });
    }
  }
  if (jobs.length > 0) {
    await Promise.all(jobs);
    paint();
  }
};

// Instant navigation: swap the visible screen from cache now, hydrate after.
// Any navigation dismisses the account drawer so it never lingers over flows.
// The screen being left is pushed onto the history so Back can return to it.
const navigate = (view: WalletView): void => {
  if (view !== activeView) {
    viewHistory = pushView(viewHistory, activeView);
  }
  activeView = view;
  drawerOpen = false;
  paint();
  void wallet.loadStatus().then(render);
};

// Steps back to the screen the user actually came from (or Home at the root),
// animating as a reverse transition. Same instant-swap-then-hydrate path as
// navigate(); the back control in every flow header (`[data-nav-back]`) calls it.
const goBack = (): void => {
  const popped = popView(viewHistory);
  viewHistory = popped.history;
  forcedDirection = "back";
  activeView = popped.view;
  drawerOpen = false;
  paint();
  void wallet.loadStatus().then(render);
};

let refreshQueued = false;
const queueRefresh = (): void => {
  if (refreshQueued) {
    return;
  }
  refreshQueued = true;
  setTimeout(() => {
    refreshQueued = false;
    void wallet.loadStatus().then(render);
  }, 80);
};

runtime?.onMessage?.addListener((message) => {
  if (isWalletEventMessage(message)) {
    queueRefresh();
  }
});

// Apply the theme before the first paint so the pinned skin and color-scheme
// are in place before any markup renders (no flash of the wrong ground).
applyTheme();
void render(await wallet.loadStatus());
