/**
 * One slot of a QSB vault session, split from ./qsb-vault-access so the
 * deposit and withdrawal methods share it: the account as stored at that
 * moment, refused unless it is still the account the session was opened over
 * (same id, same journal id), with its journal, pending-deposit and
 * withdrawal stores. Background-only; the account record never leaves the
 * vault service.
 */
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import type { EncryptedStore } from "../encrypted-store";
import type { QsbAccountRecord } from "../qsb/qsb-account";
import { bindQsbJournal, type QsbJournalBinding } from "../qsb/qsb-journal-record";
import { readQsbJournal } from "../qsb/qsb-journal-store";
import type { Vault } from "../schema/schema";
import type { QsbAccountWiring } from "./qsb-account-types";

/** What one slot runs with: the account as stored now and its three stores. */
export type QsbSlot = {
  readonly account: QsbAccountRecord;
  readonly deposits: EncryptedStore;
  readonly journal: EncryptedStore;
  readonly vaultPassphrase: string;
  readonly withdrawals: EncryptedStore;
};

/** A refusal that wrote nothing, with one of the contract's diagnostics. */
export const qsbSlotRefusal = (message: string): RefusedBeforeWrite =>
  new RefusedBeforeWrite(message);

/**
 * The account as stored now, refused unless it is still the one opened over:
 * same id, same journal id, and all three of its stores wired.
 */
export const currentQsbSlot = async (
  deps: {
    readonly readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>;
    readonly wiring: QsbAccountWiring | undefined;
  },
  opened: Pick<QsbAccountRecord, "id" | "journalId">,
  vaultPassphrase: string,
): Promise<QsbSlot> => {
  const vault = await deps.readVaultSnapshot(vaultPassphrase);
  const account = vault.qsbAccounts.find((held) => held.id === opened.id);
  if (!account) throw qsbSlotRefusal(QSB_ACCOUNT_REFUSALS.unknownAccount);
  const journal = deps.wiring?.journals.forJournal(account.journalId);
  const deposits = deps.wiring?.journals.forDeposits(account.journalId);
  const withdrawals = deps.wiring?.journals.forWithdrawals(account.journalId);
  if (account.journalId !== opened.journalId || !journal || !deposits || !withdrawals) {
    throw qsbSlotRefusal(QSB_ACCOUNT_REFUSALS.journalUnavailable);
  }
  return { account, deposits, journal, vaultPassphrase, withdrawals };
};

/** The slot's journal, read and bound to its account now. */
export const qsbSlotBinding = async (slot: QsbSlot): Promise<QsbJournalBinding> =>
  bindQsbJournal(slot.account, await readQsbJournal(slot.journal, slot.vaultPassphrase));
