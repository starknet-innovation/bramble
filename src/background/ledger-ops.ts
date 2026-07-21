/**
 * Background handlers for the privileged Ledger messages: creating a keyless
 * Ledger account, deriving the account-picker candidates, and the two halves of
 * the side-panel signing round-trip (the panel polls pending device signs and
 * calls back with the device `(r, s)` or a rejection). All four are privileged
 * — never in DAPP_MESSAGES — so the dispatcher's gate already restricts them to
 * extension-page senders; no dapp origin can reach the device.
 */
import {
  readAddLedgerAccountInput,
  readCompleteLedgerSignInput,
  readDeriveLedgerAccountsInput,
} from "./ledger-inputs";
import { readTypeOnlyInput } from "./message-inputs";
import type { RuntimeResponse } from "./runtime-types";
import type { WalletOpsDeps } from "./wallet-ops";

type LedgerOpsHandler = (deps: WalletOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const handleAddLedgerAccount: LedgerOpsHandler = async (deps, message) => {
  const input = readAddLedgerAccountInput(message);
  if (!input) {
    return { error: "invalid add ledger account request" };
  }
  const vaultPassphrase = deps.session.getPassphrase();
  if (!vaultPassphrase) {
    return { error: "wallet locked" };
  }
  if (!deps.wallet.addLedgerAccount) {
    return { error: "wallet unavailable" };
  }
  const account = await deps.wallet.addLedgerAccount({ ...input, vaultPassphrase });
  return { account, ok: true };
};

const handleDeriveLedgerAccounts: LedgerOpsHandler = async (deps, message) => {
  const input = readDeriveLedgerAccountsInput(message);
  if (!input) {
    return { error: "invalid derive ledger accounts request" };
  }
  if (!deps.wallet.deriveLedgerAccounts) {
    return { error: "wallet unavailable" };
  }
  const accounts = await deps.wallet.deriveLedgerAccounts(input);
  return { accounts, ok: true };
};

const handleLedgerSignPending: LedgerOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.ledgerSignPending")) {
    return { error: "invalid ledger sign pending request" };
  }
  return { ok: true, pending: deps.ledgerSignQueue?.pending() ?? [] };
};

const handleCompleteLedgerSign: LedgerOpsHandler = async (deps, message) => {
  const input = readCompleteLedgerSignInput(message);
  if (!input) {
    return { error: "invalid complete ledger sign request" };
  }
  const queue = deps.ledgerSignQueue;
  if (!queue) {
    return { error: "ledger signing unavailable" };
  }
  const settled =
    "error" in input
      ? queue.reject(input.id, input.error)
      : queue.settle(input.id, { r: input.r, s: input.s });
  return settled ? { ok: true } : { error: "no pending ledger sign for id" };
};

const LEDGER_OPS_HANDLERS: Readonly<Record<string, LedgerOpsHandler>> = {
  "wallet.addLedgerAccount": handleAddLedgerAccount,
  "wallet.completeLedgerSign": handleCompleteLedgerSign,
  "wallet.deriveLedgerAccounts": handleDeriveLedgerAccounts,
  "wallet.ledgerSignPending": handleLedgerSignPending,
};

/**
 * Handles the privileged Ledger messages; returns null for other message types.
 */
export const handleLedgerOps = async (
  deps: WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = LEDGER_OPS_HANDLERS[messageType];
  return handler ? handler(deps, message) : null;
};
