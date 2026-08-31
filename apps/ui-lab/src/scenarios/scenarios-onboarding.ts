import { ledgerMessage } from "@mc-wallet/ledger-protocol/errors";
import {
  type AccountContractType,
  isAccountContractType,
  type LedgerAccountRef,
} from "@mc-wallet/wallet-model/accounts";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import {
  addAccountChooser,
  bindOnboarding,
  createSidepanelRuntime,
  ledgerAccountPicker,
  ledgerConnectPrompt,
  ledgerDevicePicker,
  ledgerOnboardError,
  ledgerReadingPrompt,
  onboarding,
  onboardingComplete,
} from "@mc-wallet/wallet-ui/lab";
import { argentSoftwareAccount, ledgerAccount, softwareAccount } from "../fixtures/fixtures";
import { emptyWalletStatus } from "../fixtures/journey-fixtures";
import { messageType, nextTurn, updateForm } from "../runtime/scenario-runtime";
import type { FrameContext, WalletScenario } from "../runtime/types";

const FIXTURE_WORDS =
  "habit hope tip crystal because grunt nation idea electric witness alert like";
const FIXTURE_PASSPHRASE = "fixture vault passphrase";

const onboardingWallet = (context: FrameContext) =>
  createSidepanelRuntime({
    sendMessage: async (message) => {
      const type = messageType(message);
      context.emit({ detail: type ?? "invalid request", kind: "action" });
      if (type === "wallet.generateMnemonic") {
        return { mnemonic: FIXTURE_WORDS, ok: true };
      }
      if (type === "wallet.validateMnemonic") {
        return { ok: true, valid: true };
      }
      if (type === "wallet.discoverRecoveryAccounts") {
        return {
          candidates: [
            { account: softwareAccount, deployed: true, funded: false },
            { account: argentSoftwareAccount, deployed: false, funded: true },
          ],
          complete: true,
          nextIndex: 20,
          ok: true,
        };
      }
      if (type === "wallet.recoverAccounts") {
        return { accounts: [softwareAccount, argentSoftwareAccount], ok: true };
      }
      if (type === "wallet.previewAccount" || type === "wallet.createAccount") {
        const requested =
          typeof message === "object" &&
          message !== null &&
          isAccountContractType(Reflect.get(message, "accountContractType"))
            ? Reflect.get(message, "accountContractType")
            : null;
        return {
          account: requested === "argent" ? argentSoftwareAccount : softwareAccount,
          ok: true,
        };
      }
      if (type === "wallet.status") {
        return emptyWalletStatus;
      }
      if (type === "wallet.unlock") {
        return { error: "Vault passphrase is incorrect" };
      }
      return { error: "UI Lab blocks non-fixture runtime requests" };
    },
  });

const bindFixtureOnboarding = (context: FrameContext): void => {
  bindOnboarding({
    app: context.app,
    render: async () => undefined,
    wallet: onboardingWallet(context),
  });
};

const press = (context: FrameContext, selector: string): void => {
  const control = context.app.querySelector<HTMLButtonElement>(selector);
  if (!control) {
    throw new Error(`Missing fixture action ${selector}`);
  }
  control.click();
};

const prepareMethod = (context: FrameContext): void => {
  bindFixtureOnboarding(context);
  press(context, "#add-existing-button");
};

const prepareRecovery = (context: FrameContext): void => {
  prepareMethod(context);
  press(context, "#recovery-method-button");
};

const preparePassword = async (context: FrameContext): Promise<void> => {
  prepareRecovery(context);
  updateForm(context, 'input[name="import-word-0"]', FIXTURE_WORDS);
  press(context, "#recovery-continue");
  await nextTurn();
};

const selectSoftwareContract = (context: FrameContext, contract: AccountContractType): void => {
  press(context, `[data-account-contract="${contract}"]`);
};

const prepareSoftwareContract =
  (contract: AccountContractType) =>
  async (context: FrameContext): Promise<void> => {
    await prepareGenerated(true, true)(context);
    press(context, "#verify-continue");
    updateForm(context, 'input[name="vaultPassphrase"]', FIXTURE_PASSPHRASE);
    updateForm(context, 'input[name="vaultPassphraseConfirm"]', FIXTURE_PASSPHRASE);
    press(context, "#choose-account-contract-button");
    selectSoftwareContract(context, contract);
  };

const prepareRecoveryAccounts =
  (acknowledged: boolean) =>
  async (context: FrameContext): Promise<void> => {
    await preparePassword(context);
    updateForm(context, 'input[name="vaultPassphrase"]', FIXTURE_PASSPHRASE);
    updateForm(context, 'input[name="vaultPassphraseConfirm"]', FIXTURE_PASSPHRASE);
    press(context, "#choose-account-contract-button");
    await nextTurn();
    if (acknowledged) {
      context.app.querySelector<HTMLInputElement>('input[name="recoveryMainnetAck"]')?.click();
    }
  };

const prepareAccountSelection =
  (contract: AccountContractType, selected: boolean) =>
  async (context: FrameContext): Promise<void> => {
    await prepareSoftwareContract(contract)(context);
    press(context, "#review-account-button");
    await nextTurn();
    if (!selected) {
      return;
    }
    press(context, "#account-preview");
    context.app.querySelector<HTMLInputElement>('input[name="mainnetAck"]')?.click();
  };

const prepareGenerated =
  (reveal: boolean, confirm: boolean) =>
  async (context: FrameContext): Promise<void> => {
    bindFixtureOnboarding(context);
    press(context, "#create-new-button");
    await nextTurn();
    if (reveal || confirm) {
      press(context, "#phrase-toggle");
    }
    if (!confirm) {
      return;
    }
    press(context, "#generated-continue");
    updateForm(context, 'input[name="verify-0"]', "tip");
    updateForm(context, 'input[name="verify-1"]', "nation");
    updateForm(context, 'input[name="verify-2"]', "alert");
  };

const prepareLedgerContract = (
  context: FrameContext,
  contract: AccountContractType = "argent",
): void => {
  prepareMethod(context);
  press(context, "#ledger-method-button");
  press(context, `[data-ledger-account-contract="${contract}"]`);
};

const prepareLedger = (context: FrameContext): void => {
  prepareLedgerContract(context);
  press(context, "#ledger-contract-continue");
};

export const onboardingScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => onboarding(emptyWalletStatus),
      id: "welcome",
      label: "Choose a setup path",
      narrative: "A decisive first screen offers creation and existing-wallet paths.",
      prepare: bindFixtureOnboarding,
      state: { gate: "first-run", network: "mainnet", secrets: "fixture only" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "method",
      label: "Choose import method",
      narrative: "Recovery phrase and Ledger remain explicit, separate security models.",
      prepare: prepareMethod,
      state: { choices: 2, path: "existing wallet" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "recovery",
      label: "Enter recovery phrase",
      narrative: "Twelve visible word slots accept sequential entry or one complete paste.",
      prepare: prepareRecovery,
      state: { words: 12, path: "recovery phrase" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "password",
      label: "Create vault passphrase",
      narrative:
        "Local encryption is a dedicated step with confirmation and live requirement status.",
      prepare: preparePassword,
      state: { accountWritten: false, credential: "local vault passphrase" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "recovery-accounts",
      label: "Review discovered accounts",
      narrative:
        "Both supported account contracts are searched together; deployed and funded accounts are selected automatically.",
      prepare: prepareRecoveryAccounts(false),
      state: { accountContracts: 2, discovered: 2, scan: "complete" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "recovery-accounts-confirmed",
      label: "Confirm recovered accounts",
      narrative:
        "The user confirms the exact discovered set before one atomic encrypted-vault restoration.",
      prepare: prepareRecoveryAccounts(true),
      state: { mainnetAcknowledged: true, selected: 2 },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "account-contract-openzeppelin",
      label: "Choose OpenZeppelin account",
      narrative: "New-wallet setup recommends OpenZeppelin while keeping Argent available.",
      prepare: prepareSoftwareContract("openzeppelin"),
      state: { accountContract: "openzeppelin", recommended: true },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "account-contract-argent",
      label: "Choose Argent account",
      narrative: "Argent remains an equally supported account-contract choice before derivation.",
      prepare: prepareSoftwareContract("argent"),
      state: { accountContract: "argent", recommended: false },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "accounts",
      label: "Review OpenZeppelin account",
      narrative:
        "The recommended OpenZeppelin public account is derived without writing a vault and awaits selection.",
      prepare: prepareAccountSelection("openzeppelin", false),
      state: {
        accountContract: "openzeppelin",
        persisted: false,
        selected: 0,
        visibleAccounts: 1,
      },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "accounts-argent",
      label: "Review Argent account",
      narrative: "The Argent account derives a distinct public address before persistence.",
      prepare: prepareAccountSelection("argent", false),
      state: {
        accountContract: "argent",
        persisted: false,
        selected: 0,
        visibleAccounts: 1,
      },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "account-selected",
      label: "Account selected",
      narrative: "Selection and real-funds acknowledgement visibly activate the final action.",
      prepare: prepareAccountSelection("openzeppelin", true),
      state: { mainnetAcknowledged: true, selected: 1 },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "generated-masked",
      label: "Generated phrase masked",
      narrative: "New recovery words stay blurred until the user deliberately asks to reveal them.",
      prepare: prepareGenerated(false, false),
      state: { phrase: "masked fixture", verification: "required" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "backup-confirmed",
      label: "Confirm generated backup",
      narrative:
        "Requested fixture words prove the offline backup before password setup can continue.",
      prepare: prepareGenerated(true, true),
      state: { phrase: "visible fixture", verification: "passed" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "ledger-contract-openzeppelin",
      label: "Choose OpenZeppelin Ledger account",
      narrative: "The recommended account contract is chosen separately from Ledger key custody.",
      prepare: (context) => prepareLedgerContract(context, "openzeppelin"),
      state: { accountContract: "openzeppelin", hardware: "Ledger" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "ledger-contract-argent",
      label: "Choose Argent Ledger account",
      narrative: "Argent remains available without changing the Ledger key boundary.",
      prepare: (context) => prepareLedgerContract(context, "argent"),
      state: { accountContract: "argent", hardware: "Ledger" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "ledger-password",
      label: "Protect the Ledger registry",
      narrative:
        "Ledger setup receives a local vault passphrase without generating recovery words.",
      prepare: prepareLedger,
      state: { hardware: "Ledger", mnemonicGenerated: false },
    },
    {
      content: onboardingComplete,
      id: "complete",
      label: "Setup complete",
      narrative: "A clear handoff confirms local encryption and opens the wallet side panel.",
      state: { handoff: "side panel", persisted: true },
    },
  ],
  description:
    "Full-screen setup from path selection through credentials, account selection, Ledger, and completion.",
  id: "onboarding",
  surface: "fullpage",
  title: "Full-screen onboarding",
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
      content: () => addAccountChooser(),
      id: "method",
      label: "Choose account method",
      narrative:
        "Standard, Ledger, private-key, and shared accounts remain explicit signer models.",
      state: { choices: 4, secretBoundary: "visible", selected: null },
    },
    {
      content: () => addAccountChooser("multisig"),
      id: "method-multisig",
      label: "Choose Multisig account",
      narrative:
        "Selection is visible before Continue routes into create or add-existing shared accounts.",
      state: { choices: 4, selected: "multisig" },
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
    "Unified account-type choice, Ledger device selection, enumeration, account selection, partial recovery, and errors.",
  id: "ledger-onboarding",
  surface: "sidepanel",
  title: "Ledger account onboarding",
};
