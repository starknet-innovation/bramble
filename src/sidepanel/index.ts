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
import { buttonBusy, errorMessage, focusMemo, restoreFocus, scopedStatus, showToast } from "./dom";
import { locked, onboarding } from "./gate-views";
import { bindOnboarding } from "./onboarding-ui";
import { bindReveal } from "./reveal-ui";
import { createSidepanelRuntime, emptyStatus, type RuntimeApi } from "./runtime";
import {
  bindAccountLabel,
  bindAddAccount,
  bindAppearance,
  bindBackup,
  bindContacts,
} from "./settings-ui";
import { SIDEPANEL_STYLES } from "./styles";
import { bindActivity, bindTransfer } from "./transfer-ui";
import { dashboard, isWalletView, type WalletView } from "./views";

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: { readonly runtime?: RuntimeApi };
};
const app = document.querySelector("#app");
const runtime = (globalThis as ExtensionGlobal).chrome?.runtime;
const wallet = createSidepanelRuntime(runtime);
let activeView: WalletView = "home";
let selectedNftId: string | null = null;
let lastAccountId: string | null = null;
let lastNetworkId = "SN_MAIN";
let lastScene = "";
let lastTheme = "";
let selectedTokenId: string | null = null;

const bindNavigation = (): void => {
  app?.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (!isWalletView(view)) {
        return;
      }
      navigate(view);
    });
  });
};

const bindCopy = (): void => {
  app?.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.copy;
      if (!value) {
        return;
      }
      buttonBusy(button, true);
      void navigator.clipboard.writeText(value).then(
        () => {
          scopedStatus(button, "Copied");
          showToast("Copied", "success");
          buttonBusy(button, false);
        },
        () => {
          scopedStatus(button, "Copy failed");
          showToast("Copy failed", "error");
          buttonBusy(button, false);
        },
      );
    });
  });
};

const bindDashboard = (): void => {
  const lockButton = app?.querySelector<HTMLButtonElement>("#lock-button");
  const refreshButton = app?.querySelector<HTMLButtonElement>("#refresh-button");
  const result = app?.querySelector<HTMLElement>("#panel-result");

  lockButton?.addEventListener("click", () => {
    buttonBusy(lockButton, true);
    void wallet.lockVault().then(
      (status) => {
        showToast("Vault locked", "success");
        void render(status);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Lock failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "Lock failed");
        }
        buttonBusy(lockButton, false);
      },
    );
  });

  refreshButton?.addEventListener("click", () => {
    buttonBusy(refreshButton, true);
    void wallet.loadStatus().then(render, () => buttonBusy(refreshButton, false));
  });
};

const bindDeploy = (): void => {
  const button = app?.querySelector<HTMLButtonElement>("#deploy-button");
  button?.addEventListener("click", () => {
    buttonBusy(button, true);
    scopedStatus(button, "Submitting deployment...");
    void wallet.deployAccount().then(
      (transactionHash) => {
        showToast("Deployment submitted", "success");
        scopedStatus(button, `Deployment submitted: ${transactionHash}`);
        buttonBusy(button, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Deployment failed"), "error");
        scopedStatus(button, errorMessage(error, "Deployment failed"));
        buttonBusy(button, false);
      },
    );
  });
};

const bindRpcOverride = (): void => {
  const form = app?.querySelector<HTMLFormElement>("#rpc-form");
  const result = app?.querySelector<HTMLElement>("#rpc-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const rpcUrl = String(new FormData(form).get("rpcUrl") ?? "").trim();
    buttonBusy(submitButton, true);
    void wallet.setRpcOverride(lastNetworkId, rpcUrl).then(
      async () => {
        showToast(rpcUrl ? "RPC endpoint saved" : "RPC endpoint reset", "success");
        await render(await wallet.loadStatus());
      },
      (error: unknown) => {
        showToast(errorMessage(error, "RPC endpoint update failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "RPC endpoint update failed");
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};

const bindPickers = (): void => {
  const result = app?.querySelector<HTMLElement>("#picker-result");

  app?.querySelectorAll<HTMLButtonElement>("[data-network-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const networkId = button.dataset.networkId;
      if (!networkId || button.getAttribute("aria-pressed") === "true") {
        return;
      }
      buttonBusy(button, true);
      if (result) {
        result.textContent = "Switching network...";
      }
      void wallet.setActiveNetwork(networkId).then(
        async (status) => {
          activeView = "settings";
          showToast("Network switched", "success");
          await render(status);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Network switch failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Network switch failed");
          }
          buttonBusy(button, false);
        },
      );
    });
  });

  app?.querySelectorAll<HTMLButtonElement>("[data-account-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const accountId = button.dataset.accountId;
      if (!accountId || button.getAttribute("aria-pressed") === "true") {
        return;
      }
      buttonBusy(button, true);
      if (result) {
        result.textContent = "Switching account...";
      }
      void wallet.setActiveAccount(accountId).then(
        async () => {
          activeView = "settings";
          showToast("Account switched", "success");
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Account switch failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Account switch failed");
          }
          buttonBusy(button, false);
        },
      );
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
  balances: Awaited<ReturnType<typeof wallet.loadBalances>>;
  chart: readonly number[];
  connectedSites: Awaited<ReturnType<typeof wallet.connectedSites>>;
  deployment: boolean | null;
  pending: Awaited<ReturnType<typeof wallet.loadPendingApprovals>>;
  preferences: WalletPreferences | null;
  prices: Readonly<Record<string, number>>;
  status: WalletStatus;
  transactions: Awaited<ReturnType<typeof wallet.loadActivity>>;
};

const cache: RenderData = {
  allowances: [],
  balances: { error: "wallet locked" },
  chart: [],
  connectedSites: [],
  deployment: null,
  pending: [],
  preferences: null,
  prices: {},
  status: emptyStatus(),
  transactions: [],
};

const bindAll = (): void => {
  bindNavigation();
  bindCopy();
  bindOnboarding({ app, render, wallet });
  bindUnlock();
  bindDashboard();
  bindDeploy();
  bindPickers();
  bindRpcOverride();
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
  renderShell(
    !status.hasVault
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
          ),
    animate,
  );
  bindAll();
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
      cache.prices = value;
    });
  }
  if (activeView === "home") {
    fill(loadDeployment(status), (value) => {
      cache.deployment = value;
    });
  }
  if (activeView === "activity") {
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
const navigate = (view: WalletView): void => {
  activeView = view;
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
