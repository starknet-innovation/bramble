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

import { knownTokensForNetwork } from "@mc-wallet/portfolio/token-registry";
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import type { WalletOpsDeps } from "../accounts/wallet-ops";
import { readTypeOnlyInput } from "../routing/message-inputs";
import {
  runUnlockedNetworkMutation,
  runVaultCreationWithNetwork,
} from "../runtime/active-network-mutation";
import {
  activeAccountContext,
  networkRpcUrls,
  runActiveStateMutation,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { accountHashSigner } from "./account-hash-signer";
import {
  readAddLedgerAccountInput,
  readCompleteLedgerSignInput,
  readCreateLedgerVaultInput,
  readDeriveLedgerAccountsInput,
  readLedgerAccountStatusInput,
} from "./ledger-inputs";

type LedgerOpsHandler = (deps: WalletOpsDeps, message: unknown) => Promise<RuntimeResponse>;

// Best-effort STRK balance for a candidate address, formatted as "<amount> STRK".
// Reuses the shared token registry and the same balance RPC the home screen uses;
// a null result degrades the picker to "balance unavailable" rather than blocking.
const ledgerStrkBalance = async (
  deps: WalletOpsDeps,
  address: string,
  networkId: StarknetNetworkId,
  rpcUrls: readonly string[],
): Promise<string | null> => {
  const strk = knownTokensForNetwork(networkId).find((token) => token.symbol === "STRK");
  if (!strk) {
    return null;
  }
  const [balance] = await deps.runtimeRpc.getTokenBalances({
    accountAddress: address,
    rpcUrls,
    tokens: [strk],
  });
  return balance ? `${balance.formatted} ${balance.symbol}` : null;
};

const handleCreateLedgerVault: LedgerOpsHandler = async (deps, message) => {
  const input = readCreateLedgerVaultInput(message);
  if (!input) {
    return { error: "invalid create ledger vault request" };
  }
  const createLedgerVault = deps.wallet.createLedgerVault;
  if (!createLedgerVault) {
    return { error: "wallet unavailable" };
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
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[input.networkId], preferences);
  const [deployed, balance] = await Promise.all([
    deps.runtimeRpc
      .getDeploymentStatus({ accountAddress: input.address, rpcUrls })
      .catch(() => null),
    ledgerStrkBalance(deps, input.address, input.networkId, rpcUrls).catch(() => null),
  ]);
  return { balance, deployed, ok: true };
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

// Runs the viewing-key ceremony for the ACTIVE Ledger account and its configured
// pool. The scope is taken from wallet state, never from the message: a
// caller-supplied chain or pool would let one device signature be bound to the
// wrong pool, and a viewing key registered with a pool cannot be changed
// afterwards. The message therefore carries nothing but its type.
const handleDeriveLedgerViewingKey: LedgerOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.strk20DeriveLedgerViewingKey")) {
    return { error: "invalid derive ledger viewing key request" };
  }
  const derive = deps.wallet.deriveLedgerStrk20ViewingKey;
  if (!derive) {
    return { error: "wallet unavailable" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const { account, networkId, vaultPassphrase } = context;
  if (account.derivation.kind !== "ledger") {
    return { error: "active account is not a Ledger account" };
  }
  const preferences = await deps.preferencesStore.read();
  const poolAddress = canonicalFelt(preferences.strk20Networks?.[networkId]?.poolAddress ?? "");
  if (!poolAddress) {
    return { error: "Private balances are not configured for this network" };
  }
  try {
    await derive({
      accountId: account.id,
      chainId: STARKNET_NETWORKS[networkId].chainId,
      poolAddress,
      // The device round-trip, wrapped in the verify-against-publicKeyX gate. A
      // rejection, timeout, or unverifiable signature throws here, so nothing is
      // written and the account stays without a retained key.
      sign: accountHashSigner(deps, account, vaultPassphrase, "strk20-viewing-key"),
      vaultPassphrase,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "viewing key ceremony failed" };
  }
  return { ok: true };
};

const LEDGER_OPS_HANDLERS: Readonly<Record<string, LedgerOpsHandler>> = {
  "wallet.addLedgerAccount": handleAddLedgerAccount,
  "wallet.completeLedgerSign": handleCompleteLedgerSign,
  "wallet.createLedgerVault": handleCreateLedgerVault,
  "wallet.deriveLedgerAccounts": handleDeriveLedgerAccounts,
  "wallet.ledgerAccountStatus": handleLedgerAccountStatus,
  "wallet.ledgerSignPending": handleLedgerSignPending,
  "wallet.strk20DeriveLedgerViewingKey": handleDeriveLedgerViewingKey,
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
