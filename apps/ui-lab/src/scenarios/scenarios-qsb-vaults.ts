/**
 * Quantum-safe Bitcoin account checkpoints: one account's owner address,
 * balance and vaults in every row state, the service out of reach, the
 * accounts that cannot make vaults, a resend, and New vault from its confirm
 * step through creating to the new vault or a refusal. Production templates
 * and bindings run against a fixture client with inert timers.
 */

import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { createQsbJourney } from "@bramble/wallet-ui/lab";
import {
  deposited,
  EVERY_VAULT,
  labReading,
  labTimers,
  outcome,
  QSB_LAB_ACCOUNTS,
  type QsbLabScript,
  qsbLabWallet,
  unfunded,
} from "../fixtures/qsb-vault-fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import { nextTurn } from "../runtime/scenario-runtime";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "../runtime/types";

/** The journey over `script`, wired to the lab's event log. */
export const qsbLabJourney = (context: FrameContext, script: QsbLabScript) =>
  createQsbJourney({
    back: () => context.emit({ detail: "back", kind: "action" }),
    navigate: (view) => context.emit({ detail: `navigate ${view}`, kind: "action" }),
    now: null,
    timers: labTimers(context),
    wallet: qsbLabWallet(script),
  });

/** Clicks the control `selector` matches, as a reader would. */
export const clickQsb = (context: FrameContext, selector: string): void => {
  const control = context.app.querySelector<HTMLButtonElement>(selector);
  if (!control) throw new Error(`Missing QSB control ${selector}`);
  control.click();
};

// Opens `accountId`'s screen over `script`, then lets `act` drive it.
const accountCheckpoint = (
  id: string,
  label: string,
  narrative: string,
  state: Readonly<Record<string, unknown>>,
  script: QsbLabScript,
  act?: (context: FrameContext) => Promise<void> | void,
  accountId: string = QSB_LAB_ACCOUNTS.ready.id,
): ScenarioCheckpoint => ({
  content: () => walletDashboard({ view: "qsb-account" }),
  id,
  label,
  narrative,
  prepare: async (context) => {
    const journey = qsbLabJourney(context, script);
    journey.openAccount(accountId);
    journey.bind(context.app);
    await nextTurn();
    await act?.(context);
    await nextTurn();
  },
  state,
});

const openNewVault = (context: FrameContext): void => clickQsb(context, "#qsb-vault-new");
const createVault = (context: FrameContext): void => {
  openNewVault(context);
  clickQsb(context, "#qsb-vault-create");
};

/** The account family: address, balance, vaults, Resend and New vault. */
export const qsbVaultsScenario: WalletScenario = {
  checkpoints: [
    accountCheckpoint(
      "qsb-account",
      "Account · every vault state",
      "The owner address with its copy and one line on what to do with it, the confirmed balance, and one row per vault: Unfunded (Deposit), Deposit waiting (Resend), Deposit sent and Funded (each linked to mempool.space), Withdrawn, and Unavailable.",
      { actions: "deposit, resend, new vault", vaults: 6 },
      {},
    ),
    accountCheckpoint(
      "qsb-account-empty",
      "Account · no vaults",
      "An account with funds and no vaults yet: the empty line and New vault.",
      { vaults: 0 },
      { reading: async () => labReading([]) },
    ),
    accountCheckpoint(
      "qsb-account-offline",
      "Account · service out of reach",
      "The coordinator could not be reached: the balance gives way to one line and Try again; the address and vaults still show.",
      { funds: null },
      { reading: async () => ({ ...labReading(EVERY_VAULT.slice(0, 3)), funds: null }) },
    ),
    accountCheckpoint(
      "qsb-account-error",
      "Account · read failed",
      "A refused first read shows its reviewed line and Try again in place of the account.",
      { refusal: "runtime unavailable" },
      { reading: () => Promise.reject(new Error(QSB_VAULT_REFUSALS.runtimeUnavailable)) },
    ),
    accountCheckpoint(
      "qsb-account-read-only",
      "Account · imported phrase",
      "A read-only account keeps its address, balance and vaults, with one line instead of New vault and no Deposit.",
      { writer: false },
      {
        accounts: [QSB_LAB_ACCOUNTS.readOnly],
        reading: async () => labReading([unfunded(0), deposited(1, "confirmed")]),
      },
      undefined,
      QSB_LAB_ACCOUNTS.readOnly.id,
    ),
    accountCheckpoint(
      "qsb-account-backup-needed",
      "Account · backup needed",
      "A phrase not yet backed up cannot make vaults; the line says what unlocks it.",
      { writer: false },
      { accounts: [QSB_LAB_ACCOUNTS.backupNeeded], reading: async () => labReading([]) },
      undefined,
      QSB_LAB_ACCOUNTS.backupNeeded.id,
    ),
    accountCheckpoint(
      "qsb-account-resent",
      "Account · resent",
      "Resend on a waiting deposit sends its same signed bytes once; the row and one status line report the outcome.",
      { submission: "submitted" },
      {
        reading: async () => labReading([deposited(0, "pending")]),
        resend: async () => outcome(0, "submitted"),
      },
      (context) => clickQsb(context, '[data-qsb-resend="0"]'),
    ),
    accountCheckpoint(
      "qsb-vault-confirm",
      "New vault · confirm",
      "One confirm step states what a new vault is before the background signs in and registers it.",
      { step: "confirm" },
      { reading: async () => labReading([deposited(0, "confirmed")]) },
      openNewVault,
    ),
    accountCheckpoint(
      "qsb-vault-creating",
      "New vault · creating",
      "Sign-in and registration take a few seconds; a second tap, a repaint or coming back only reattaches to this one creation.",
      { creation: "in flight" },
      { reading: async () => labReading([deposited(0, "confirmed")]) },
      createVault,
    ),
    accountCheckpoint(
      "qsb-vault-created",
      "New vault · created",
      "Back on the account with the new vault, unfunded and ready for its one deposit.",
      { created: "Vault 2" },
      {
        create: async () => unfunded(1),
        reading: async () => labReading([deposited(0, "confirmed")]),
      },
      createVault,
    ),
    accountCheckpoint(
      "qsb-vault-refused",
      "New vault · refused",
      "A refused creation lands back on the account with its reviewed line.",
      { refusal: "vault limit" },
      {
        create: () => Promise.reject(new Error(QSB_VAULT_REFUSALS.vaultLimit)),
        reading: async () => labReading([deposited(0, "confirmed")]),
      },
      createVault,
    ),
  ],
  description:
    "One quantum-safe Bitcoin account: its owner address, balance and vaults, Resend, and New vault.",
  id: "qsb-vaults",
  surface: "sidepanel",
  title: "Quantum-safe Bitcoin account",
  views: ["qsb-account"],
};
