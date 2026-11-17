/**
 * Binding for the settings-screen "Find my other accounts" flow. The wallet
 * rescans the phrase it already holds: the panel sends no credential, the
 * background does the read inside the vault boundary through the live unlock
 * session, and the picks commit through the privileged import request. Reuses
 * the first-run scan binder so detection, grouping, and selection behave
 * identically.
 */
import { buttonBusy, errorDetails, errorLine, showToast } from "../../shared/dom";
import { bindRecoveryAccountUi } from "../onboarding/recovery-account-ui";
import type { SettingsUiDeps } from "./settings-ui";

/**
 * Binds the find-accounts flow: "Search for accounts" reveals the shared grouped
 * scan (accounts already in this wallet are shown locked), and the restore
 * button commits the selection through the privileged import request.
 */
export const bindFindAccounts = (deps: SettingsUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#find-accounts-form");
  if (!form) {
    return;
  }
  const search = form.querySelector<HTMLButtonElement>("#find-accounts-search");
  const scanSection = form.querySelector<HTMLElement>("#find-accounts-scan");
  const result = form.querySelector<HTMLElement>("#find-accounts-result");

  const scan = bindRecoveryAccountUi({
    // Injected discovery: this screen has no typed phrase, so the picker asks
    // the background to rescan the wallet's own accounts instead.
    discover: (manualIndex) => deps.wallet.discoverOwnAccounts(deps.networkId(), manualIndex),
    findByAddress: (address) => deps.wallet.findOwnAccountByAddress(deps.networkId(), address),
    existingIds: () => deps.existingAccountIds?.() ?? new Set<string>(),
    form,
    networkId: deps.networkId,
    render: deps.render,
    restore: (_unused, networkId, selections) =>
      deps.wallet.importOwnAccounts(networkId, selections),
    wallet: deps.wallet,
  });

  search?.addEventListener("click", () => {
    if (result) {
      result.textContent = "";
    }
    if (scanSection) {
      scanSection.hidden = false;
    }
    buttonBusy(search, true);
    void deps.wallet.loadStatus().then(
      () => {
        buttonBusy(search, false);
        scan.start();
      },
      (error: unknown) => {
        buttonBusy(search, false);
        if (result) {
          result.textContent = errorLine(error, "Account search is unavailable");
        }
        showToast(errorDetails(error, "Account search is unavailable"), "error", form);
      },
    );
  });
};
