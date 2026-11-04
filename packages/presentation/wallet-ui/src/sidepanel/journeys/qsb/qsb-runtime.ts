/**
 * Strict runtime client for Quantum Safe Bitcoin (QSB) accounts: the five
 * extension-page messages of `@bramble/wallet-model/qsb`, each reply validated
 * here before anything renders it. Every reply is untrusted: a shape this
 * module does not recognise is refused, never partly read.
 *
 * Secret boundary: `revealQsbPhrase` is the only reply that carries a QSB
 * phrase, and the vault passphrase travels only in its request; the import
 * request carries the phrase the user typed. This module passes both through
 * and keeps neither.
 *
 * Failure behaviour: a refusal rejects with the background's diagnostic, which
 * the shared copy table translates. An unrecognised reply to a read rejects
 * with a read fallback; to a write, with "wallet request failed", whose copy
 * says the outcome is unknown, because the write may have run.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { QSB_PHRASE_WORDS, type QsbAccountView } from "@bramble/wallet-model/qsb";
import { responseError } from "../../runtime/runtime-errors";

// `qsb-<n>`, n in 1..9999 with no leading zero: the id space the background
// allocates from, so the list can never be longer than it.
const ACCOUNT_ID = /^qsb-[1-9]\d{0,3}$/;
const MAX_ACCOUNTS = 9999;

// Exactly the phrase size, lowercase words joined by single spaces: the shape
// the background stores, so anything else is not a phrase it revealed.
const PHRASE = new RegExp(`^[a-z]+(?: [a-z]+){${QSB_PHRASE_WORDS - 1}}$`);

/** Whether `value` is a QSB account id (`qsb-<n>`, n in 1..9999). */
export const isQsbAccountId = (value: unknown): value is string =>
  typeof value === "string" && ACCOUNT_ID.test(value);

/**
 * Whether `value` is exactly one {@link QsbAccountView}: its five keys, the
 * enums, and the contract's own rules — an imported phrase is always backed
 * up and never a writer, and `writer` holds exactly when a generated account
 * is backed up and its journal is bound. A view breaking one is refused.
 */
export const isQsbAccountView = (value: unknown): value is QsbAccountView => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["backupConfirmed", "id", "journal", "provenance", "writer"]) ||
    !isQsbAccountId(value["id"]) ||
    typeof value["backupConfirmed"] !== "boolean" ||
    typeof value["writer"] !== "boolean" ||
    (value["journal"] !== "bound" && value["journal"] !== "unavailable") ||
    (value["provenance"] !== "generated-here" && value["provenance"] !== "imported")
  ) {
    return false;
  }
  const generated = value["provenance"] === "generated-here";
  return (
    (generated || value["backupConfirmed"]) &&
    value["writer"] === (generated && value["backupConfirmed"] && value["journal"] === "bound")
  );
};

/** Whether `value` is the `wallet.qsbAccounts` reply: valid views, distinct ids. */
export const readQsbAccounts = (value: unknown): readonly QsbAccountView[] | null => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, ["accounts", "ok"]) || value["ok"] !== true) {
    return null;
  }
  const accounts = value["accounts"];
  if (
    !Array.isArray(accounts) ||
    accounts.length > MAX_ACCOUNTS ||
    !accounts.every(isQsbAccountView) ||
    new Set(accounts.map((account) => account.id)).size !== accounts.length
  ) {
    return null;
  }
  return accounts;
};

/** The account of a `{ ok: true, account }` reply, or null. */
const readQsbAccount = (value: unknown): QsbAccountView | null =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["account", "ok"]) &&
  value["ok"] === true &&
  isQsbAccountView(value["account"])
    ? value["account"]
    : null;

/**
 * The phrase of a `wallet.revealQsbPhrase` reply: exactly
 * {@link QSB_PHRASE_WORDS} lowercase words joined by single spaces, or null.
 */
export const readQsbPhrase = (value: unknown): string | null =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["mnemonic", "ok"]) &&
  value["ok"] === true &&
  typeof value["mnemonic"] === "string" &&
  PHRASE.test(value["mnemonic"])
    ? value["mnemonic"]
    : null;

/** One retyped backup word at its 0-based position in the phrase. */
export type QsbBackupWord = { readonly index: number; readonly word: string };

/**
 * Creates the QSB account client over the panel's privileged channel. Each
 * method rejects rather than return a half-read reply; a write's lost reply
 * rejects with `SubmissionUnknownError` (see runtime-errors.ts).
 */
export const createQsbRuntimeClient = (sendMessage: (message: unknown) => Promise<unknown>) => ({
  /** Lists every QSB account. Read-only. */
  async loadQsbAccounts(): Promise<readonly QsbAccountView[]> {
    const response = await sendMessage({ type: "wallet.qsbAccounts" });
    const accounts = readQsbAccounts(response);
    if (accounts) return accounts;
    throw responseError(response, "wallet unavailable");
  },
  /**
   * Creates an account whose phrase the background generates and keeps. The
   * reply must be that new account: generated here, not yet backed up.
   */
  async createQsbAccount(): Promise<QsbAccountView> {
    const response = await sendMessage({ type: "wallet.createQsbAccount" });
    const account = readQsbAccount(response);
    if (account?.provenance === "generated-here" && !account.backupConfirmed) return account;
    // Its copy says the outcome is unknown: the write may have run.
    throw responseError(response, "wallet request failed");
  },
  /** Imports a phrase the user holds. The reply must be a read-only import. */
  async importQsbAccount(mnemonic: string): Promise<QsbAccountView> {
    const response = await sendMessage({ mnemonic, type: "wallet.importQsbAccount" });
    const account = readQsbAccount(response);
    if (account?.provenance === "imported") return account;
    // Its copy says the outcome is unknown: the write may have run.
    throw responseError(response, "wallet request failed");
  },
  /**
   * Reveals one account's phrase against a freshly typed vault passphrase.
   * Read-only; the caller decides how long the phrase stays on screen.
   */
  async revealQsbPhrase(accountId: string, passphrase: string): Promise<string> {
    const response = await sendMessage({ accountId, passphrase, type: "wallet.revealQsbPhrase" });
    const phrase = readQsbPhrase(response);
    if (phrase !== null) return phrase;
    throw responseError(response, "reveal failed");
  },
  /**
   * Sends the retyped words for the background to check against the stored
   * phrase. The reply must be the same account, now backed up.
   */
  async confirmQsbBackup(
    accountId: string,
    words: readonly QsbBackupWord[],
  ): Promise<QsbAccountView> {
    const response = await sendMessage({
      accountId,
      words: words.map(({ index, word }) => ({ index, word })),
      type: "wallet.confirmQsbBackup",
    });
    const account = readQsbAccount(response);
    if (account?.id === accountId && account.backupConfirmed) return account;
    // Its copy says the outcome is unknown: the write may have run.
    throw responseError(response, "wallet request failed");
  },
});

/** The QSB methods the panel's wallet client carries. */
export type QsbWallet = ReturnType<typeof createQsbRuntimeClient>;
