/**
 * Onboarding binder for the create-wallet form. Generating a fresh recovery
 * phrase reveals confirmation inputs and blocks wallet creation until the
 * requested words are re-typed correctly; pasting an existing phrase (no
 * generation) skips verification. Verification uses the pure predicate in
 * ./backup-verify. On Starknet Mainnet the user must also accept a real-funds
 * acknowledgement (see ./mainnet-ack) before the wallet can be created.
 */
import type { WalletStatus } from "../popup/responses";
import { verifyBackupWords } from "./backup-verify";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { MAINNET_NETWORK_ID, mainnetAckSatisfied, requiresMainnetAck } from "./mainnet-ack";
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
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const verifySection = form?.querySelector<HTMLElement>("#backup-verify");
  const verifyInputs = Array.from(
    form?.querySelectorAll<HTMLInputElement>('input[name^="verify-"]') ?? [],
  );
  const verifyResult = form?.querySelector<HTMLElement>("#verify-result");
  const networkSelect = form?.querySelector<HTMLSelectElement>('select[name="networkId"]');
  const ackContainer = form?.querySelector<HTMLElement>("#mainnet-ack");
  const ackCheckbox = form?.querySelector<HTMLInputElement>('input[name="mainnetAck"]');
  // The template only disables Create for a not-ready wallet; capture that so the
  // gates below never re-enable a wallet that cannot create an account yet.
  const initiallyReady = !(submitButton?.disabled ?? true);
  let requiresVerification = false;

  const answers = (): readonly string[] => verifyInputs.map((input) => input.value);

  const selectedNetworkId = (): string => networkSelect?.value ?? MAINNET_NETWORK_ID;

  const verificationSatisfied = (): boolean =>
    !requiresVerification || verifyBackupWords(mnemonicInput?.value ?? "", answers());

  const ackSatisfied = (): boolean =>
    mainnetAckSatisfied(selectedNetworkId(), ackCheckbox?.checked ?? false);

  const refreshVerification = (): void => {
    if (submitButton) {
      submitButton.disabled = !(initiallyReady && verificationSatisfied() && ackSatisfied());
    }
    if (verifyResult && requiresVerification) {
      verifyResult.textContent = verificationSatisfied()
        ? "Confirmed"
        : "Re-type the requested words to continue.";
    }
  };

  const syncNetworkGate = (): void => {
    if (ackContainer) {
      if (requiresMainnetAck(selectedNetworkId())) {
        ackContainer.removeAttribute("hidden");
      } else {
        ackContainer.setAttribute("hidden", "");
      }
    }
    refreshVerification();
  };

  mnemonicInput?.addEventListener("input", refreshVerification);
  for (const input of verifyInputs) {
    input.addEventListener("input", refreshVerification);
  }
  networkSelect?.addEventListener("change", syncNetworkGate);
  ackCheckbox?.addEventListener("change", refreshVerification);
  syncNetworkGate();

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
        refreshVerification();
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
    if (requiresVerification && !verifyBackupWords(mnemonicInput?.value ?? "", answers())) {
      if (verifyResult) {
        verifyResult.textContent = "Confirm the recovery words before creating the wallet.";
      }
      showToast("Confirm your recovery phrase first", "error");
      return;
    }
    if (!ackSatisfied()) {
      if (result) {
        result.textContent =
          "Confirm you understand this wallet holds real funds on Starknet Mainnet.";
      }
      showToast("Acknowledge the real-funds warning first", "error");
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
