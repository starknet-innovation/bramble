/**
 * QSB vault checkpoints: one QSB vault's owner address, balance and deposits
 * in every row state, the service out of reach, the QSB vaults that cannot
 * take new deposits, a resend, and New deposit from its confirm step through
 * creating to the new deposit or a refusal. Production templates and bindings
 * run against a fixture client with inert timers.
 */

import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { createQsbJourney } from "@bramble/wallet-ui/lab";
import {
  deposited,
  EVERY_VAULT,
  labPermissions,
  labReading,
  labTimers,
  outcome,
  QSB_LAB_ACCOUNTS,
  type QsbLabScript,
  qsbLabWallet,
  unfunded,
  ungrantedReading,
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
    permissions: labPermissions(context, script),
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

/** The QSB vault family: address, balance, deposits, Resend and New deposit. */
export const qsbVaultsScenario: WalletScenario = {
  checkpoints: [
    accountCheckpoint(
      "qsb-account",
      "QSB vault · every deposit state",
      "The owner address with its copy and one line on what to do with it, the confirmed balance, and one row per deposit: Unfunded (Fund), Waiting to send (Resend), Sent and Funded (each linked to mempool.space), Withdrawn, and Unavailable.",
      { actions: "deposit, resend, new vault", vaults: 6 },
      {},
    ),
    accountCheckpoint(
      "qsb-account-empty",
      "QSB vault · no deposits",
      "A QSB vault with funds and no deposits yet: the empty line and New deposit.",
      { vaults: 0 },
      { reading: async () => labReading([]) },
    ),
    accountCheckpoint(
      "qsb-account-offline",
      "QSB vault · service out of reach",
      "The QSB service could not be reached: the balance gives way to one line and Try again; the address and deposits still show.",
      { funds: null },
      { reading: async () => ({ ...labReading(EVERY_VAULT.slice(0, 3)), funds: null }) },
    ),
    accountCheckpoint(
      "qsb-account-access",
      "QSB vault · access not granted",
      "Until the QSB service's origin is granted, one line and Allow access stand where the balance would be; the address and deposits still show, and New deposit, Fund and Resend ask for the grant in their own click.",
      { access: "not granted", funds: null },
      {
        access: { answer: false, granted: false },
        reading: async () => ungrantedReading(EVERY_VAULT.slice(0, 3)),
      },
    ),
    accountCheckpoint(
      "qsb-account-access-denied",
      "QSB vault · access denied",
      "Create deposit asked for the grant in its click and the browser was told no: nothing was sent, and the line says why.",
      { access: "denied", sent: "nothing" },
      {
        access: { answer: false, granted: false },
        create: async () => unfunded(3),
        reading: async () => ungrantedReading(EVERY_VAULT.slice(0, 3)),
      },
      createVault,
    ),
    accountCheckpoint(
      "qsb-account-error",
      "QSB vault · read failed",
      "A refused first read shows its reviewed line and Try again in place of the QSB vault.",
      { refusal: "runtime unavailable" },
      { reading: () => Promise.reject(new Error(QSB_VAULT_REFUSALS.runtimeUnavailable)) },
    ),
    accountCheckpoint(
      "qsb-account-read-only",
      "QSB vault · imported phrase",
      "A read-only QSB vault keeps its address, balance and deposits, with one line instead of New deposit and no Fund.",
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
      "QSB vault · backup needed",
      "A phrase not yet backed up cannot take new deposits; the line says what unlocks it.",
      { writer: false },
      { accounts: [QSB_LAB_ACCOUNTS.backupNeeded], reading: async () => labReading([]) },
      undefined,
      QSB_LAB_ACCOUNTS.backupNeeded.id,
    ),
    accountCheckpoint(
      "qsb-account-resent",
      "QSB vault · resent",
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
      "New deposit · confirm",
      "One confirm step states what a new deposit is before the background signs in and registers it.",
      { step: "confirm" },
      { reading: async () => labReading([deposited(0, "confirmed")]) },
      openNewVault,
    ),
    accountCheckpoint(
      "qsb-vault-creating",
      "New deposit · creating",
      "Sign-in and registration take a few seconds; a second tap, a repaint or coming back only reattaches to this one creation.",
      { creation: "in flight" },
      { reading: async () => labReading([deposited(0, "confirmed")]) },
      createVault,
    ),
    accountCheckpoint(
      "qsb-vault-created",
      "New deposit · created",
      "Back on the QSB vault with the new deposit, unfunded and ready to be funded once.",
      { created: "Vault 2" },
      {
        create: async () => unfunded(1),
        reading: async () => labReading([deposited(0, "confirmed")]),
      },
      createVault,
    ),
    accountCheckpoint(
      "qsb-vault-refused",
      "New deposit · refused",
      "A refused creation lands back on the QSB vault with its reviewed line.",
      { refusal: "vault limit" },
      {
        create: () => Promise.reject(new Error(QSB_VAULT_REFUSALS.vaultLimit)),
        reading: async () => labReading([deposited(0, "confirmed")]),
      },
      createVault,
    ),
  ],
  description: "One QSB vault: its owner address, balance and deposits, Resend, and New deposit.",
  id: "qsb-vaults",
  surface: "sidepanel",
  title: "QSB vault",
  views: ["qsb-account"],
};
