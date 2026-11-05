/**
 * Pure parsers for the QSB account messages, which only extension pages may
 * send. Each reads own data properties, accepts only the keys its message
 * defines and bounded strings, and returns null for anything else without
 * echoing what it was given. A phrase is only bounded here: its spelling, its
 * words and its checksum are the vault service's and Krusty's to check, so a
 * wrong phrase is answered as one rather than as a malformed request.
 */
import { hasOnlyArrayEntries, hasOnlyKnownKeys, isJson, isRecord } from "@bramble/core/json";
import { isQsbAccountId } from "@bramble/vault/qsb-account";
import type { QsbBackupWord } from "@bramble/vault/service-types";
import { isVaultPassphrase, MAX_MNEMONIC_LENGTH } from "@bramble/wallet-model/passphrase";
import { QSB_BACKUP_CHECK_WORDS, QSB_PHRASE_WORDS } from "@bramble/wallet-model/qsb";

// A retyped word: BIP-39 English words are at most eight letters, so this
// leaves room for stray whitespace and nothing more.
const MAX_BACKUP_WORD_LENGTH = 32;

/** Parses `wallet.importQsbAccount`: the phrase to import, bounded. */
export const readImportQsbAccountInput = (
  message: unknown,
): { readonly mnemonic: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["mnemonic", "type"]) &&
  message["type"] === "wallet.importQsbAccount" &&
  typeof message["mnemonic"] === "string" &&
  message["mnemonic"].length <= MAX_MNEMONIC_LENGTH
    ? { mnemonic: message["mnemonic"] }
    : null;

/**
 * Parses `wallet.revealQsbPhrase`: a well-formed QSB account id and the wallet
 * password, re-entered in the message because a reveal never uses the
 * unlocked session.
 */
export const readRevealQsbPhraseInput = (
  message: unknown,
): { readonly accountId: string; readonly vaultPassphrase: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["accountId", "passphrase", "type"]) &&
  message["type"] === "wallet.revealQsbPhrase" &&
  isQsbAccountId(message["accountId"]) &&
  isVaultPassphrase(message["passphrase"])
    ? { accountId: message["accountId"], vaultPassphrase: message["passphrase"] }
    : null;

const readBackupWord = (value: unknown): QsbBackupWord | null =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["index", "word"]) &&
  typeof value["index"] === "number" &&
  Number.isSafeInteger(value["index"]) &&
  value["index"] >= 0 &&
  value["index"] < QSB_PHRASE_WORDS &&
  typeof value["word"] === "string" &&
  value["word"].length <= MAX_BACKUP_WORD_LENGTH
    ? { index: value["index"], word: value["word"] }
    : null;

// Exactly QSB_BACKUP_CHECK_WORDS entries, a plain JSON array (no holes,
// accessors or extra keys), each a word at a distinct position in the phrase.
const readBackupWords = (value: unknown): readonly QsbBackupWord[] | null => {
  if (
    !Array.isArray(value) ||
    value.length !== QSB_BACKUP_CHECK_WORDS ||
    !hasOnlyArrayEntries(value) ||
    !isJson(value)
  ) {
    return null;
  }
  const words = value.map(readBackupWord);
  const parsed = words.filter((word): word is QsbBackupWord => word !== null);
  const distinct = new Set(parsed.map((word) => word.index)).size === QSB_BACKUP_CHECK_WORDS;
  return parsed.length === QSB_BACKUP_CHECK_WORDS && distinct ? parsed : null;
};

/**
 * Parses `wallet.confirmQsbBackup`: a well-formed QSB account id and the
 * retyped words, each at a distinct position of the 24-word phrase.
 */
export const readConfirmQsbBackupInput = (
  message: unknown,
): { readonly accountId: string; readonly words: readonly QsbBackupWord[] } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["accountId", "type", "words"]) ||
    message["type"] !== "wallet.confirmQsbBackup" ||
    !isQsbAccountId(message["accountId"])
  ) {
    return null;
  }
  const words = readBackupWords(message["words"]);
  return words ? { accountId: message["accountId"], words } : null;
};
