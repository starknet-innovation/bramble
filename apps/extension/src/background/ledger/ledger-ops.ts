/**
 * Background handlers for the privileged Ledger messages: creating a keyless
 * Ledger account, creating a brand-new mnemonic-less vault backed by a Ledger
 * (first run), deriving the account-picker candidates, reading a candidate's
 * best-effort on-chain deployed status and balance, and the two halves of the
 * side-panel signing round-trip (the panel polls pending device signs and calls
 * back with the device `(r, s)` or a rejection). All are privileged — never in
 * DAPP_MESSAGES — so the dispatcher's gate already restricts them to
 * extension-page senders; no dapp origin can reach the device or the vault.
 */

import type { WalletOpsDeps } from "../accounts/wallet-ops";
import { readTypeOnlyInput } from "../routing/message-inputs";
import {
  runUnlockedNetworkMutation,
  runVaultCreationWithNetwork,
} from "../runtime/active-network-mutation";
import { runActiveStateMutation } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { ledgerStoreRefusal, readLedgerAccountState } from "./ledger-activity";
import {
  readAddLedgerAccountInput,
  readCompleteLedgerSignInput,
  readCreateLedgerVaultInput,
  readDeriveLedgerAccountsInput,
  readLedgerAccountStatusInput,
} from "./ledger-inputs";

type LedgerOpsHandler = (deps: WalletOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const handleCreateLedgerVault: LedgerOpsHandler = async (deps, message) => {
  const input = readCreateLedgerVaultInput(message);
  if (!input) {
    return { error: "invalid create ledger vault request" };
  }
  const createLedgerVault = deps.wallet.createLedgerVault;
  if (!createLedgerVault) {
    return { error: "wallet unavailable" };
  }
  const refusal = await ledgerStoreRefusal(deps, input);
  if (refusal) {
    return refusal;
  }
  return runActiveStateMutation(deps.activeStateCoordinator, async () => {
    const account = await runVaultCreationWithNetwork(
      deps.session,
      deps.preferencesStore,
      input.networkId,
      () => createLedgerVault(input),
    );
    deps.session.unlock(input.vaultPassphrase);
    return { account, ok: true };
  });
};

const handleLedgerAccountStatus: LedgerOpsHandler = async (deps, message) => {
  const input = readLedgerAccountStatusInput(message);
  if (!input) {
    return { error: "invalid ledger account status request" };
  }
  const state = await readLedgerAccountState(deps, input.address, input.networkId);
  return { ...state, ok: true };
};

const handleAddLedgerAccount: LedgerOpsHandler = async (deps, message) => {
  const input = readAddLedgerAccountInput(message);
  if (!input) {
    return { error: "invalid add ledger account request" };
  }
  const addLedgerAccount = deps.wallet.addLedgerAccount;
  if (!addLedgerAccount) {
    return { error: "wallet unavailable" };
  }
  // Bramble never creates a Braavos account: a Braavos Ledger row the picker
  // should have disabled is refused here too, before anything is stored.
  const refusal = await ledgerStoreRefusal(deps, input);
  if (refusal) {
    return refusal;
  }
  return runActiveStateMutation(deps.activeStateCoordinator, async () => {
    const account = await runUnlockedNetworkMutation(
      deps.session,
      deps.preferencesStore,
      input.networkId,
      (vaultPassphrase) => addLedgerAccount({ ...input, vaultPassphrase }),
    );
    return account ? { account, ok: true } : { error: "wallet locked" };
  });
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
  "wallet.createLedgerVault": handleCreateLedgerVault,
  "wallet.deriveLedgerAccounts": handleDeriveLedgerAccounts,
  "wallet.ledgerAccountStatus": handleLedgerAccountStatus,
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
  const handler = Object.hasOwn(LEDGER_OPS_HANDLERS, messageType)
    ? LEDGER_OPS_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, message) : null;
};
