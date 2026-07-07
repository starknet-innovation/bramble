/**
 * Side panel wallet app. This is the primary extension UI.
 *
 * Rendering contract: the whole shell re-renders from status, but screens
 * only animate when the scene actually changes, and keyboard focus is
 * restored across re-renders so controls never jump under the user.
 */

import { readApprovalAction } from "../popup/actions";
import type { WalletStatus } from "../popup/responses";
import { isWalletEventMessage } from "../provider/events";
import type { WalletPreferences } from "../storage/preferences-store";
import { darkSkin } from "../ui/dark-skin";
import { defaultSkin } from "../ui/default-skin";
import { applySkin } from "../ui/skin";
import { buttonBusy, errorMessage, focusMemo, restoreFocus, scopedStatus, showToast } from "./dom";
import { locked, onboarding } from "./gate-views";
import { createSidepanelRuntime, type RuntimeApi } from "./runtime";
import { bindAccountLabel, bindAppearance, bindBackup, bindContacts } from "./settings-ui";
import { SIDEPANEL_STYLES } from "./styles";
import { bindTokens } from "./tokens-ui";
import { bindActivity, bindTransfer } from "./transfer-ui";
import { dashboard, isWalletView, type WalletView } from "./views";

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: { readonly runtime?: RuntimeApi };
};

const app = document.querySelector("#app");
const runtime = (globalThis as ExtensionGlobal).chrome?.runtime;
const wallet = createSidepanelRuntime(runtime);
let activeView: WalletView = "home";
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
      activeView = view;
      void wallet.loadStatus().then(render);
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

const bindOnboarding = (): void => {
  const form = app?.querySelector<HTMLFormElement>("#create-form");
  const generateButton = app?.querySelector<HTMLButtonElement>("#generate-button");
  const result = app?.querySelector<HTMLElement>("#form-result");
  const mnemonicInput = form?.querySelector<HTMLTextAreaElement>('textarea[name="mnemonic"]');
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  generateButton?.addEventListener("click", () => {
    buttonBusy(generateButton, true);
    void wallet.generateMnemonic().then(
      (mnemonic) => {
        if (mnemonicInput) {
          mnemonicInput.value = mnemonic;
        }
        if (result) {
          result.textContent = "Recovery phrase generated";
        }
        showToast("Recovery phrase generated", "success");
        buttonBusy(generateButton, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Recovery phrase failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "Recovery phrase failed");
        }
        buttonBusy(generateButton, false);
      },
    );
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    buttonBusy(submitButton, true);
    void wallet
      .createAccount(
        String(data.get("mnemonic") ?? "").trim(),
        String(data.get("networkId") ?? "SN_MAIN"),
        String(data.get("vaultPassphrase") ?? ""),
      )
      .then(
        async () => {
          activeView = "home";
          showToast("Wallet created", "success");
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Account import failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Account import failed");
          }
          buttonBusy(submitButton, false);
        },
      );
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

const bindAddressBook = (): void => {
  const form = app?.querySelector<HTMLFormElement>("#address-form");
  const result = app?.querySelector<HTMLElement>("#address-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    buttonBusy(submitButton, true);
    void wallet
      .saveAddress(
        String(data.get("label") ?? ""),
        String(data.get("address") ?? "").trim(),
        String(data.get("networkId") ?? ""),
      )
      .then(
        async () => {
          showToast("Address saved", "success");
          if (result) {
            result.textContent = "Address saved";
          }
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Address save failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Address save failed");
          }
          buttonBusy(submitButton, false);
        },
      );
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

const bindApprovals = (): void => {
  const result = app?.querySelector<HTMLElement>("#approval-result");
  app?.querySelectorAll<HTMLButtonElement>("[data-approval-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.approvalId;
      const action = readApprovalAction(button.dataset.approvalAction);
      if (!id || !action) {
        return;
      }
      buttonBusy(button, true);
      void wallet.decideApproval(id, action === "approve").then(
        async () => {
          showToast(action === "approve" ? "Connection approved" : "Connection denied", "success");
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Approval failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Approval failed");
          }
          buttonBusy(button, false);
        },
      );
    });
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

const render = async (status: WalletStatus): Promise<void> => {
  lastNetworkId = status.networkId;
  lastAccountId = status.activeAccountId;
  const pending = await wallet.loadPendingApprovals();
  const preferences: WalletPreferences | null =
    status.hasVault && !status.locked ? await wallet.loadPreferences().catch(() => null) : null;
  const theme = preferences?.theme ?? "light";
  if (theme !== lastTheme) {
    lastTheme = theme;
    applySkin(theme === "dark" ? darkSkin : defaultSkin, document.documentElement);
  }
  const balances =
    status.hasVault && !status.locked ? await wallet.loadBalances() : { error: "wallet locked" };
  const deployment = await loadDeployment(status).catch(() => null);
  const transactions =
    activeView === "activity" && status.hasVault && !status.locked
      ? await wallet.loadActivity().catch(() => [])
      : [];
  const prices: Readonly<Record<string, number>> =
    status.hasVault && !status.locked ? await wallet.loadPrices().catch(() => ({})) : {};
  const selectedToken = preferences?.tokens.find((token) => token.id === selectedTokenId) ?? null;
  const chart: readonly number[] =
    activeView === "token-detail" && selectedToken
      ? await wallet.loadTokenChart(selectedToken.address).catch(() => [])
      : [];
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
            pending,
            preferences,
            balances,
            deployment,
            transactions,
            prices,
            chart,
            selectedTokenId,
          ),
    animate,
  );
  bindNavigation();
  bindCopy();
  bindOnboarding();
  bindUnlock();
  bindDashboard();
  bindDeploy();
  bindPickers();
  bindRpcOverride();
  bindActivity({ app, render, wallet });
  bindTransfer({ app, render, wallet });
  const settingsDeps = {
    activeAccountId: () => lastAccountId,
    app,
    refresh: () => wallet.loadStatus(),
    render,
    wallet,
  };
  bindAccountLabel(settingsDeps);
  bindAppearance(settingsDeps);
  bindBackup(settingsDeps);
  bindContacts(settingsDeps);
  bindAddressBook();
  bindApprovals();
  bindTokens({
    app,
    openToken: (tokenId) => {
      selectedTokenId = tokenId;
      activeView = "token-detail";
      void wallet.loadStatus().then(render);
    },
    refresh: () => wallet.loadStatus(),
    render,
    wallet,
  });
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

applySkin(defaultSkin, document.documentElement);
void render(await wallet.loadStatus());
