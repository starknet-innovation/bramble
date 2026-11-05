/**
 * Pure model and copy for withdrawing a QSB deposit: what a deposit's
 * withdrawal shows on its row, which actions it offers, when the QSB vault
 * screen keeps polling, the explorer link, and every sentence the Withdraw and
 * Release screens print. No DOM, clock, or runtime access.
 */
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import {
  QSB_DISCLOSED_SECRETS,
  type QsbWithdrawalSubmission,
} from "@bramble/wallet-model/qsb-withdrawals";
import { qsbVaultDisplay } from "./qsb-vault-model";
import { isQsbTxid } from "./qsb-vault-runtime";

/**
 * What a deposit's withdrawal row says, once one has started: `searching`
 * (the QSB service is looking for a solution), `paused`, `failed`, `ready`
 * (waiting for the user's review and release), `sending` (released, not yet
 * known to have reached MARA), `sent` (MARA has it), `uncertain`, `withdrawn`
 * (mined) and `conflict` (something else spent the deposit).
 */
export type QsbWithdrawalDisplay =
  | "conflict"
  | "failed"
  | "paused"
  | "ready"
  | "searching"
  | "sending"
  | "sent"
  | "uncertain"
  | "withdrawn";

/**
 * The withdrawal state a row shows, or null when none has started or the
 * deposit's history is not trusted (its row then says Unavailable).
 */
export const qsbWithdrawalDisplay = (vault: QsbVaultView): QsbWithdrawalDisplay | null => {
  if (vault.state === "unknown") return null;
  switch (vault.withdrawal.status) {
    case "none":
      return null;
    case "pending":
      return "sending";
    case "submitted":
      return "sent";
    case "confirmed":
      return "withdrawn";
    default:
      return vault.withdrawal.status;
  }
};

const LABEL: Readonly<Record<QsbWithdrawalDisplay, string>> = {
  conflict: "Spent elsewhere",
  failed: "Withdrawal failed",
  paused: "Withdrawal paused",
  ready: "Ready to release",
  searching: "Withdrawing",
  sending: "Sending",
  sent: "Withdrawal sent",
  uncertain: "Not confirmed yet",
  withdrawn: "Withdrawn",
};

/**
 * The one line a few states need under their label. A failed withdrawal is
 * final: a deposit gets one search, ever, so its bitcoin can't move through
 * Bramble, and the row says so rather than only "failed".
 */
const HINT: Readonly<Partial<Record<QsbWithdrawalDisplay, string>>> = {
  failed: "Its bitcoin stays locked in this deposit.",
  searching: "This can take hours.",
};

/** A withdrawal row's status line: its label, and a mined one's confirmations when known. */
export const qsbWithdrawalStatusText = (display: QsbWithdrawalDisplay, vault: QsbVaultView) => {
  const confirmations = vault.withdrawal.confirmations;
  if (display !== "withdrawn" || confirmations === null) return LABEL[display];
  return `${LABEL.withdrawn} · ${confirmations} confirmation${confirmations === 1 ? "" : "s"}`;
};

/** The line under a withdrawal state's label, or null. */
export const qsbWithdrawalHint = (display: QsbWithdrawalDisplay): string | null =>
  HINT[display] ?? null;

/** Whether a funded deposit with no withdrawal yet may start one. */
export const qsbWithdrawable = (vault: QsbVaultView): boolean =>
  qsbVaultDisplay(vault) === "funded" && vault.withdrawal.status === "none";

/**
 * Whether any withdrawal is still moving on its own (searching, sending,
 * unconfirmed or sent), so the QSB vault screen keeps re-reading.
 */
export const qsbWithdrawalInFlight = (vaults: readonly QsbVaultView[]): boolean =>
  vaults.some((vault) => {
    const display = qsbWithdrawalDisplay(vault);
    return (
      display === "searching" ||
      display === "sending" ||
      display === "uncertain" ||
      display === "sent"
    );
  });

const MEMPOOL_TX = "https://mempool.space/tx/";

/**
 * The public explorer page for a withdrawal MARA has or has mined, or null.
 * Only a validated txid is ever put in the URL.
 */
export const qsbWithdrawalLink = (vault: QsbVaultView): string | null => {
  const { status, txid } = vault.withdrawal;
  return (status === "submitted" || status === "confirmed") && isQsbTxid(txid)
    ? `${MEMPOOL_TX}${txid}`
    : null;
};

/** The Withdraw summary's one line under its costs. */
export const QSB_WITHDRAW_TERMS = "This can take hours, and the fee can't change later.";
/** While the withdrawal is being fixed and its search started. */
export const QSB_WITHDRAW_STARTING = "Starting…";
/** While the release review loads. */
export const QSB_REVIEW_LOADING = "Loading the withdrawal…";

/**
 * The prominent statement the BIP requires before any secret leaves: the
 * release discloses spending secrets with an unverified transaction binding.
 * A warning: no contractions. It must never read as a verified binding, and
 * never as an unchecked transaction either: Bramble does rebuild and check
 * `T`, so the title names no transaction and the body names what is not
 * verified.
 */
export const QSB_UNVERIFIED_TITLE = "Unverified";
/** The statement's body; see {@link QSB_UNVERIFIED_TITLE}. */
export const QSB_UNVERIFIED_BODY = `Bramble cannot independently confirm that these ${QSB_DISCLOSED_SECRETS} keys allow only this withdrawal.`;

/** The release review's "keys released" value. */
export const QSB_KEYS_RELEASED = `${QSB_DISCLOSED_SECRETS} one-time keys`;

/** Each release outcome's heading and line, on the Release screen and after a resend. */
export const QSB_WITHDRAWAL_COPY: Readonly<
  Record<QsbWithdrawalSubmission, { readonly line: string; readonly title: string }>
> = {
  conflict: { line: "Another transaction spent this deposit.", title: "Spent elsewhere" },
  confirmed: { line: "The withdrawal is mined.", title: "Withdrawn" },
  submitted: { line: "It shows as withdrawn once it's mined.", title: "Withdrawal sent" },
  uncertain: { line: "Resend sends the same withdrawal again.", title: "Not confirmed yet" },
};

/** A release or resend outcome as one status line: `Withdrawal sent. It shows…`. */
export const qsbWithdrawalLine = (submission: QsbWithdrawalSubmission): string =>
  `${QSB_WITHDRAWAL_COPY[submission].title}. ${QSB_WITHDRAWAL_COPY[submission].line}`;

/** A release whose reply was lost: its heading. */
export const QSB_RELEASE_UNKNOWN_TITLE = "Withdrawal status unknown";

/** Typed destination text, trimmed; an all-uppercase bech32 address (BIP-173 allows it) is lowercased. */
export const qsbTypedDestination = (text: string): string => {
  const trimmed = text.trim();
  return /^BC1[02-9AC-HJ-NP-Z]+$/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
};
