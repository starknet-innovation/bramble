/**
 * Onboarding binder for the create-wallet form. Generating a fresh recovery
 * phrase reveals confirmation inputs and blocks wallet creation until the
 * requested words are re-typed correctly; pasting an existing phrase (no
 * generation) skips verification. Verification uses the pure predicate in
 * ./backup-verify. Wallet creation also stays gated until the vault passphrase
 * satisfies the same length invariant the encrypted store enforces, so a
 * too-short passphrase surfaces inline instead of throwing unsurfaced later.
 */
import type { WalletStatus } from "../popup/responses";
import { isVaultPassphrase } from "../storage/encrypted-store";
import { verifyBackupWords } from "./backup-verify";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { SidepanelWallet } from "./runtime";

/**
 * Dependencies the onboarding binding closes over.
 */
export type OnboardingUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

/**
 * Binds the create-wallet form: generate or paste a recovery phrase, verify
 * generated phrases through re-typed words, then create the wallet.
 */
export const bindOnboarding = (deps: OnboardingUiDeps): void => {
  const { app, wallet } = deps;
  const form = app?.querySelector<HTMLFormElement>("#create-form");
  const generateButton = app?.querySelector<HTMLButtonElement>("#generate-button");
  const result = app?.querySelector<HTMLElement>("#form-result");
  const mnemonicInput = form?.querySelector<HTMLTextAreaElement>('textarea[name="mnemonic"]');
  const passphraseInput = form?.querySelector<HTMLInputElement>('input[name="vaultPassphrase"]');
  const passphraseResult = form?.querySelector<HTMLElement>("#passphrase-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const verifySection = form?.querySelector<HTMLElement>("#backup-verify");
  const verifyInputs = Array.from(
    form?.querySelectorAll<HTMLInputElement>('input[name^="verify-"]') ?? [],
  );
  const verifyResult = form?.querySelector<HTMLElement>("#verify-result");
  let requiresVerification = false;

  const answers = (): readonly string[] => verifyInputs.map((input) => input.value);

  const passphraseOk = (): boolean => isVaultPassphrase(passphraseInput?.value ?? "");

  const refreshGate = (): void => {
    const verified =
      !requiresVerification || verifyBackupWords(mnemonicInput?.value ?? "", answers());
    if (submitButton) {
      submitButton.disabled = !(passphraseOk() && verified);
    }
    if (passphraseResult) {
      const value = passphraseInput?.value ?? "";
      passphraseResult.textContent =
        value.length > 0 && !isVaultPassphrase(value)
          ? "Passphrase must be at least 12 characters."
          : "";
    }
    if (requiresVerification && verifyResult) {
      verifyResult.textContent = verified
        ? "Confirmed"
        : "Re-type the requested words to continue.";
    }
  };

  mnemonicInput?.addEventListener("input", refreshGate);
  passphraseInput?.addEventListener("input", refreshGate);
  for (const input of verifyInputs) {
    input.addEventListener("input", refreshGate);
  }
  refreshGate();

  generateButton?.addEventListener("click", () => {
    buttonBusy(generateButton, true);
    void wallet.generateMnemonic().then(
      (mnemonic) => {
        if (mnemonicInput) {
          mnemonicInput.value = mnemonic;
        }
        requiresVerification = true;
        verifySection?.removeAttribute("hidden");
        for (const input of verifyInputs) {
          input.value = "";
        }
        if (submitButton) {
          submitButton.disabled = true;
        }
        refreshGate();
        if (result) {
          result.textContent = "Recovery phrase generated. Confirm the words below.";
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
    if (!passphraseOk()) {
      if (passphraseResult) {
        passphraseResult.textContent = "Passphrase must be at least 12 characters.";
      }
      showToast("Passphrase must be at least 12 characters", "error");
      return;
    }
    if (requiresVerification && !verifyBackupWords(mnemonicInput?.value ?? "", answers())) {
      if (verifyResult) {
        verifyResult.textContent = "Confirm the recovery words before creating the wallet.";
      }
      showToast("Confirm your recovery phrase first", "error");
      return;
    }
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
          showToast("Wallet created", "success");
          await deps.render(await wallet.loadStatus());
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
