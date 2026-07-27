import { locked, onboarding } from "../../../src/sidepanel/gate-views";
import { ledgerMessage } from "../../../src/sidepanel/ledger/errors";
import {
  addAccountChooser,
  ledgerAccountPicker,
  ledgerConnectPrompt,
  ledgerDevicePicker,
  ledgerOnboardError,
  ledgerReadingPrompt,
} from "../../../src/sidepanel/ledger/onboard-views";
import { bindOnboarding, bindUnlock } from "../../../src/sidepanel/onboarding-ui";
import { createSidepanelRuntime } from "../../../src/sidepanel/runtime";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "../../../src/starknet/ledger-path";
import type { LedgerAccountRef } from "../../../src/storage/vault-schema";
import { invokeApproval, ledgerAccount } from "./fixtures";
import { emptyWalletStatus, lockedStatus } from "./journey-fixtures";
import { messageType, nextTurn, updateForm } from "./scenario-runtime";
import type { FrameContext, WalletScenario } from "./types";

const FIXTURE_WORDS = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";

const onboardingWallet = (context: FrameContext) =>
  createSidepanelRuntime({
    sendMessage: async (message) => {
      const type = messageType(message);
      context.emit({ detail: type ?? "invalid request", kind: "action" });
      if (type === "wallet.generateMnemonic") {
        return { mnemonic: FIXTURE_WORDS, ok: true };
      }
      if (type === "wallet.unlock") {
        return { error: "Vault passphrase is incorrect" };
      }
      return { error: "UI Lab blocks non-fixture runtime requests" };
    },
  });

const generatePhrase =
  (reveal: boolean, verified: boolean) =>
  async (context: FrameContext): Promise<void> => {
    bindOnboarding({
      app: context.app,
      render: async () => undefined,
      wallet: onboardingWallet(context),
    });
    context.app.querySelector<HTMLButtonElement>("#generate-button")?.click();
    await nextTurn();
    if (reveal) {
      context.app.querySelector<HTMLButtonElement>("#phrase-toggle")?.click();
    }
    if (!verified) {
      return;
    }
    updateForm(context, 'input[name="vaultPassphrase"]', "fixture-passphrase");
    updateForm(context, 'input[name="verify-0"]', "gamma");
    updateForm(context, 'input[name="verify-1"]', "eta");
    updateForm(context, 'input[name="verify-2"]', "lambda");
    const acknowledgement = context.app.querySelector<HTMLInputElement>('input[name="mainnetAck"]');
    acknowledgement?.click();
  };

const prepareImported = (context: FrameContext): void => {
  bindOnboarding({
    app: context.app,
    render: async () => undefined,
    wallet: onboardingWallet(context),
  });
  updateForm(context, 'textarea[name="mnemonic"]', FIXTURE_WORDS);
  updateForm(context, 'input[name="vaultPassphrase"]', "fixture-passphrase");
  context.app.querySelector<HTMLInputElement>('input[name="mainnetAck"]')?.click();
};

const prepareUnlockFailure = async (context: FrameContext): Promise<void> => {
  bindUnlock({
    app: context.app,
    render: async () => undefined,
    wallet: onboardingWallet(context),
  });
  updateForm(context, 'input[name="vaultPassphrase"]', "incorrect-fixture");
  context.app.querySelector<HTMLFormElement>("#unlock-form")?.requestSubmit();
  await nextTurn();
};

export const onboardingScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => onboarding(emptyWalletStatus),
      id: "welcome",
      label: "Choose a setup path",
      narrative:
        "First run offers recovery-phrase and Ledger setup without mixing their security models.",
      state: { gate: "first-run", network: "mainnet", secrets: "fixture only" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "generated-masked",
      label: "Generated phrase masked",
      narrative:
        "The real onboarding binding masks newly generated words and opens backup verification.",
      prepare: generatePhrase(false, false),
      state: { phrase: "masked", verification: "required" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "generated-revealed",
      label: "Phrase deliberately revealed",
      narrative: "A deliberate toggle exposes the fixture phrase for an offline backup check.",
      prepare: generatePhrase(true, false),
      state: { phrase: "visible fixture", verification: "required" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "backup-confirmed",
      label: "Backup confirmed",
      narrative:
        "Requested words, passphrase strength, and the Mainnet acknowledgement unlock creation together.",
      prepare: generatePhrase(false, true),
      state: { createEnabled: true, mainnetAcknowledged: true, verification: "passed" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "import-existing",
      label: "Import existing wallet",
      narrative:
        "Pasted recovery words use the import path and do not masquerade as a newly generated backup.",
      prepare: prepareImported,
      state: { mode: "import", verification: "not generated" },
    },
  ],
  description: "Full-page first run, generated-backup verification, and existing-wallet import.",
  id: "onboarding",
  surface: "fullpage",
  title: "Full-page onboarding",
};

export const unlockScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => locked(lockedStatus),
      id: "locked",
      label: "Returning wallet locked",
      narrative: "The returning journey focuses on one re-authentication action.",
      state: { gate: "locked", pending: 0 },
    },
    {
      content: () => locked(lockedStatus, [invokeApproval]),
      id: "locked-request",
      label: "Request waiting at unlock",
      narrative:
        "A parked request stays visible before authentication without exposing transaction details.",
      state: { gate: "locked", pending: 1 },
    },
    {
      content: () => locked(lockedStatus),
      id: "unlock-failed",
      label: "Unlock failed",
      narrative:
        "The real unlock binding returns a specific inline recovery message and stays locked.",
      prepare: prepareUnlockFailure,
      state: { gate: "locked", result: "error" },
    },
  ],
  description: "Returning-wallet unlock, pending-request visibility, and authentication failure.",
  id: "unlock",
  surface: "sidepanel",
  title: "Returning wallet unlock",
};

const ledgerCandidate = (
  index: number,
  address: string,
  duplicate: boolean,
  deployed: boolean | null,
  balance: string | null,
) => {
  const account: LedgerAccountRef = {
    ...ledgerAccount,
    address,
    derivation: {
      accountIndex: index,
      eip2645application: LEDGER_EIP2645_APPLICATION,
      kind: "ledger",
      path: ledgerAccountPath(index),
    },
    id: `SN_MAIN:${address}`,
    publicKeyX: `0x${index + 80}`,
  };
  return { account, balance, deployed, duplicate };
};

export const ledgerOnboardingScenario: WalletScenario = {
  checkpoints: [
    {
      content: addAccountChooser,
      id: "method",
      label: "Choose account method",
      narrative: "Software derivation, raw-key import, and hardware setup remain explicit routes.",
      state: { choices: 3, secretBoundary: "visible" },
    },
    {
      content: ledgerConnectPrompt,
      id: "connect",
      label: "Connect device",
      narrative: "The user gesture is requested before the browser device chooser may open.",
      state: { browserGrant: "not requested", fundsMove: false },
    },
    {
      content: () =>
        ledgerDevicePicker([
          { id: "fixture-flex", label: "Ledger Flex · USB" },
          { id: "fixture-stax", label: "Ledger Stax · USB" },
        ]),
      id: "devices",
      label: "Choose among devices",
      narrative: "Multiple origin grants require explicit device selection.",
      state: { candidates: 2, transport: "USB" },
    },
    {
      content: ledgerReadingPrompt,
      id: "reading",
      label: "Read public accounts",
      narrative: "Silent public-key enumeration has a visible, cancellable progress state.",
      state: { secretsRead: false, stage: "enumerating" },
    },
    {
      content: () =>
        ledgerAccountPicker(
          [
            ledgerCandidate(0, ledgerAccount.address, true, true, "84.2 STRK"),
            ledgerCandidate(
              1,
              "0x7234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
              false,
              true,
              "12.0 STRK",
            ),
            ledgerCandidate(
              2,
              "0x8234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
              false,
              false,
              "0 STRK",
            ),
          ],
          [1, 2],
        ),
      id: "accounts",
      label: "Select derived accounts",
      narrative:
        "Duplicate, deployed, counterfactual, balance, and multi-select states are visible together.",
      state: { duplicates: 1, selected: 2, visibleAccounts: 3 },
    },
    {
      content: () =>
        ledgerAccountPicker(
          [
            ledgerCandidate(0, ledgerAccount.address, true, true, "84.2 STRK"),
            ledgerCandidate(
              1,
              "0x7234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
              true,
              true,
              "12.0 STRK",
            ),
            ledgerCandidate(
              2,
              "0x8234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
              false,
              false,
              "0 STRK",
            ),
          ],
          [2],
          "Account 1 was added. Account 2 still needs attention; retrying will not duplicate prior work.",
        ),
      id: "partial-add",
      label: "Partial add recovery",
      narrative:
        "A mid-batch failure preserves completed accounts and leaves a recoverable remaining selection.",
      state: { added: 1, retryable: 1, staleDuplicates: false },
    },
    {
      content: () => ledgerOnboardError(ledgerMessage("no-app-open")),
      id: "error",
      label: "Device recovery",
      narrative: "The failure names the missing Starknet app and retains both retry and cancel.",
      state: { code: "no-app-open", retryable: true },
    },
  ],
  description:
    "Add-account method choice, device selection, enumeration, account selection, partial recovery, and errors.",
  id: "ledger-onboarding",
  surface: "sidepanel",
  title: "Ledger account onboarding",
};
