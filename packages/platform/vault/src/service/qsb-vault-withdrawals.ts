/**
 * The withdrawal half of the vault service's QSB vault session: the account's
 * withdrawal record (intent, adopted withdrawal, signed bytes, outcome), the
 * helper signature, and the one release of HORS preimages.
 *
 * Trust boundary: background-only. The release is the only code that calls
 * Krusty's `revealQsbPreimages`, and it does so in the same queue slot that,
 * first, re-reads the bound journal, refuses a request whose custody does not
 * match the account, computes the disclosure digest `D` with Krusty from the
 * parsed `T`, refuses unless it is the digest the user reviewed, records the
 * disclosure through the journal's own transition and has that write
 * complete. Two transitions, chosen by the account and never by the caller
 * alone:
 *
 * - the writer (custody conformance): `recordQsbExposure`, from `allocated`
 *   or an exact retry, so the record is durably `exposed` first;
 * - a read-only account (the emergency path, outside custody conformance):
 *   `recordQsbEmergencyExposure`, which attaches the disclosure to the
 *   `unknown` record and leaves it `unknown`, never relabelling the
 *   uncertainty, or accepts an exact retry.
 *
 * Nothing is released before that disclosure is durable, and two releases can
 * never interleave: every slot runs alone in the service's mutation queue. A
 * refusal anywhere before the reveal releases nothing. The phrase is read
 * inside the slot and dropped; only the 15 preimages leave, to the caller that
 * asked. Signing the helper and keeping signed bytes follow one rule
 * ({@link releasedRecord}): only once that release is recorded.
 */
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import type { KmsPort } from "../kms-port";
import { type QsbJournalRefusal, recordQsbExposure } from "../qsb/qsb-journal";
import { recordQsbEmergencyExposure } from "../qsb/qsb-journal-emergency";
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

// The account's bound journal, or the refusal that stops a withdrawal.
const boundIn = async (slot: QsbSlot): Promise<Bound> => {
  const binding = await qsbSlotBinding(slot);
  if (binding.status !== "bound") throw refused(QSB_ACCOUNT_REFUSALS.journalUnavailable);
  return binding;
};

// The bound journal of the writer, or the refusal that stops a withdrawal.
const writerBinding = async (slot: QsbSlot): Promise<Bound> => {
  const binding = await boundIn(slot);
  if (!isQsbWriter(binding)) throw refused(QSB_VAULT_REFUSALS.notWriter);
  return binding;
};

const vaultIn = (binding: Bound, v: number): QsbVaultRecord => {
  const vault = binding.journal.vaults.find((record) => record.v === v);
  if (!vault) throw refused(QSB_VAULT_REFUSALS.unknownVault);
  return vault;
};

/**
 * Vault `v`'s record once its release is recorded under the account's
 * custody, the one rule for every step after a disclosure that acts with the
 * owner key or keeps what it produced: for the writer, `exposed`; for a
 * read-only account, `unknown` with this install's emergency disclosure.
 * Anything else refuses: a writer's record not yet exposed is `notReady`, a
 * read-only account's record without that disclosure `notWriter`.
 */
const releasedRecord = async (slot: QsbSlot, v: number): Promise<QsbVaultRecord> => {
  const binding = await boundIn(slot);
  const vault = vaultIn(binding, v);
  if (isQsbWriter(binding)) {
    if (vault.state !== "exposed") throw refused(QSB_WITHDRAWAL_REFUSALS.notReady);
    return vault;
  }
  if (vault.state !== "unknown" || vault.disclosure === null) {
    throw refused(QSB_VAULT_REFUSALS.notWriter);
  }
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

// A read-only account's recovered withdrawal: kept once, never replaced.
const adoptIn = async (slot: QsbSlot, adopted: QsbWithdrawalRecord): Promise<void> => {
  const binding = await boundIn(slot);
  if (isQsbWriter(binding)) throw refused(QSB_VAULT_REFUSALS.recoveryNotNeeded);
  const vault = vaultIn(binding, adopted.v);
  if (
    vault.state !== "unknown" ||
    vault.disclosure !== null ||
    vault.funding === null ||
    vault.scriptPubKey === null ||
    !adopted.jobCreated ||
    adopted.outcome !== null ||
    adopted.signed !== null
  ) {
    throw refused(QSB_WITHDRAWAL_REFUSALS.notWithdrawable);
  }
  const held = await heldIn(slot);
  const kept = held.find((entry) => entry.v === adopted.v);
  if (kept) {
    if (!sameIntent(kept, adopted)) throw refused(QSB_WITHDRAWAL_REFUSALS.notWithdrawable);
    return;
  }
  const helper = `${adopted.helper.txid}:${adopted.helper.vout}`;
  if (held.some((entry) => `${entry.helper.txid}:${entry.helper.vout}` === helper)) {
    throw refused(QSB_WITHDRAWAL_REFUSALS.helperNeeded);
  }
  await writeHeld(slot, [...held, adopted]);
};

const keepSignedIn = async (
  slot: QsbSlot,
  v: number,
  signed: QsbWithdrawalRecord["signed"],
): Promise<void> => {
  await releasedRecord(slot, v);
  if (signed === null) throw refused(QSB_WITHDRAWAL_REFUSALS.notReady);
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

// The bound journal a release may record on: the writer's for a conformant
// release, a read-only account's for an emergency one, refused otherwise
// before anything is computed or recorded.
const custodyBinding = async (slot: QsbSlot, emergency: boolean): Promise<Bound> => {
  const binding = await boundIn(slot);
  const writer = isQsbWriter(binding);
  if (!writer && !emergency) throw refused(QSB_VAULT_REFUSALS.notWriter);
  if (writer && emergency) throw refused(QSB_WITHDRAWAL_REFUSALS.custodyChanged);
  return binding;
};

const releaseIn = async (
  kms: Kms,
  slot: QsbSlot,
  request: QsbReleaseRequest,
): Promise<readonly string[]> => {
  const binding = await custodyBinding(slot, request.emergency);
  const vault = vaultIn(binding, request.v);
  const { digest } = await kms.qsbRevealDigest(request.transaction, request.round0, request.round1);
  if (digest !== request.digest) throw refused(QSB_WITHDRAWAL_REFUSALS.reviewChanged);
  const disclosure = {
    digest,
    round0: [...request.round0],
    round1: [...request.round1],
    transaction: request.transaction,
  };
  const result = request.emergency
    ? recordQsbEmergencyExposure(binding, request.v, disclosure)
    : recordQsbExposure(binding, { ...vault, disclosure, state: "exposed" });
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
  // The disclosure is durable: only now may a preimage leave.
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
  adoptWithdrawal: (record) => inSlot((slot) => adoptIn(slot, record)),
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
  signWithdrawal: (v, psbt) =>
    inSlot(async (slot) => {
      await releasedRecord(slot, v);
      const key = await kms.deriveBitcoinP2wpkhKeypair(slot.account.mnemonic, 0, 0, 0);
      return kms.signBitcoinPsbtInputs(key.privateKey, psbt, [0]);
    }),
  withdrawals: () =>
    inSlot(async (slot) => {
      const read = await readQsbWithdrawals(slot.withdrawals, slot.account, slot.vaultPassphrase);
      return read.status === "bound" ? read.withdrawals : null;
    }),
});
