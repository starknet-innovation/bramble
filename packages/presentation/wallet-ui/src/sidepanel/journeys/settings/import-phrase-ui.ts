/**
 * Binding for the in-wallet "Import a recovery phrase" flow. Isolated because
 * it reads a foreign recovery phrase from the form: the phrase drives the
 * read-only discovery scan and the single privileged `importSeedAccounts`
 * request (which retains it inside the encrypted vault),
 * and is never logged, echoed, or stored in preferences. Reuses the first-run
 * scan binder so detection, grouping, and selection behave identically.
 */
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { bindRecoveryAccountUi } from "../onboarding/recovery-account-ui";
import { bindRecoveryWordAssist } from "../onboarding/recovery-word-assist";
import { recoveryWordsFrom, setRecoveryWordCount } from "../onboarding/recovery-word-state";
import type { SettingsUiDeps } from "./settings-ui";

/**
 * Binds the import-phrase flow: word entry gates the search button on a complete
 * phrase, "Find its accounts" validates through Krusty and starts the shared
 * grouped scan (accounts already in the vault are shown locked), and the
 * restore button commits through the privileged phrase-import request.
 */
export const bindImportPhrase = (deps: SettingsUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#import-phrase-form");
  if (!form) {
    return;
  }
  const inputs = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[data-recovery-kind="import"]'),
  );
  const search = form.querySelector<HTMLButtonElement>("#import-phrase-search");
  const scanSection = form.querySelector<HTMLElement>("#import-phrase-scan");
  const result = form.querySelector<HTMLElement>("#recovery-result");
  const lengthToggle = form.querySelector<HTMLButtonElement>("#phrase-length-toggle");
  let wordCount: 12 | 24 = 12;
  let mnemonic = "";

  const wordAssist = bindRecoveryWordAssist(inputs, form);
  const refreshWords = (): void => {
    const words = recoveryWordsFrom(inputs, wordCount);
    const incomplete = words.some((word) => word.length === 0);
    wordAssist.refreshWordValidity();
    if (search) {
      // Emptiness only — BIP39 membership stays advisory; Krusty validates.
      search.disabled = incomplete;
    }
    if (result) {
      result.textContent = incomplete
        ? words.some((word) => word.length > 0)
          ? `Enter all ${wordCount} words to continue.`
          : ""
        : !wordAssist.wordsKnown(wordCount)
          ? "Highlighted words are not in the BIP39 English list."
          : "";
    }
  };
  for (const input of inputs) {
    input.addEventListener("input", refreshWords);
  }
  lengthToggle?.addEventListener("click", () => {
    wordCount = wordCount === 12 ? 24 : 12;
    setRecoveryWordCount(form, inputs, wordCount, "import");
    lengthToggle.lastChild?.replaceWith(
      wordCount === 12 ? "Use a 24-word phrase" : "Use a 12-word phrase",
    );
    refreshWords();
  });

  const scan = bindRecoveryAccountUi({
    existingIds: () => deps.existingAccountIds?.() ?? new Set<string>(),
    form,
    mnemonic: () => mnemonic,
    networkId: deps.networkId,
    render: deps.render,
    restore: (phrase, networkId, selections) =>
      deps.wallet.importSeedAccounts(phrase, networkId, selections),
    vaultPassphrase: () => "",
    wallet: deps.wallet,
  });

  search?.addEventListener("click", () => {
    const phrase = recoveryWordsFrom(inputs, wordCount).join(" ").trim();
    if (phrase.split(/\s+/).some((word) => word.length === 0)) {
      return;
    }
    buttonBusy(search, true);
    void deps.wallet.validateMnemonic(phrase).then(
      (valid) => {
        buttonBusy(search, false);
        if (!valid) {
          if (result) {
            result.textContent = "This recovery phrase is not valid.";
          }
          showToast("This recovery phrase is not valid.", "error", form);
          return;
        }
        mnemonic = phrase;
        if (result) {
          result.textContent = "";
        }
        if (scanSection) {
          scanSection.hidden = false;
        }
        scan.start();
      },
      (error: unknown) => {
        buttonBusy(search, false);
        const message = errorMessage(error, "Phrase validation is unavailable");
        if (result) {
          result.textContent = message;
        }
        showToast(message, "error", form);
      },
    );
  });

  refreshWords();
};
