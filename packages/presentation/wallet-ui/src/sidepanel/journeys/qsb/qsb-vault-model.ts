/**
 * Pure model and copy for the Quantum-safe Bitcoin vault screens: what a
 * validated vault view shows, BTC amounts as exact satoshi text, the deposit
 * amount check, the explorer link, and every sentence the account and deposit
 * screens print. No DOM, clock, or runtime access.
 */
import { isDecimalAmountText } from "@bramble/core/json";
import type { QsbAccountView } from "@bramble/wallet-model/qsb";
import {
  QSB_MAX_SAT,
  QSB_MIN_DEPOSIT_SAT,
  QSB_VAULT_REFUSALS,
  type QsbSubmission,
  type QsbVaultView,
} from "@bramble/wallet-model/qsb-vaults";
import { friendlyError } from "../../runtime/friendly-error";
import { isOutcomeUnknown } from "../../runtime/runtime-errors";
import { errorLine } from "../../shared/dom";
import {
  QSB_HISTORY_UNAVAILABLE_HINT,
  QSB_IMPORT_READ_ONLY,
  qsbAccountLabel,
  qsbAccountState,
} from "./qsb-model";
import { isQsbTxid } from "./qsb-vault-runtime";

const SAT_PER_BTC = 100_000_000n;
const BTC_DECIMALS = 8;
// "21000000.00000000" is 17 characters; anything longer is not an amount.
const MAX_AMOUNT_TEXT = 20;

/** `sat` as BTC with all 8 decimals, from integer arithmetic only: `0.00120000`. */
export const formatBtc = (sat: number): string => {
  const value = BigInt(sat);
  const fraction = (value % SAT_PER_BTC).toString().padStart(BTC_DECIMALS, "0");
  return `${(value / SAT_PER_BTC).toString()}.${fraction}`;
};

/** `sat` as a BTC amount line: `0.00120000 BTC`. */
export const btcText = (sat: number): string => `${formatBtc(sat)} BTC`;

/**
 * Typed BTC as satoshis, without floating point: the shared decimal grammar,
 * at most 8 decimal places, at most `QSB_MAX_SAT`. Null for anything else,
 * including a sign, an exponent or a comma.
 */
export const parseBtcAmount = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed.length > MAX_AMOUNT_TEXT || !isDecimalAmountText(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > BTC_DECIMALS) return null;
  const sat = BigInt(whole) * SAT_PER_BTC + BigInt(fraction.padEnd(BTC_DECIMALS, "0"));
  return sat <= BigInt(QSB_MAX_SAT) ? Number(sat) : null;
};

/**
 * Whether a typed amount may be quoted against `balanceSat`, the confirmed
 * funds: `invalid` (not an amount), `tooSmall` (under the minimum deposit),
 * `tooLarge` (over the balance), or the amount in satoshis.
 */
export type QsbAmountCheck =
  | { readonly kind: "invalid" | "tooLarge" | "tooSmall" }
  | { readonly kind: "ok"; readonly sat: number };

/** Checks a typed deposit amount; see {@link QsbAmountCheck}. */
export const checkQsbDepositAmount = (text: string, balanceSat: number): QsbAmountCheck => {
  const sat = parseBtcAmount(text);
  if (sat === null) return { kind: "invalid" };
  if (sat < QSB_MIN_DEPOSIT_SAT) return { kind: "tooSmall" };
  if (sat > balanceSat) return { kind: "tooLarge" };
  return { kind: "ok", sat };
};

/** Each refused amount's line. The two the background also refuses reuse its reviewed copy. */
export const QSB_AMOUNT_LINE: Readonly<Record<Exclude<QsbAmountCheck["kind"], "ok">, string>> = {
  invalid: "Enter an amount in BTC, up to 8 decimal places.",
  tooLarge: friendlyError(QSB_VAULT_REFUSALS.insufficientFunds).message,
  tooSmall: friendlyError(QSB_VAULT_REFUSALS.amountTooSmall).message,
};

/** `Vault <n>`, counting from 1, for vault index `v`. The one vault name every screen uses. */
export const qsbVaultLabel = (v: number): string => `Vault ${v + 1}`;

/** `Account <n> · Vault <m>`: the deposit screen's eyebrow. */
export const qsbVaultTitle = (accountId: string, v: number): string =>
  `${qsbAccountLabel(accountId)} · ${qsbVaultLabel(v)}`;

/**
 * What one vault row says. `unfunded`: allocated with nothing signed.
 * `waiting`: a deposit signed and kept here, not yet known to MARA. `sent`:
 * MARA has it. `funded`: mined. `withdrawn`: its key set was disclosed for a
 * withdrawal. `unavailable`: no history Bramble can trust, or retired before
 * it held funds.
 */
export type QsbVaultDisplay =
  | "funded"
  | "sent"
  | "unavailable"
  | "unfunded"
  | "waiting"
  | "withdrawn";

/**
 * The row state for a validated view. A disclosed key set (`exposed`) was
 * withdrawn; a `retired` one only when it was funded, since a key set can be
 * retired unused; `unknown` history is never shown as anything usable.
 */
export const qsbVaultDisplay = (vault: QsbVaultView): QsbVaultDisplay => {
  if (vault.state === "exposed") return "withdrawn";
  if (vault.state === "retired") {
    return vault.deposit.status === "confirmed" ? "withdrawn" : "unavailable";
  }
  if (vault.state === "unknown") return "unavailable";
  switch (vault.deposit.status) {
    case "none":
      return "unfunded";
    case "pending":
      return "waiting";
    case "submitted":
      return "sent";
    case "confirmed":
      return "funded";
  }
};

/** Each row state's label. */
const QSB_VAULT_LABEL: Readonly<Record<QsbVaultDisplay, string>> = {
  funded: "Funded",
  sent: "Deposit sent",
  unavailable: "Unavailable",
  unfunded: "Unfunded",
  waiting: "Deposit waiting",
  withdrawn: "Withdrawn",
};

/** The row's status line: its label, and a funded vault's confirmations when known. */
export const qsbVaultStatusText = (vault: QsbVaultView): string => {
  const display = qsbVaultDisplay(vault);
  const confirmations = vault.deposit.confirmations;
  if (display !== "funded" || confirmations === null) return QSB_VAULT_LABEL[display];
  return `${QSB_VAULT_LABEL.funded} · ${confirmations} confirmation${confirmations === 1 ? "" : "s"}`;
};

/** Whether `vault` takes a deposit now: allocated, with nothing signed. */
export const qsbDepositable = (vault: QsbVaultView): boolean =>
  qsbVaultDisplay(vault) === "unfunded";

/** Whether any vault's deposit is still on its way, so the account screen keeps polling. */
export const qsbDepositInFlight = (vaults: readonly QsbVaultView[]): boolean =>
  vaults.some((vault) => {
    const display = qsbVaultDisplay(vault);
    return display === "waiting" || display === "sent";
  });

const MEMPOOL_TX = "https://mempool.space/tx/";

/**
 * The public explorer page for a deposit MARA has or has mined, or null. Only
 * a validated txid is ever put in the URL; a pending deposit is not on the
 * network yet, so it gets no link.
 */
export const qsbDepositLink = (vault: QsbVaultView): string | null => {
  const { status, txid } = vault.deposit;
  return (status === "submitted" || status === "confirmed") && isQsbTxid(txid)
    ? `${MEMPOOL_TX}${txid}`
    : null;
};

/** The explorer link's accessible name. */
export const QSB_TX_LINK_LABEL = "View this transaction on mempool.space";

/**
 * The line that replaces New vault on an account that cannot make vaults,
 * or null for a writer.
 */
export const qsbNoVaultLine = (account: QsbAccountView): string | null => {
  switch (qsbAccountState(account)) {
    case "backup-needed":
      return "Back up this account's phrase to make vaults.";
    case "history-unavailable":
      return QSB_HISTORY_UNAVAILABLE_HINT;
    case "read-only":
      return QSB_IMPORT_READ_ONLY;
    case "ready":
      return null;
  }
};

/** Under the owner address. */
export const QSB_ADDRESS_HINT = "Send bitcoin here before you make a vault.";
/** In place of the balance when the coordinator could not be reached. */
export const QSB_FUNDS_UNAVAILABLE = "Can't reach the quantum-safe Bitcoin service.";
/** While an account's vaults load. */
export const QSB_VAULTS_LOADING = "Loading vaults…";
/** An account with no vaults yet. */
export const QSB_VAULTS_EMPTY = "No vaults yet.";
/** The New vault confirm step's one fact. */
export const QSB_VAULT_CONFIRM =
  "Bramble registers a new vault with the quantum-safe Bitcoin service. It takes one deposit.";
/** While the background signs in and registers the vault. */
export const QSB_VAULT_CREATING = "Creating vault…";
/** While a deposit or resend is in flight. */
export const QSB_DEPOSIT_SENDING = "Sending deposit…";

/** The three facts the deposit review states before the cost is accepted. Warnings: no contractions. */
export const QSB_DEPOSIT_FACTS: readonly string[] = [
  "A vault takes one deposit.",
  "The deposit goes through the quantum-safe Bitcoin service to MARA Slipstream.",
  "The quantum-safe Bitcoin service is not a production release.",
];

/** Each submission outcome's heading and line, on the deposit screen and after a resend. */
export const QSB_SUBMISSION_COPY: Readonly<
  Record<QsbSubmission, { readonly line: string; readonly title: string }>
> = {
  rejected: {
    line: "MARA refused it. The vault can take a new deposit.",
    title: "Deposit refused",
  },
  submitted: { line: "The vault shows as funded once it's mined.", title: "Deposit sent" },
  uncertain: { line: "Resend sends the same transaction again.", title: "Not confirmed yet" },
};

/** A submission outcome as one status line: `Deposit sent. The vault shows…`. */
export const qsbSubmissionLine = (submission: QsbSubmission): string =>
  `${QSB_SUBMISSION_COPY[submission].title}. ${QSB_SUBMISSION_COPY[submission].line}`;

/** A deposit whose reply was lost: its heading. */
export const QSB_DEPOSIT_UNKNOWN_TITLE = "Deposit status unknown";

// A vault write whose reply was lost may still have run; the account says
// whether it did.
const QSB_VAULT_OUTCOME_UNKNOWN =
  "Bramble couldn't confirm this finished. Refresh the account before trying again.";

/**
 * The line for a rejected vault write (create, deposit, resend): the
 * outcome-unknown sentence when the write may have run, otherwise the
 * refusal's reviewed copy (or the caller's fallback diagnostic's).
 */
export const qsbVaultWriteFailure = (error: unknown, fallback: string): string =>
  isOutcomeUnknown(error) ? QSB_VAULT_OUTCOME_UNKNOWN : errorLine(error, fallback);

/** Whether a rejected deposit was refused only because its cost moved since the quote. */
export const isQsbQuoteChanged = (error: unknown): boolean =>
  error instanceof Error && error.message === QSB_VAULT_REFUSALS.quoteChanged;
