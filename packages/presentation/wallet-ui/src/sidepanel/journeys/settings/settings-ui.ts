/**
 * Bindings for personalization journeys: account labels, contact removal,
 * appearance (theme and currency), and non-secret backup export/restore.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { createDiscoveredAccountsPanel } from "../onboarding/discovered-accounts-ui";
import { addAccountsAtIndexes, restoreOutcomeMessage } from "../onboarding/restore-accounts";
import { bindGroupControls } from "./group-ui";

/**
 * Dependencies the settings bindings close over.
 */
export type SettingsUiDeps = {
  readonly activeAccountId: () => string | null;
  readonly app: Element | null;
  readonly expandedGroup: () => string | null;
  readonly networkId: () => string;
  readonly openAssign: () => string | null;
  readonly refresh: () => Promise<WalletStatus>;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly setExpandedGroup: (id: string | null) => void;
  readonly setOpenAssign: (id: string | null) => void;
  readonly startAddAccount: () => void;
  readonly wallet: SidepanelWallet;
};

const rerender = async (deps: SettingsUiDeps): Promise<void> => {
  await deps.render(await deps.refresh());
};

/**
 * Binds the account label form on the account flow.
 */
export const bindAccountLabel = (deps: SettingsUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#label-form");
  const result = deps.app?.querySelector<HTMLElement>("#label-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const accountId = deps.activeAccountId();
    if (!accountId) {
      return;
    }
    const label = String(new FormData(form).get("label") ?? "").trim();
    buttonBusy(submitButton, true);
    void deps.wallet.setAccountLabel(accountId, label).then(
      async () => {
        showToast(label ? "Label saved" : "Label cleared", "success");
        await rerender(deps);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Label update failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "Label update failed");
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};

/**
 * Binds the "Add account" button on the account flow. Opens the account-type
 * chooser (New HD account / Import a private key / Connect a Ledger) rather than
 * deriving directly, so every add path — including a hardware account — is
 * reachable from one entry. The chooser routes each option to its existing flow.
 */
export const bindAddAccount = (deps: SettingsUiDeps): void => {
  const button = deps.app?.querySelector<HTMLButtonElement>("#new-account");
  button?.addEventListener("click", () => deps.startAddAccount());
};

/**
 * Binds "Find my other accounts" on the account flow: scans this wallet's
 * recovery phrase for accounts that already exist on chain, lists them with every
 * new one preselected, and adds only what the user confirms.
 *
 * Reachable from the accounts surface rather than only from setup, because a
 * wallet imported before this existed is exactly the wallet that needs it.
 */
export const bindRestoreAccounts = (deps: SettingsUiDeps): void => {
  const button = deps.app?.querySelector<HTMLButtonElement>("#restore-accounts");
  const result = deps.app?.querySelector<HTMLElement>("#new-account-result");
  const say = (message: string): void => {
    if (result) {
      result.textContent = message;
    }
  };
  let found = 0;
  const panel = createDiscoveredAccountsPanel({
    confirm: {
      label: "Add selected accounts",
      onConfirm: () => {
        const chosen = panel.selected();
        if (chosen.length === 0) {
          say("Select at least one account to add.");
          return;
        }
        say("Adding the selected accounts…");
        void addAccountsAtIndexes(deps.wallet, deps.networkId(), chosen).then(
          async (added) => {
            showToast(restoreOutcomeMessage({ added, found }), "success");
            // The re-render clears the list, which is right: its selection
            // described a scan that has now been acted on.
            await rerender(deps);
          },
          (error: unknown) => {
            say(errorMessage(error, "Could not add the selected accounts"));
          },
        );
      },
    },
    container: deps.app?.querySelector<HTMLElement>("#discovered-accounts") ?? null,
  });

  button?.addEventListener("click", () => {
    buttonBusy(button, true);
    say("Checking the chain for accounts from your recovery phrase…");
    void deps.wallet.scanSeedAccounts().then(
      (candidates) => {
        found = candidates.length;
        const addable = candidates.filter((candidate) => !candidate.alreadyAdded);
        if (addable.length === 0) {
          panel.clear();
          showToast(restoreOutcomeMessage({ added: 0, found }), "success");
        } else {
          panel.render(candidates);
          say("Select the accounts to add, then confirm.");
        }
        buttonBusy(button, false);
      },
      (error: unknown) => {
        say(errorMessage(error, "Could not scan for accounts"));
        buttonBusy(button, false);
      },
    );
  });
};

/**
 * Binds the account-groups controls wherever they appear in the panel — the
 * manage-accounts "Groups" section, the per-account assignment panels, and the
 * left drawer's assignment panels — so both entry points share one wiring.
 */
export const bindGroups = (deps: SettingsUiDeps): void => {
  bindGroupControls(deps.app, {
    expandedGroup: deps.expandedGroup,
    openAssign: deps.openAssign,
    rerender: () => rerender(deps),
    setExpandedGroup: deps.setExpandedGroup,
    setOpenAssign: deps.setOpenAssign,
    wallet: deps.wallet,
  });
};

/**
 * Binds contact removal buttons on the address book flow.
 */
export const bindContacts = (deps: SettingsUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-remove-address]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["removeAddress"];
      if (!id) {
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.removeAddress(id).then(
        async () => {
          showToast("Contact removed", "success");
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Contact removal failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });
};

/**
 * Binds theme rows and the currency select on settings.
 */
export const bindAppearance = (deps: SettingsUiDeps): void => {
  const result = deps.app?.querySelector<HTMLElement>("#display-result");

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-approval-surface]").forEach((button) => {
    button.addEventListener("click", () => {
      const approvalSurface = button.dataset["approvalSurface"];
      if (
        (approvalSurface !== "popup" && approvalSurface !== "side-panel") ||
        button.getAttribute("aria-pressed") === "true"
      ) {
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.setDisplay({ approvalSurface }).then(
        async () => {
          showToast(
            approvalSurface === "popup"
              ? "Wallet requests open as a popup"
              : "Wallet requests open in the side panel",
            "success",
          );
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Wallet request preference failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-theme-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const theme = button.dataset["themeId"];
      if (
        (theme !== "dark" && theme !== "light") ||
        button.getAttribute("aria-pressed") === "true"
      ) {
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.setDisplay({ theme }).then(
        async () => {
          showToast(`Theme: ${theme}`, "success");
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Theme update failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });

  const currencySelect = deps.app?.querySelector<HTMLSelectElement>("#currency-select");
  currencySelect?.addEventListener("change", () => {
    const value = currencySelect.value;
    if (value !== "eur" && value !== "gbp" && value !== "usd") {
      return;
    }
    currencySelect.disabled = true;
    void deps.wallet.setDisplay({ displayCurrency: value }).then(
      async () => {
        showToast(`Currency: ${value.toUpperCase()}`, "success");
        await rerender(deps);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Currency update failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "Currency update failed");
        }
        currencySelect.disabled = false;
      },
    );
  });
};

/**
 * Binds backup export and restore controls on the backup flow.
 */
export const bindBackup = (deps: SettingsUiDeps): void => {
  const exportButton = deps.app?.querySelector<HTMLButtonElement>("#backup-export");
  const importButton = deps.app?.querySelector<HTMLButtonElement>("#backup-import");
  const fileInput = deps.app?.querySelector<HTMLInputElement>("#backup-file");
  const result = deps.app?.querySelector<HTMLElement>("#backup-result");

  exportButton?.addEventListener("click", () => {
    buttonBusy(exportButton, true);
    void deps.wallet.loadPreferences().then(
      (preferences) => {
        const blob = new Blob([JSON.stringify(preferences, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "mc-wallet-backup.json";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast("Backup downloaded", "success");
        buttonBusy(exportButton, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Backup export failed"), "error");
        buttonBusy(exportButton, false);
      },
    );
  });

  importButton?.addEventListener("click", () => {
    const file = fileInput?.files?.[0];
    if (!file) {
      showToast("Choose a backup file first", "error");
      return;
    }
    buttonBusy(importButton, true);
    void file
      .text()
      .then((text) => deps.wallet.importPreferences(JSON.parse(text) as unknown))
      .then(
        async () => {
          showToast("Backup restored", "success");
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Backup restore failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Backup restore failed");
          }
          buttonBusy(importButton, false);
        },
      );
  });
};
