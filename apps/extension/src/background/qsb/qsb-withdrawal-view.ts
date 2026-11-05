/**
 * One deposit's withdrawal as the panel may see it (`QsbWithdrawalView`),
 * from what is kept here and what the coordinator says.
 *
 * The terms (destination, fee, payout) always come from the intent kept
 * here, never from the coordinator. The status:
 * - no intent: `none`, every other field null;
 * - signed bytes kept here: the transaction's status when the coordinator
 *   gave one (`confirmed`, `submitted`, `uncertain`, `conflict`), else the
 *   last outcome kept, `pending` until the coordinator has answered;
 * - otherwise the job's: `queued`/`searching` → `searching`, `paused`,
 *   `failed`, `awaiting_authorization` → `ready`; a job the coordinator
 *   refused for good → `failed`; a job it never created → `none` again, so
 *   the same intent can be started once more; unknown (coordinator
 *   unreachable) → `searching` once the job was created.
 * A txid appears only once a transaction exists — the one the chain included
 * when it differs — and confirmations only beside it.
 */
import type { QsbJob, QsbWithdrawalTransactionStatus } from "@bramble/qsb/withdrawal-responses";
import type { QsbWithdrawalRecord } from "@bramble/vault/qsb-withdrawal-store";
import type {
  QsbWithdrawalStatus,
  QsbWithdrawalSubmission,
  QsbWithdrawalView,
} from "@bramble/wallet-model/qsb-withdrawals";

/** What the coordinator says about one withdrawal; null fields when unknown. */
export type QsbWithdrawalRemote = {
  readonly job: QsbJob | null;
  /** False when the coordinator could not be asked about jobs at all. */
  readonly jobsKnown: boolean;
  readonly transaction: QsbWithdrawalTransactionStatus | null;
};

/** A deposit with no withdrawal started. */
export const QSB_NO_WITHDRAWAL: QsbWithdrawalView = {
  confirmations: null,
  destination: null,
  feeSat: null,
  outputSat: null,
  status: "none",
  txid: null,
};

const JOB_STATUSES: Readonly<Record<QsbJob["status"], QsbWithdrawalStatus>> = {
  awaiting_authorization: "ready",
  confirmed: "searching",
  failed: "failed",
  paused: "paused",
  queued: "searching",
  searching: "searching",
  submitted: "searching",
};

const terms = (record: QsbWithdrawalRecord) => ({
  destination: record.destination,
  feeSat: record.feeSat,
  outputSat: record.outputSat,
});

// Before anything is signed here: the job's state, or the intent's.
const unsignedStatus = (
  record: QsbWithdrawalRecord,
  remote: QsbWithdrawalRemote,
): QsbWithdrawalStatus => {
  if (record.outcome === "refused") return "failed";
  if (remote.job) return JOB_STATUSES[remote.job.status];
  if (!remote.jobsKnown) return record.jobCreated ? "searching" : "none";
  return "none";
};

const signedView = (
  record: QsbWithdrawalRecord,
  signed: NonNullable<QsbWithdrawalRecord["signed"]>,
  status: QsbWithdrawalTransactionStatus | null,
): QsbWithdrawalView => {
  if (status && status.txid === signed.txid) {
    const confirmed = status.status === "confirmed";
    return {
      ...terms(record),
      confirmations: confirmed ? status.confirmations : null,
      status: status.status,
      txid: confirmed ? (status.includedTxid ?? signed.txid) : signed.txid,
    };
  }
  const kept = record.outcome === null || record.outcome === "refused" ? "pending" : record.outcome;
  return { ...terms(record), confirmations: null, status: kept, txid: signed.txid };
};

/** The view of withdrawal `record` (or none), given what the coordinator says. */
export const qsbWithdrawalView = (
  record: QsbWithdrawalRecord | undefined,
  remote: QsbWithdrawalRemote,
): QsbWithdrawalView => {
  if (!record) return QSB_NO_WITHDRAWAL;
  if (record.signed) return signedView(record, record.signed, remote.transaction);
  const status = unsignedStatus(record, remote);
  return status === "none"
    ? QSB_NO_WITHDRAWAL
    : { ...terms(record), confirmations: null, status, txid: null };
};

const SUBMITTED_STATUSES: Readonly<Record<QsbWithdrawalSubmission, QsbWithdrawalStatus>> = {
  conflict: "conflict",
  confirmed: "confirmed",
  submitted: "submitted",
  uncertain: "uncertain",
};

/**
 * The view a release or resend answers with, for the signed transaction
 * `txid`: the status `submission` names when the coordinator answered, or
 * `pending` (signed and kept here, not known to have reached MARA) when it
 * gave no answer.
 */
export const qsbSubmittedWithdrawalView = (
  record: QsbWithdrawalRecord,
  submission: QsbWithdrawalSubmission | null,
  txid: string,
): QsbWithdrawalView => ({
  ...terms(record),
  confirmations: null,
  status: submission === null ? "pending" : SUBMITTED_STATUSES[submission],
  txid,
});
