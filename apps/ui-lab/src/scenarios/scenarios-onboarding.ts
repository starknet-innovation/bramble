import { ledgerMessage } from "@bramble/ledger-protocol/errors";
import { isAccountContractType, type LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import {
  addAccountChooser,
  bindOnboarding,
  createSidepanelRuntime,
  DEFAULT_BACKUP_VERIFY_POSITIONS,
  importAccountChooser,
  ledgerAccountPicker,
  ledgerConnectPrompt,
  ledgerDevicePicker,
  ledgerOnboardError,
  ledgerReadingPrompt,
  onboarding,
  onboardingComplete,
} from "@bramble/wallet-ui/lab";
import { argentSoftwareAccount, ledgerAccount, softwareAccount } from "../fixtures/fixtures";
import { emptyWalletStatus } from "../fixtures/journey-fixtures";
import { messageType, nextTurn, updateForm } from "../runtime/scenario-runtime";
import type { FrameContext, WalletScenario } from "../runtime/types";

const FIXTURE_WORDS =
  "habit hope tip crystal because grunt nation idea electric witness alert like";
const FIXTURE_PASSPHRASE = "fixture vault passphrase";
// The lab binds onboarding without a clock, so the confirmation asks for the
// default positions; reading the answers back out of the fixture keeps these
// checkpoints correct if those positions ever change.
const FIXTURE_VERIFY_ANSWERS = DEFAULT_BACKUP_VERIFY_POSITIONS.map(
  (position) => FIXTURE_WORDS.split(" ")[position - 1] ?? "",
);

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

const prepareImportKey = (context: FrameContext): void => {
  prepareMethod(context);
  press(context, "#key-method-button");
};

const prepareRecoveryAccounts = async (context: FrameContext): Promise<void> => {
  await preparePassword(context);
  updateForm(context, 'input[name="vaultPassphrase"]', FIXTURE_PASSPHRASE);
  updateForm(context, 'input[name="vaultPassphraseConfirm"]', FIXTURE_PASSPHRASE);
  press(context, "#password-continue-button");
  await nextTurn();
};

const prepareAccountSelection =
  (selected: boolean) =>
  async (context: FrameContext): Promise<void> => {
    await prepareGenerated(true, true)(context);
    press(context, "#verify-continue");
    updateForm(context, 'input[name="vaultPassphrase"]', FIXTURE_PASSPHRASE);
    updateForm(context, 'input[name="vaultPassphraseConfirm"]', FIXTURE_PASSPHRASE);
    press(context, "#password-continue-button");
    await nextTurn();
    if (!selected) {
      return;
    }
    press(context, "#account-preview");
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
    FIXTURE_VERIFY_ANSWERS.forEach((answer, index) => {
      updateForm(context, `input[name="verify-${index}"]`, answer);
    });
  };

// Placeholder answers that cannot match the fixture, the last one committed as
// a user leaving the field would, so the step reports the mismatch.
const prepareMismatchedBackup = async (context: FrameContext): Promise<void> => {
  await prepareGenerated(true, false)(context);
  press(context, "#generated-continue");
  updateForm(context, 'input[name="verify-0"]', "one");
  updateForm(context, 'input[name="verify-1"]', "two");
  updateForm(context, 'input[name="verify-2"]', "three", true);
};

const prepareLedger = (context: FrameContext): void => {
  prepareMethod(context);
  press(context, "#ledger-method-button");
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
      narrative: "Recovery phrase, Ledger, and private key remain explicit security models.",
      prepare: prepareMethod,
      state: { choices: 3, path: "existing wallet" },
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
      prepare: prepareRecoveryAccounts,
      state: { accountContracts: 2, discovered: 2, scan: "complete" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "import-key",
      label: "Import from a private key",
      narrative:
        "The first-run key import keeps the Bramble/Ready contract choice for accounts that already exist.",
      prepare: prepareImportKey,
      state: { contractChoice: "import only", path: "private key" },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "accounts",
      label: "Review the Bramble account",
      narrative:
        "The Bramble public account is derived without writing a vault and awaits selection.",
      prepare: prepareAccountSelection(false),
      state: { persisted: false, selected: 0, visibleAccounts: 1 },
    },
    {
      content: () => onboarding(emptyWalletStatus),
      id: "account-selected",
      label: "Account selected",
      narrative: "Selecting the derived account visibly activates the final action.",
      prepare: prepareAccountSelection(true),
      state: { selected: 1 },
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
      id: "backup-mismatch",
      label: "Backup words don't match",
      narrative:
        "A committed word that does not match reads as an error to fix, not the empty-form prompt.",
      prepare: prepareMismatchedBackup,
      state: { phrase: "visible fixture", verification: "mismatch" },
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
  const funded = balance !== null && Number.parseFloat(balance) > 0;
  return { account, balance, deployed, duplicate, funded };
};

export const ledgerOnboardingScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => addAccountChooser(),
      id: "method",
      label: "Choose account method",
      narrative:
        "Standard, Ledger, shared, and import routes are explicit; one click on a tile routes immediately.",
      state: { choices: 4, secretBoundary: "visible" },
    },
    {
      content: () => importAccountChooser(),
      id: "method-import",
      label: "Import an existing account",
      narrative:
        "The import stage offers the recovery-phrase and private-key routes, each a single click.",
      state: { choices: 2 },
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
          [
            "SN_MAIN:0x7234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
            "SN_MAIN:0x8234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
          ],
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
          ["SN_MAIN:0x8234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd"],
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
