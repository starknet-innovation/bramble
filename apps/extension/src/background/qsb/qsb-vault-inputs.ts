/**
 * Pure parsers for the six QSB vault messages, which only extension pages
 * may send. Each reads own data properties, accepts only the keys its
 * message defines, a well-formed QSB account id, a vault index below 2^31
 * and satoshi amounts as safe integers within 21 million BTC, and returns
 * null for anything else without echoing what it was given. Whether an
 * amount is large enough, or a vault exists, is the flow's to refuse.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isQsbAccountId } from "@bramble/vault/qsb-account";
import { QSB_VAULT_INDEX_LIMIT } from "@bramble/vault/qsb-vault-record";
import { QSB_MAX_SAT } from "@bramble/wallet-model/qsb-vaults";

/** A request naming one QSB account. */
export type QsbAccountInput = { readonly accountId: string };

/** A request naming one vault of one QSB account. */
export type QsbVaultInput = QsbAccountInput & { readonly v: number };

/** A quote request: a vault and an amount. */
export type QsbQuoteInput = QsbVaultInput & { readonly amountSat: number };

/** A deposit request: a vault, an amount and the fee the user accepted. */
export type QsbDepositInput = QsbQuoteInput & { readonly feeSat: number };

const isIndex = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value < QSB_VAULT_INDEX_LIMIT;

const isSats = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= QSB_MAX_SAT;

const accountMessage = (
  message: unknown,
  type: string,
  keys: readonly string[],
): Record<string, unknown> | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["accountId", "type", ...keys]) &&
  message["type"] === type &&
  isQsbAccountId(message["accountId"])
    ? message
    : null;

/**
 * Parses `wallet.qsbVaults`, `wallet.createQsbVault` or
 * `wallet.recoverQsbVaults`: `{ accountId }`.
 */
export const readQsbAccountInput = (message: unknown, type: string): QsbAccountInput | null => {
  const parsed = accountMessage(message, type, []);
  return parsed ? { accountId: parsed["accountId"] as string } : null;
};

/** Parses `wallet.resendQsbDeposit`: `{ accountId, v }`. */
export const readQsbVaultInput = (message: unknown, type: string): QsbVaultInput | null => {
  const parsed = accountMessage(message, type, ["v"]);
  return parsed && isIndex(parsed["v"])
    ? { accountId: parsed["accountId"] as string, v: parsed["v"] }
    : null;
};

/** Parses `wallet.quoteQsbDeposit`: `{ accountId, v, amountSat }`. */
export const readQsbQuoteInput = (message: unknown): QsbQuoteInput | null => {
  const parsed = accountMessage(message, "wallet.quoteQsbDeposit", ["amountSat", "v"]);
  return parsed && isIndex(parsed["v"]) && isSats(parsed["amountSat"])
    ? { accountId: parsed["accountId"] as string, amountSat: parsed["amountSat"], v: parsed["v"] }
    : null;
};

/** Parses `wallet.depositQsbVault`: `{ accountId, v, amountSat, feeSat }`. */
export const readQsbDepositInput = (message: unknown): QsbDepositInput | null => {
  const parsed = accountMessage(message, "wallet.depositQsbVault", ["amountSat", "feeSat", "v"]);
  return parsed && isIndex(parsed["v"]) && isSats(parsed["amountSat"]) && isSats(parsed["feeSat"])
    ? {
        accountId: parsed["accountId"] as string,
        amountSat: parsed["amountSat"],
        feeSat: parsed["feeSat"],
        v: parsed["v"],
      }
    : null;
};
