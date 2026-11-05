/**
 * The withdrawal half of the vault service's QSB vault session: the account's
 * withdrawal record (intent, signed bytes, outcome), the helper signature,
 * and the one release of HORS preimages.
 *
 * Trust boundary: background-only. The release is the only code that calls
 * Krusty's `revealQsbPreimages`, and it does so in the same queue slot that,
 * first, re-reads the bound journal, computes the disclosure digest `D` with
 * Krusty from the parsed `T`, refuses unless it is the digest the user
 * reviewed, records the exposure through the journal's own transition
 * (`recordQsbExposure`: from `allocated`, or an exact retry of the exposure
 * already recorded) and has that write complete. Nothing is released before
 * the `exposed` record is durable, and two releases can never interleave:
 * every slot runs alone in the service's mutation queue. A refusal anywhere
 * before the reveal releases nothing. The phrase is read inside the slot and
 * dropped; only the 15 preimages leave, to the caller that asked.
 */
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import type { KmsPort } from "../kms-port";
import { type QsbJournalRefusal, recordQsbExposure } from "../qsb/qsb-journal";
import { isQsbWriter, type QsbJournalBinding } from "../qsb/qsb-journal-record";
import { writeQsbJournal } from "../qsb/qsb-journal-store";
import type { QsbVaultRecord } from "../qsb/qsb-vault-record";
import {
  type QsbWithdrawalRecord,
  qsbWithdrawalsRecord,
  readQsbWithdrawals,
} from "../qsb/qsb-withdrawal-store";
import { type QsbSlot, qsbSlotBinding, qsbSlotRefusal } from "./qsb-vault-slot";
import type { QsbReleaseRequest, QsbWithdrawalAccess } from "./qsb-vault-types";

type Kms = Pick<
  KmsPort,
  "deriveBitcoinP2wpkhKeypair" | "qsbRevealDigest" | "revealQsbPreimages" | "signBitcoinPsbtInputs"
>;

type InSlot = <T>(run: (slot: QsbSlot) => Promise<T>) => Promise<T>;

type Bound = Extract<QsbJournalBinding, { readonly status: "bound" }>;

const refused = qsbSlotRefusal;

// The bound journal of the writer, or the refusal that stops a withdrawal.
const writerBinding = async (slot: QsbSlot): Promise<Bound> => {
  const binding = await qsbSlotBinding(slot);
  if (binding.status !== "bound") throw refused(QSB_ACCOUNT_REFUSALS.journalUnavailable);
  if (!isQsbWriter(binding)) throw refused(QSB_VAULT_REFUSALS.notWriter);
  return binding;
};

const vaultIn = (binding: Bound, v: number): QsbVaultRecord => {
  const vault = binding.journal.vaults.find((record) => record.v === v);
  if (!vault) throw refused(QSB_VAULT_REFUSALS.unknownVault);
  return vault;
};

const heldIn = async (slot: QsbSlot): Promise<readonly QsbWithdrawalRecord[]> => {
  const read = await readQsbWithdrawals(slot.withdrawals, slot.account, slot.vaultPassphrase);
  if (read.status !== "bound") throw refused(QSB_ACCOUNT_REFUSALS.journalUnavailable);
  return read.withdrawals;
};

const writeHeld = async (
  slot: QsbSlot,
  withdrawals: readonly QsbWithdrawalRecord[],
): Promise<void> => {
  const record = qsbWithdrawalsRecord(slot.account, withdrawals);
  if (record === null) throw refused(QSB_VAULT_REFUSALS.vaultLimit);
  await slot.withdrawals.write(record, slot.vaultPassphrase);
};

// Replaces withdrawal `v` with `change(it)`; refused when there is none.
const updateIn = async (
  slot: QsbSlot,
  v: number,
  change: (held: QsbWithdrawalRecord) => QsbWithdrawalRecord,
): Promise<void> => {
  const held = await heldIn(slot);
  const current = held.find((entry) => entry.v === v);
  if (!current) throw refused(QSB_WITHDRAWAL_REFUSALS.notReady);
  const next = change(current);
  if (next === current) return;
  await writeHeld(slot, [...held.filter((entry) => entry.v !== v), next]);
};

const sameIntent = (left: QsbWithdrawalRecord, right: QsbWithdrawalRecord): boolean =>
  left.jobId === right.jobId &&
  left.manifestHash === right.manifestHash &&
  left.manifestJson === right.manifestJson;

const holdIn = async (slot: QsbSlot, intent: QsbWithdrawalRecord): Promise<void> => {
  const vault = vaultIn(await writerBinding(slot), intent.v);
  if (vault.state !== "allocated" || vault.funding === null || vault.scriptPubKey === null) {
    throw refused(QSB_WITHDRAWAL_REFUSALS.notWithdrawable);
  }
  const held = await heldIn(slot);
  const kept = held.find((entry) => entry.v === intent.v);
  if (kept) {
    if (!sameIntent(kept, intent)) throw refused(QSB_WITHDRAWAL_REFUSALS.notWithdrawable);
    return;
  }
  const helper = `${intent.helper.txid}:${intent.helper.vout}`;
  if (held.some((entry) => `${entry.helper.txid}:${entry.helper.vout}` === helper)) {
    throw refused(QSB_WITHDRAWAL_REFUSALS.helperNeeded);
  }
  await writeHeld(slot, [...held, { ...intent, jobCreated: false, outcome: null, signed: null }]);
};

const keepSignedIn = async (
  slot: QsbSlot,
  v: number,
  signed: QsbWithdrawalRecord["signed"],
): Promise<void> => {
  if (vaultIn(await writerBinding(slot), v).state !== "exposed" || signed === null) {
    throw refused(QSB_WITHDRAWAL_REFUSALS.notReady);
  }
  await updateIn(slot, v, (held) => {
    if (held.signed === null) return { ...held, outcome: "pending", signed };
    if (held.signed.rawTxHex !== signed.rawTxHex) {
      throw refused(QSB_WITHDRAWAL_REFUSALS.bindingRefused);
    }
    return held;
  });
};

// A journal refusal as the release reports it: the exposure it would have
// recorded is not the one the journal permits.
const exposureRefusal = (refusal: QsbJournalRefusal): Error => {
  if (refusal === "journal-unavailable") return refused(QSB_ACCOUNT_REFUSALS.journalUnavailable);
  if (refusal === "not-writer") return refused(QSB_VAULT_REFUSALS.notWriter);
  if (refusal === "journal-full") return refused(QSB_VAULT_REFUSALS.vaultLimit);
  return refused(QSB_WITHDRAWAL_REFUSALS.bindingRefused);
};

const releaseIn = async (
  kms: Kms,
  slot: QsbSlot,
  request: QsbReleaseRequest,
): Promise<readonly string[]> => {
  const binding = await writerBinding(slot);
  const vault = vaultIn(binding, request.v);
  const { digest } = await kms.qsbRevealDigest(request.transaction, request.round0, request.round1);
  if (digest !== request.digest) throw refused(QSB_WITHDRAWAL_REFUSALS.reviewChanged);
  const result = recordQsbExposure(binding, {
    ...vault,
    disclosure: {
      digest,
      round0: [...request.round0],
      round1: [...request.round1],
      transaction: request.transaction,
    },
    state: "exposed",
  });
  if (!result.ok) throw exposureRefusal(result.refusal);
  if (result.journal !== binding.journal) {
    const written = await writeQsbJournal(
      slot.journal,
      slot.account,
      result.journal,
      slot.vaultPassphrase,
      "replace",
    );
    if (!written.ok)
      throw exposureRefusal(
        written.refusal === "journal-full" ? "journal-full" : "journal-unavailable",
      );
  }
  // The exposure is durable: only now may a preimage leave.
  return kms.revealQsbPreimages(slot.account.mnemonic, request.v, request.round0, request.round1);
};

/**
 * The session's withdrawal methods over Krusty and the session's slot
 * runner. `isOpen` is the session's own liveness, checked by every call.
 */
export const qsbWithdrawalMethods = (
  kms: Kms,
  inSlot: InSlot,
  isOpen: () => boolean,
): QsbWithdrawalAccess => ({
  holdWithdrawal: (intent) => inSlot((slot) => holdIn(slot, intent)),
  keepSignedWithdrawal: (v, signed) => inSlot((slot) => keepSignedIn(slot, v, signed)),
  markWithdrawalJob: (v) =>
    inSlot((slot) =>
      updateIn(slot, v, (held) => (held.jobCreated ? held : { ...held, jobCreated: true })),
    ),
  recordWithdrawalOutcome: (v, outcome) =>
    inSlot((slot) =>
      updateIn(slot, v, (held) => {
        if ((outcome === "refused") !== (held.signed === null)) {
          throw refused(QSB_WITHDRAWAL_REFUSALS.notReady);
        }
        return held.outcome === outcome ? held : { ...held, outcome };
      }),
    ),
  releasePreimages: (request) => inSlot((slot) => releaseIn(kms, slot, request)),
  revealDigest: (transaction, round0, round1) =>
    isOpen()
      ? kms.qsbRevealDigest(transaction, round0, round1)
      : Promise.reject(refused(QSB_VAULT_REFUSALS.runtimeUnavailable)),
  signWithdrawal: (psbt) =>
    inSlot(async (slot) => {
      const key = await kms.deriveBitcoinP2wpkhKeypair(slot.account.mnemonic, 0, 0, 0);
      return kms.signBitcoinPsbtInputs(key.privateKey, psbt, [0]);
    }),
  withdrawals: () =>
    inSlot(async (slot) => {
      const read = await readQsbWithdrawals(slot.withdrawals, slot.account, slot.vaultPassphrase);
      return read.status === "bound" ? read.withdrawals : null;
    }),
});
