/**
 * Quantum-safe Bitcoin checkpoints: the accounts list in every row state,
 * creation going straight into the backup, each backup step (passphrase,
 * masked and shown phrase, the three-word check, a mismatch, done), and the
 * phrase import with its refusal and result. Production templates and
 * bindings run against a fixture client; the phrase is the public BIP39
 * all-zero test vector, never a real one.
 */

import { QSB_ACCOUNT_REFUSALS, type QsbAccountView } from "@bramble/wallet-model/qsb";
import { createQsbJourney } from "@bramble/wallet-ui/lab";
import { walletDashboard } from "../runtime/scenario-dashboard";
import { nextTurn, updateForm } from "../runtime/scenario-runtime";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "../runtime/types";

type QsbWallet = Parameters<typeof createQsbJourney>[0]["wallet"];

const TEST_PHRASE = `${"abandon ".repeat(23)}art`;
// A fixed clock reading, so the check asks the same three words every run.
const CLOCK = 1_730_000_000_123;

const accounts: readonly QsbAccountView[] = [
  {
    backupConfirmed: false,
    id: "qsb-1",
    journal: "bound",
    provenance: "generated-here",
    writer: false,
  },
  {
    backupConfirmed: true,
    id: "qsb-2",
    journal: "bound",
    provenance: "generated-here",
    writer: true,
  },
  { backupConfirmed: true, id: "qsb-3", journal: "bound", provenance: "imported", writer: false },
  {
    backupConfirmed: true,
    id: "qsb-4",
    journal: "unavailable",
    provenance: "generated-here",
    writer: false,
  },
];

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

type Fixture = {
  readonly confirm?: () => Promise<QsbAccountView>;
  readonly create?: () => Promise<QsbAccountView>;
  readonly import?: () => Promise<QsbAccountView>;
  readonly list?: readonly QsbAccountView[];
};

// The vault calls belong to the account screen (scenarios-qsb-vaults); these
// checkpoints never reach them.
const fixtureWallet = (fixture: Fixture): QsbWallet => ({
  confirmQsbBackup: fixture.confirm ?? never,
  createQsbAccount: fixture.create ?? never,
  createQsbVault: never,
  depositQsbVault: never,
  importQsbAccount: fixture.import ?? never,
  loadQsbAccounts: async () => fixture.list ?? accounts,
  loadQsbVaults: never,
  quoteQsbDeposit: never,
  resendQsbDeposit: never,
  revealQsbPhrase: async () => TEST_PHRASE,
});

const journeyFor = (context: FrameContext, fixture: Fixture) =>
  createQsbJourney({
    back: () => context.emit({ detail: "back", kind: "action" }),
    navigate: (view) => context.emit({ detail: `navigate ${view}`, kind: "action" }),
    now: () => CLOCK,
    // These screens never reach the coordinator.
    permissions: null,
    wallet: fixtureWallet(fixture),
  });

const click = (context: FrameContext, selector: string): void => {
  const control = context.app.querySelector<HTMLButtonElement>(selector);
  if (!control) throw new Error(`Missing QSB control ${selector}`);
  control.click();
};

const submit = (context: FrameContext, selector: string): void => {
  const form = context.app.querySelector<HTMLFormElement>(selector);
  const view = context.document.defaultView;
  if (!form || !view) throw new Error(`Missing QSB form ${selector}`);
  form.dispatchEvent(new view.Event("submit", { bubbles: true, cancelable: true }));
};

type BackupStage = "done" | "mismatch" | "passphrase" | "phrase" | "shown" | "verify";

// Drives the production backup binding to `stage`, as a reader would.
const backupTo = async (context: FrameContext, stage: BackupStage): Promise<void> => {
  const journey = journeyFor(context, {
    confirm:
      stage === "mismatch"
        ? () => Promise.reject(new Error(QSB_ACCOUNT_REFUSALS.backupMismatch))
        : async () => ({ ...(accounts[0] as QsbAccountView), backupConfirmed: true, writer: true }),
  });
  journey.openBackup("qsb-1");
  journey.bind(context.app);
  if (stage === "passphrase") return;
  updateForm(context, 'input[name="vaultPassphrase"]', "fixture passphrase");
  submit(context, "#qsb-reveal-form");
  await nextTurn();
  if (stage === "phrase") return;
  click(context, "#phrase-toggle");
  if (stage === "shown") return;
  click(context, "#generated-continue");
  if (stage === "verify") return;
  const words = TEST_PHRASE.split(" ");
  const inputs = context.app.querySelectorAll<HTMLInputElement>('input[name^="qsb-verify-"]');
  inputs.forEach((input, index) => {
    const position = Number(input.closest("label")?.textContent?.replace(/\D/g, "") ?? "1");
    const word = stage === "mismatch" ? "zoo" : (words[position - 1] ?? "");
    updateForm(context, `input[name="qsb-verify-${index}"]`, word);
  });
  submit(context, "#qsb-verify-form");
  await nextTurn();
};

const importTo = async (context: FrameContext, stage: "entry" | "refused" | "done") => {
  const journey = journeyFor(context, {
    import:
      stage === "refused"
        ? () => Promise.reject(new Error(QSB_ACCOUNT_REFUSALS.notDedicated))
        : async () => accounts[2] as QsbAccountView,
  });
  journey.bind(context.app);
  if (stage === "entry") return;
  updateForm(context, 'input[data-recovery-kind="import"]', TEST_PHRASE);
  submit(context, "#qsb-import-form");
  await nextTurn();
};

const backupCheckpoint = (
  stage: BackupStage,
  label: string,
  narrative: string,
  state: Readonly<Record<string, unknown>>,
): ScenarioCheckpoint => ({
  content: () => walletDashboard({ view: "qsb-backup" }),
  id: `qsb-backup-${stage}`,
  label,
  narrative,
  prepare: (context) => backupTo(context, stage),
  state,
});

/** The Quantum-safe Bitcoin family: list, create, backup, and import. */
export const qsbScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => walletDashboard({ view: "qsb-accounts" }),
      id: "qsb-accounts",
      label: "Accounts",
      narrative:
        "Each account states what it can do now: a phrase to back up, ready, read-only, or a history Bramble cannot read. Every row opens its account; only the missing backup also carries Back up.",
      prepare: async (context) => {
        journeyFor(context, {}).bind(context.app);
        await nextTurn();
      },
      state: { accounts: 4, actions: "back up" },
    },
    {
      content: () => walletDashboard({ view: "qsb-accounts" }),
      id: "qsb-accounts-empty",
      label: "No accounts",
      narrative: "An empty list opens with what is absent; create and import sit above it.",
      prepare: async (context) => {
        journeyFor(context, { list: [] }).bind(context.app);
        await nextTurn();
      },
      state: { accounts: 0 },
    },
    {
      content: () => walletDashboard({ view: "qsb-backup" }),
      id: "qsb-create",
      label: "Creating",
      narrative:
        "The add-account tile creates the account and opens its backup at once; the screen holds while the background generates the phrase.",
      prepare: (context) => {
        const journey = journeyFor(context, {});
        journey.open("create");
        journey.bind(context.app);
      },
      state: { creation: "in flight", phrase: "never shown here" },
    },
    {
      content: () => walletDashboard({ view: "qsb-backup" }),
      id: "qsb-create-refused",
      label: "Creation refused",
      narrative:
        "A refused creation says why in reviewed copy and points to the list rather than inviting a blind retry.",
      prepare: async (context) => {
        const journey = journeyFor(context, {
          create: () => Promise.reject(new Error(QSB_ACCOUNT_REFUSALS.accountLimit)),
        });
        journey.open("create");
        journey.bind(context.app);
        await nextTurn();
      },
      state: { refusal: "account limit" },
    },
    backupCheckpoint(
      "passphrase",
      "Backup · passphrase",
      "The vault passphrase is entered every time; an unlocked session is not enough.",
      { reauthentication: true },
    ),
    backupCheckpoint(
      "phrase",
      "Backup · phrase masked",
      "The 24 words arrive masked, out of the accessibility tree, beside the consequence; copy and continue wait for a deliberate Show.",
      { masked: true, words: 24 },
    ),
    backupCheckpoint(
      "shown",
      "Backup · phrase shown",
      "Shown on request, with the guarded copy and its clipboard warning.",
      { copy: "guarded", masked: false },
    ),
    backupCheckpoint(
      "verify",
      "Backup · check words",
      "The phrase is wiped from the screen; three words at clock-chosen positions are retyped for the background to check.",
      { phraseOnScreen: false, words: 3 },
    ),
    backupCheckpoint(
      "mismatch",
      "Backup · mismatch",
      "A wrong word keeps the answers to correct and shows the background's verdict in reviewed copy.",
      { verdict: "mismatch" },
    ),
    backupCheckpoint(
      "done",
      "Backup · confirmed",
      "Every field is empty once the backup is confirmed.",
      {
        fieldsWiped: true,
      },
    ),
    {
      content: () => walletDashboard({ view: "qsb-import" }),
      id: "qsb-import",
      label: "Import · entry",
      narrative:
        "All 24 cells with the shared word assist; the read-only consequence is stated before the reader commits.",
      prepare: (context) => importTo(context, "entry"),
      state: { readOnly: true, words: 24 },
    },
    {
      content: () => walletDashboard({ view: "qsb-import" }),
      id: "qsb-import-refused",
      label: "Import · Starknet phrase",
      narrative:
        "A Starknet recovery phrase is refused; the words stay so the reader can check them.",
      prepare: (context) => importTo(context, "refused"),
      state: { refusal: "not dedicated" },
    },
    {
      content: () => walletDashboard({ view: "qsb-import" }),
      id: "qsb-import-done",
      label: "Import · added",
      narrative: "The cells are emptied and the new row is named.",
      prepare: (context) => importTo(context, "done"),
      state: { fieldsWiped: true },
    },
  ],
  description:
    "Quantum-safe Bitcoin accounts: the list, creation into backup, the three-word check, and read-only phrase import.",
  id: "qsb",
  surface: "sidepanel",
  title: "Quantum-safe Bitcoin",
  views: ["qsb-accounts", "qsb-backup", "qsb-import"],
};
