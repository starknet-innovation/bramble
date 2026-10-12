/**
 * Bindings for personalization journeys: account labels, contact removal,
 * appearance (theme and currency), and non-secret backup export/restore.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorLine, errorMessage, showToast } from "../../shared/dom";
import { buildInfo } from "../../shell/build-info";
import { bindGroupControls } from "./group-ui";

/**
 * Dependencies the settings bindings close over.
 */
export type SettingsUiDeps = {
  readonly app: Element | null;
  /** Ids of accounts already in the vault; phrase-import scan rows matching them lock. */
  readonly existingAccountIds?: () => ReadonlySet<string>;
  readonly expandedGroup: () => string | null;
  readonly networkId: () => string;
  readonly refresh: () => Promise<WalletStatus>;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly setExpandedGroup: (id: string | null) => void;
  readonly startAddAccount: () => void;
  readonly wallet: SidepanelWallet;
};

const rerender = async (deps: SettingsUiDeps): Promise<void> => {
  await deps.render(await deps.refresh());
};

/**
 * Binds every account-name form in the account flow's "Account names" section.
 * Each form carries the account it renames (`data-account-name-form`), so the
 * write targets the row the user submitted rather than whichever account is
 * active — the screen lists them all. An empty name clears the stored label and
 * the account falls back to its generated name.
 */
export const bindAccountLabel = (deps: SettingsUiDeps): void => {
  const result = deps.app?.querySelector<HTMLElement>("#label-result");

  deps.app?.querySelectorAll<HTMLFormElement>("[data-account-name-form]").forEach((form) => {
    const accountId = form.dataset["accountNameForm"];
    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!accountId) {
        return;
      }
      const label = String(new FormData(form).get("label") ?? "").trim();
      buttonBusy(submitButton, true);
      void deps.wallet.setAccountLabel(accountId, label).then(
        async () => {
          showToast(label ? "Name saved" : "Name cleared", "success", form);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Name update failed"), "error", form);
          if (result) {
            result.textContent = errorLine(error, "Name update failed");
          }
          buttonBusy(submitButton, false);
        },
      );
    });
  });
};

/**
 * Binds the account hide and show controls. Each row carries its own account id,
 * so the write targets the row the user pressed rather than the active account.
 * The background refuses hiding the last account a network still shows; that
 * refusal lands in the section's status line.
 */
const writeAccountVisibility = (
  deps: SettingsUiDeps,
  accountId: string,
  hidden: boolean,
  control: HTMLButtonElement,
): void => {
  buttonBusy(control, true);
  void deps.wallet.setAccountHidden(accountId, hidden).then(
    async () => {
      showToast(hidden ? "Account hidden" : "Account shown", "success", control);
      await rerender(deps);
    },
    (error: unknown) => {
      showToast(errorMessage(error, "Account update failed"), "error", control);
      const result = deps.app?.querySelector<HTMLElement>("#account-visibility-result");
      if (result) {
        result.textContent = errorLine(error, "Account update failed");
      }
      buttonBusy(control, false);
    },
  );
};

/**
 * Binds the per-row "Hide" controls and the "Show" controls in the manage
 * screen's "Hidden accounts" section.
 */
export const bindAccountVisibility = (deps: SettingsUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-hide-account]").forEach((control) => {
    const accountId = control.dataset["hideAccount"];
    control.addEventListener("click", () => {
      if (accountId) {
        writeAccountVisibility(deps, accountId, true, control);
      }
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-reveal-account]").forEach((control) => {
    const accountId = control.dataset["revealAccount"];
    control.addEventListener("click", () => {
      if (accountId) {
        writeAccountVisibility(deps, accountId, false, control);
      }
    });
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
 * Binds the account-groups controls wherever they appear in the panel — today
 * the manage-accounts "Groups" section — through one wiring.
 */
export const bindGroups = (deps: SettingsUiDeps): void => {
  bindGroupControls(deps.app, {
    expandedGroup: deps.expandedGroup,
    rerender: () => rerender(deps),
    setExpandedGroup: deps.setExpandedGroup,
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
          showToast("Contact removed", "success", button);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Contact removal failed"), "error", button);
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
            button,
          );
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Wallet request preference failed"), "error", button);
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
          showToast(`Theme: ${theme}`, "success", button);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Theme update failed"), "error", button);
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
        showToast(`Currency: ${value.toUpperCase()}`, "success", currencySelect);
        await rerender(deps);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Currency update failed"), "error", currencySelect);
        if (result) {
          result.textContent = errorLine(error, "Currency update failed");
        }
        currencySelect.disabled = false;
      },
    );
  });

  const diagnosticsToggle = deps.app?.querySelector<HTMLInputElement>("#reliability-diagnostics");
  const analyticsToggle = deps.app?.querySelector<HTMLInputElement>("#product-analytics");
  analyticsToggle?.addEventListener("change", () => {
    analyticsToggle.disabled = true;
    void deps.wallet.setDisplay({ productAnalytics: analyticsToggle.checked }).then(
      async () => {
        showToast(
          analyticsToggle.checked ? "Product analytics enabled" : "Product analytics disabled",
          "success",
          analyticsToggle,
        );
        await rerender(deps);
      },
      (error: unknown) => {
        analyticsToggle.checked = !analyticsToggle.checked;
        showToast(errorMessage(error, "Analytics preference failed"), "error", analyticsToggle);
        analyticsToggle.disabled = false;
      },
    );
  });

  diagnosticsToggle?.addEventListener("change", () => {
    diagnosticsToggle.disabled = true;
    void deps.wallet.setDisplay({ reliabilityDiagnostics: diagnosticsToggle.checked }).then(
      async () => {
        showToast(
          diagnosticsToggle.checked ? "Local diagnostics enabled" : "Local diagnostics cleared",
          "success",
          diagnosticsToggle,
        );
        await rerender(deps);
      },
      (error: unknown) => {
        diagnosticsToggle.checked = !diagnosticsToggle.checked;
        showToast(errorMessage(error, "Diagnostic preference failed"), "error", diagnosticsToggle);
        diagnosticsToggle.disabled = false;
      },
    );
  });

  const diagnosticsExport = deps.app?.querySelector<HTMLButtonElement>("#diagnostics-export");
  diagnosticsExport?.addEventListener("click", () => {
    buttonBusy(diagnosticsExport, true);
    void deps.wallet.loadDiagnostics().then(
      (diagnostics) => {
        const blob = new Blob([JSON.stringify({ build: buildInfo(), diagnostics }, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const anchor = diagnosticsExport.ownerDocument.createElement("a");
        anchor.href = url;
        anchor.download = "bramble-diagnostics.json";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast("Diagnostics downloaded", "success", diagnosticsExport);
        buttonBusy(diagnosticsExport, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Diagnostic export failed"), "error", diagnosticsExport);
        buttonBusy(diagnosticsExport, false);
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
        const anchor = exportButton.ownerDocument.createElement("a");
        anchor.href = url;
        anchor.download = "bramble-backup.json";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast("Backup downloaded", "success", exportButton);
        buttonBusy(exportButton, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Backup export failed"), "error", exportButton);
        buttonBusy(exportButton, false);
      },
    );
  });

  importButton?.addEventListener("click", () => {
    const file = fileInput?.files?.[0];
    if (!file) {
      showToast("Choose a backup file first", "error", importButton);
      return;
    }
    buttonBusy(importButton, true);
    void file
      .text()
      .then((text) => deps.wallet.importPreferences(JSON.parse(text) as unknown))
      .then(
        async () => {
          showToast("Backup restored", "success", importButton);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Backup restore failed"), "error", importButton);
          if (result) {
            result.textContent = errorLine(error, "Backup restore failed");
          }
          buttonBusy(importButton, false);
        },
      );
  });
};
