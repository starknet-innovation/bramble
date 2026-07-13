/**
 * Side panel wallet app. This is the primary extension UI.
 *
 * Rendering contract: the whole shell re-renders from status, but screens
 * only animate when the scene actually changes, and keyboard focus is
 * restored across re-renders so controls never jump under the user.
 */

import type { WalletStatus } from "../popup/responses";
import { isWalletEventMessage } from "../provider/events";
import type { WalletPreferences } from "../storage/preferences-store";
import { darkSkin } from "../ui/dark-skin";
import { defaultSkin } from "../ui/default-skin";
import { applySkin } from "../ui/skin";
import { bindClusterScreens } from "./cluster-ui";
import { bindAddressBook, bindApprovals } from "./dashboard-bindings";
import {
  bindCopyButtons,
  buttonBusy,
  errorMessage,
  focusMemo,
  restoreFocus,
  showToast,
} from "./dom";
import { bindEndpointSettings } from "./endpoint-ui";
import { locked, onboarding } from "./gate-views";
import type { HomeTab } from "./home-tabs";
import { bindHomeUi } from "./home-ui";
import { prefersReducedMotion } from "./motion";
import { createMultisigClient } from "./multisig-runtime";
import { bindMultisigs } from "./multisig-ui";
import { bindOnboarding } from "./onboarding-ui";
import { DOCK_VIEWS } from "./parts";
import { bindReveal } from "./reveal-ui";
import { createSidepanelRuntime, emptyStatus, type RuntimeApi } from "./runtime";
import {
  bindAccountLabel,
  bindAddAccount,
  bindAppearance,
  bindBackup,
  bindContacts,
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
let lastTheme = "";
let lastActiveView: WalletView = "home";
let selectedTokenId: string | null = null;
let homeTab: HomeTab = "tokens";
let drawerOpen = false;

// Direction the shell is moving through the screen hierarchy, used to pick a
// spatially consistent view transition (see ./styles-transitions.ts).
type NavDirection = "forward" | "back" | "swap";

const DETAIL_VIEWS: readonly WalletView[] = [
  "token-detail",
  "nft-detail",
  "multisig-detail",
  "multisig-propose",
  "multisig-deploy",
];

// Dock screens sit at the root (0); flows push one level deeper (1); detail
// screens deeper still (2). Direction follows the change in depth.
const viewDepth = (view: WalletView): number =>
  DOCK_VIEWS.includes(view) ? 0 : DETAIL_VIEWS.includes(view) ? 2 : 1;

const navDirection = (from: WalletView, to: WalletView): NavDirection => {
  const delta = viewDepth(to) - viewDepth(from);
  return delta > 0 ? "forward" : delta < 0 ? "back" : "swap";
};

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
  const focused = focusMemo();
  app.innerHTML = `<style>${SIDEPANEL_STYLES}</style><section class="shell${animate ? " shell-animate" : ""}">${content}</section>`;
  restoreFocus(app, focused);
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

const deployedAccounts = new Set<string>();

const loadDeployment = async (status: WalletStatus): Promise<boolean | null> => {
  if (activeView !== "home" || !status.hasVault || status.locked) {
    return null;
  }
  const known = `${status.networkId}:${status.activeAccountId ?? ""}`;
  if (deployedAccounts.has(known)) {
    return true;
  }
  const result = await wallet.loadDeploymentStatus();
  if (result?.deployed) {
    deployedAccounts.add(`${status.networkId}:${result.accountId}`);
    deployedAccounts.add(known);
  }
  return result ? result.deployed : null;
};

type RenderData = {
  allowances: Awaited<ReturnType<typeof wallet.loadAllowances>>;
  multisigs: Awaited<ReturnType<typeof multisig.loadMultisigs>>;
  multisigClassDeclared: boolean | "error" | null;
  balances: Awaited<ReturnType<typeof wallet.loadBalances>>;
  chart: readonly number[];
  connectedSites: Awaited<ReturnType<typeof wallet.connectedSites>>;
  deployment: boolean | null;
  pending: Awaited<ReturnType<typeof wallet.loadPendingApprovals>>;
  preferences: WalletPreferences | null;
  changes: Readonly<Record<string, number>>;
  prices: Readonly<Record<string, number>>;
  status: WalletStatus;
  transactions: Awaited<ReturnType<typeof wallet.loadActivity>>;
};

const cache: RenderData = {
  allowances: [],
  multisigs: { multisigs: [], proposals: [] },
  multisigClassDeclared: null,
  balances: { error: "wallet locked" },
  chart: [],
  connectedSites: [],
  deployment: null,
  pending: [],
  changes: {},
  preferences: null,
  prices: {},
  status: emptyStatus(),
  transactions: [],
};

const bindAll = (): void => {
  bindNavigation();
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
    drawerOpen: () => drawerOpen,
    homeTab: () => homeTab,
    networkId: () => lastNetworkId,
    render,
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
    networkId: () => lastNetworkId,
    refresh: () => wallet.loadStatus(),
    render,
    wallet,
  };
  bindAccountLabel(settingsDeps);
  bindAddAccount(settingsDeps);
  bindAppearance(settingsDeps);
  bindBackup(settingsDeps);
  bindContacts(settingsDeps);
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

// Synchronous paint from the current cache. Navigation calls this first so the
// screen swaps instantly, then hydrate() streams fresh data in and repaints.
const paint = (): void => {
  const { status } = cache;
  lastNetworkId = status.networkId;
  lastAccountId = status.activeAccountId;
  const theme = cache.preferences?.theme ?? "dark";
  if (theme !== lastTheme) {
    lastTheme = theme;
    applySkin(theme === "light" ? defaultSkin : darkSkin, document.documentElement);
  }
  const scene = !status.hasVault
    ? "onboarding"
    : status.locked
      ? "locked"
      : `dashboard:${activeView}`;
  const animate = scene !== lastScene;
  lastScene = scene;
  const direction = navDirection(lastActiveView, activeView);
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
    cache.chart = [];
    cache.allowances = [];
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
    });
  }
  if (activeView === "home") {
    fill(loadDeployment(status), (value) => {
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
const navigate = (view: WalletView): void => {
  activeView = view;
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

applySkin(darkSkin, document.documentElement);
void render(await wallet.loadStatus());
