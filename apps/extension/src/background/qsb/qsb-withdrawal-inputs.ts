/**
 * Pure parsers for the five QSB withdrawal messages, which only extension
 * pages may send. Each reads own data properties, accepts only the keys its
 * message defines, a well-formed QSB account id and a vault index below 2^31,
 * a destination as bounded text (whether it is payable is the flow's to
 * refuse), a fee as a safe satoshi integer, a digest as 64 lowercase hex
 * digits, and the wallet password re-entered in the release, and returns null
 * for anything else without echoing what it was given.
 */
import { isRecord } from "@bramble/core/json";
import { isVaultPassphrase } from "@bramble/wallet-model/passphrase";
import { QSB_MAX_SAT } from "@bramble/wallet-model/qsb-vaults";
import { type QsbVaultInput, readQsbVaultInput } from "./qsb-vault-inputs";

/** A quote request: a deposit and a destination. */
export type QsbWithdrawalQuoteInput = QsbVaultInput & { readonly destination: string };

/** A start request: a deposit, a destination and the fee the user accepted. */
export type QsbWithdrawalStartInput = QsbWithdrawalQuoteInput & { readonly feeSat: number };

/** A release request: a deposit, the reviewed digest and the re-entered password. */
export type QsbWithdrawalReleaseInput = QsbVaultInput & {
  readonly digest: string;
  readonly vaultPassphrase: string;
};

const MAX_DESTINATION_LENGTH = 100;
const DIGEST = /^[0-9a-f]{64}$/;

const isDestination = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_DESTINATION_LENGTH;

const isSats = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= QSB_MAX_SAT;

// The vault input of `message` read as `type` with exactly `extra` besides.
const vaultPart = (
  message: unknown,
  type: string,
  extra: readonly string[],
): { readonly input: QsbVaultInput; readonly message: Record<string, unknown> } | null => {
  if (!isRecord(message)) return null;
  const record = message;
  const picked = Object.fromEntries(Object.entries(record).filter(([key]) => !extra.includes(key)));
  if (!extra.every((key) => Object.hasOwn(record, key))) return null;
  const input = readQsbVaultInput(picked, type);
  return input ? { input, message: record } : null;
};

/** Parses `wallet.quoteQsbWithdrawal`: `{ accountId, v, destination }`. */
export const readQsbWithdrawalQuoteInput = (message: unknown): QsbWithdrawalQuoteInput | null => {
  const part = vaultPart(message, "wallet.quoteQsbWithdrawal", ["destination"]);
  return part && isDestination(part.message["destination"])
    ? { ...part.input, destination: part.message["destination"] }
    : null;
};

/** Parses `wallet.startQsbWithdrawal`: `{ accountId, v, destination, feeSat }`. */
export const readQsbWithdrawalStartInput = (message: unknown): QsbWithdrawalStartInput | null => {
  const part = vaultPart(message, "wallet.startQsbWithdrawal", ["destination", "feeSat"]);
  return part && isDestination(part.message["destination"]) && isSats(part.message["feeSat"])
    ? { ...part.input, destination: part.message["destination"], feeSat: part.message["feeSat"] }
    : null;
};

/** Parses `wallet.releaseQsbWithdrawal`: `{ accountId, v, digest, passphrase }`. */
export const readQsbWithdrawalReleaseInput = (
  message: unknown,
): QsbWithdrawalReleaseInput | null => {
  const part = vaultPart(message, "wallet.releaseQsbWithdrawal", ["digest", "passphrase"]);
  const digest = part?.message["digest"];
  const passphrase = part?.message["passphrase"];
  return part && typeof digest === "string" && DIGEST.test(digest) && isVaultPassphrase(passphrase)
    ? { ...part.input, digest, vaultPassphrase: passphrase }
    : null;
};
