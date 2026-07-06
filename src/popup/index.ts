/**
 * Popup entrypoint. UI reads public status through the background message boundary.
 */

import { escapeHtml } from "../shared/html";
import { defaultSkin } from "../ui/default-skin";
import { applySkin } from "../ui/skin";
import { readApprovalAction } from "./actions";
import {
  isApprovalDecisionResponse,
  isCreateAccountResponse,
  isErrorResponse,
  isPendingApprovalsResponse,
  isWalletStatus,
  type PendingApproval,
  type WalletStatus,
} from "./responses";

type RuntimeApi = {
  readonly sendMessage: (message: unknown) => Promise<unknown>;
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: {
    readonly runtime?: RuntimeApi;
  };
};

const app = document.querySelector("#app");
const runtime = (globalThis as ExtensionGlobal).chrome?.runtime;

const loadStatus = async (): Promise<WalletStatus> => {
  const response = await runtime?.sendMessage({ type: "wallet.status" });
  if (isWalletStatus(response)) {
    return response;
  }
  return {
    accountCount: 0,
    activeAccountId: null,
    hasVault: false,
    locked: true,
    network: "Unavailable",
    ready: false,
  };
};

const loadPendingApprovals = async (): Promise<readonly PendingApproval[]> => {
  const response = await runtime?.sendMessage({ type: "wallet.pendingApprovals" });
  return isPendingApprovalsResponse(response) ? response.pending : [];
};

const createAccount = async (mnemonic: string, vaultPassphrase: string): Promise<string> => {
  const response = await runtime?.sendMessage({
    mnemonic,
    type: "wallet.createAccount",
    vaultPassphrase,
  });

  if (isCreateAccountResponse(response)) {
    return response.account.address;
  }

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  throw new Error("wallet unavailable");
};

const decideApproval = async (id: string, approved: boolean): Promise<void> => {
  const response = await runtime?.sendMessage({
    id,
    type: approved ? "wallet.approveOrigin" : "wallet.denyOrigin",
  });

  if (isApprovalDecisionResponse(response)) {
    return;
  }

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  throw new Error("wallet unavailable");
};

const unlockVault = async (vaultPassphrase: string): Promise<WalletStatus> => {
  const response = await runtime?.sendMessage({
    type: "wallet.unlock",
    vaultPassphrase,
  });

  if (isWalletStatus(response)) {
    return response;
  }

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  throw new Error("wallet unavailable");
};

const lockVault = async (): Promise<WalletStatus> => {
  const response = await runtime?.sendMessage({ type: "wallet.lock" });
  if (isWalletStatus(response)) {
    return response;
  }

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  throw new Error("wallet unavailable");
};

const bindApprovalButtons = (): void => {
  const result = app?.querySelector<HTMLElement>("#approval-result");

  app?.querySelectorAll<HTMLButtonElement>("[data-approval-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.approvalId;
      const action = readApprovalAction(button.dataset.approvalAction);
      if (!id || !action) {
        return;
      }

      void decideApproval(id, action === "approve").then(
        async () => render(await loadStatus()),
        (error: unknown) => {
          if (result) {
            result.textContent = error instanceof Error ? error.message : "Approval failed";
          }
        },
      );
    });
  });
};

const bindLockButton = (): void => {
  const button = app?.querySelector<HTMLButtonElement>("#lock-button");
  const result = app?.querySelector<HTMLElement>("#form-result");

  button?.addEventListener("click", () => {
    void lockVault().then(render, (error: unknown) => {
      if (result) {
        result.textContent = error instanceof Error ? error.message : "Lock failed";
      }
    });
  });
};

const bindImportForm = (): void => {
  const form = app?.querySelector<HTMLFormElement>("#import-form");
  const result = app?.querySelector<HTMLElement>("#form-result");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const mnemonic = String(data.get("mnemonic") ?? "").trim();
    const vaultPassphrase = String(data.get("vaultPassphrase") ?? "");

    void createAccount(mnemonic, vaultPassphrase).then(
      (address) => {
        form.reset();
        if (result) {
          result.textContent = `Account saved: ${address}`;
        }
        void loadStatus().then(render);
      },
      (error: unknown) => {
        if (result) {
          result.textContent = error instanceof Error ? error.message : "Account import failed";
        }
      },
    );
  });
};

const bindUnlockForm = (): void => {
  const form = app?.querySelector<HTMLFormElement>("#unlock-form");
  const result = app?.querySelector<HTMLElement>("#form-result");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const vaultPassphrase = String(data.get("vaultPassphrase") ?? "");

    void unlockVault(vaultPassphrase).then(
      (status) => {
        form.reset();
        void render(status);
      },
      (error: unknown) => {
        if (result) {
          result.textContent = error instanceof Error ? error.message : "Unlock failed";
        }
      },
    );
  });
};

const render = async (status: WalletStatus): Promise<void> => {
  if (!app) {
    return;
  }

  const pending = await loadPendingApprovals();

  app.innerHTML = `
    <style>
      body {
        background: var(--mc-bg);
        color: var(--mc-text);
        font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        min-width: 320px;
      }
      .shell {
        display: grid;
        gap: 12px;
        padding: 16px;
      }
      .panel {
        background: var(--mc-panel);
        border: 1px solid var(--mc-border);
        border-radius: 8px;
        display: grid;
        gap: 10px;
        padding: 14px;
      }
      h1 {
        font-size: 16px;
        line-height: 1.2;
        margin: 0;
      }
      p {
        color: var(--mc-muted);
        margin: 0;
      }
      form,
      label {
        display: grid;
        gap: 8px;
      }
      input,
      textarea {
        border: 1px solid var(--mc-border);
        border-radius: 6px;
        box-sizing: border-box;
        color: var(--mc-text);
        font: inherit;
        padding: 8px;
        width: 100%;
      }
      textarea {
        min-height: 78px;
        resize: vertical;
      }
      button {
        background: var(--mc-accent);
        border: 0;
        border-radius: 6px;
        color: var(--mc-accent-text);
        font: inherit;
        min-height: 36px;
        padding: 0 12px;
      }
      button:disabled {
        opacity: 0.6;
      }
      .actions {
        display: flex;
        gap: 8px;
      }
    </style>
    <section class="shell" aria-label="Wallet status">
      <div class="panel">
        <h1>MC Wallet</h1>
        <p>${escapeHtml(status.network)}</p>
        <p>${status.hasVault ? `${status.accountCount} account(s)` : "No vault"}</p>
        <p>${status.locked ? "Locked" : "Unlocked"}</p>
        ${
          status.hasVault
            ? status.locked
              ? `<form id="unlock-form">
                  <label>
                    <span>Vault passphrase</span>
                    <input name="vaultPassphrase" type="password" minlength="12" required autocomplete="current-password" />
                  </label>
                  <button type="submit" ${status.ready ? "" : "disabled"}>Unlock</button>
                  <p id="form-result" role="status"></p>
                </form>`
              : `<button id="lock-button" type="button" ${status.ready ? "" : "disabled"}>Lock</button>
                <p id="form-result" role="status"></p>`
            : `<form id="import-form">
                <label>
                  <span>Mnemonic</span>
                  <textarea name="mnemonic" required autocomplete="off" spellcheck="false"></textarea>
                </label>
                <label>
                  <span>Vault passphrase</span>
                  <input name="vaultPassphrase" type="password" minlength="12" required autocomplete="new-password" />
                </label>
                <button type="submit" ${status.ready ? "" : "disabled"}>Import account</button>
                <p id="form-result" role="status"></p>
              </form>`
        }
        ${
          pending.length === 0
            ? ""
            : `<section aria-label="Connection approvals">
                <h1>Connection request</h1>
                ${pending
                  .map(
                    (approval) => `<p>${escapeHtml(approval.origin)}</p>
                    <div class="actions">
                      <button type="button" data-approval-action="approve" data-approval-id="${escapeHtml(approval.id)}" ${status.locked ? "disabled" : ""}>Approve</button>
                      <button type="button" data-approval-action="deny" data-approval-id="${escapeHtml(approval.id)}">Deny</button>
                    </div>`,
                  )
                  .join("")}
                <p id="approval-result" role="status"></p>
              </section>`
        }
      </div>
    </section>
  `;
  bindImportForm();
  bindUnlockForm();
  bindLockButton();
  bindApprovalButtons();
};

applySkin(defaultSkin, document.documentElement);
void render(await loadStatus());
