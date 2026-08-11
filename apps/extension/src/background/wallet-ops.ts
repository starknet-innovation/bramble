/**
 * RPC-heavy wallet operations dispatched from the background message handler:
 * balances, deployment, transfer review and submission, and the activity feed.
 */

import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import {
  STARKNET_NETWORKS,
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { resolveFeeAffordability } from "@mc-wallet/transactions/fee-funds";
import { buildErc20TransferCall, type FeeEstimate, parseTokenAmount } from "@mc-wallet/starknet/rpc";
import { mergeActivity } from "@mc-wallet/transactions/tx-history";
import { verifyCalls } from "@mc-wallet/transactions/verify";
import {
  type ActivityEntry,
  type ActivityLog,
  type ActivityScope,
  systemClock,
} from "@mc-wallet/transactions/activity";
import type { AllowanceStore } from "@mc-wallet/transactions/allowance-store";
import type { MultisigStore } from "@mc-wallet/multisig/repository";
import type { WalletPreferences, WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import { accountHashSigner } from "./account-hash-signer";
import { readStrkBalance } from "./fee-guard";
import type { LedgerSignQueue } from "./ledger-sign-queue";
import {
  readActivityInput,
  readReviewTransferInput,
  readTransferInput,
  readTypeOnlyInput,
} from "./message-inputs";
import type { RuntimeRpc } from "./runtime-rpc";
import {
  type ActiveStateCoordinator,
  activeAccountContext,
  networkRpcUrls,
  runActiveStateMutation,
  statusResponse,
} from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import type { UnlockSession } from "./session";
import { failureNoticeMessage } from "./tx-observation";
import { reconcileScope } from "./tx-reconcile";
import type { WalletStatusReader } from "./wallet-reader";

/**
 * Dependencies shared by the wallet, allowance, and NFT operations handlers.
 */
export type WalletOpsDeps = {
  /** Serializes network/account selection writes; production always supplies it. */
  readonly activeStateCoordinator?: ActiveStateCoordinator;
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial test
   * stubs stay valid; a Ledger signing request with no queue wired fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  /**
   * Watched shared-account registry used only to authorize address-scoped,
   * read-only asset discovery. Signing paths resolve multisigs separately.
   */
  readonly multisigStore?: MultisigStore;
  /**
   * Wall-clock reader used to age transaction observation windows. Injected so
   * reconciliation stays deterministic under test; defaults to the system
   * clock boundary.
   */
  readonly now?: () => number;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Builds the wallet context the verifier checks calls against, scoped to the
 * account's network. Shared by the transfer, allowance, and NFT flows.
 */
export const verificationContext = (account: AccountRef, preferences: WalletPreferences) => ({
  account,
  addressBook: preferences.addressBook.filter((entry) => entry.networkId === account.networkId),
  tokens: preferences.tokens.filter((token) => token.networkId === account.networkId),
});

/**
 * Builds a hash signer for a resolved active-account context without exposing
 * the vault secret to caller modules.
 */
export const signerForContext = (
  deps: WalletOpsDeps,
  context: { readonly account: AccountRef; readonly vaultPassphrase: string },
) => accountHashSigner(deps, context.account, context.vaultPassphrase);

const transferContext = async (
  deps: WalletOpsDeps,
  input: { readonly accountId: string; readonly tokenId: string },
) => {
  const vaultPassphrase = deps.session.getPassphrase();
  if (!vaultPassphrase) {
    return { error: "wallet locked" } as const;
  }
  const preferences = await deps.preferencesStore.read();
  const vault = await deps.wallet.readVault(vaultPassphrase);
  const account = vault.accounts.find((stored) => stored.id === input.accountId);
  const token = preferences.tokens.find((stored) => stored.id === input.tokenId);
  if (!account || account.networkId !== preferences.activeNetworkId) {
    return { error: "no account for selected network" } as const;
  }
  if (!token || token.networkId !== account.networkId) {
    return { error: "token unavailable" } as const;
  }
  return { account, preferences, token, vaultPassphrase } as const;
};

/**
 * Classifies a transfer review's fee outcome so callers can tell an intentional
 * "no fee yet because the account still needs deployment" apart from a genuine
 * estimate failure. For an undeployed account the fee is intentionally null and
 * `feeEstimateFailed` stays false; for a deployed account that produced no
 * estimate the failure flag is set so the UI can surface a retry instead of a
 * dead "unavailable" string.
 */
export const resolveReviewFee = (input: {
  readonly deployed: boolean;
  readonly fee: FeeEstimate | null;
}): { readonly fee: FeeEstimate | null; readonly feeEstimateFailed: boolean } =>
  input.deployed
    ? { fee: input.fee, feeEstimateFailed: input.fee === null }
    : { fee: null, feeEstimateFailed: false };

type WalletOpsHandler = (deps: WalletOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const handleGetBalances: WalletOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.getBalances")) {
    return { error: "invalid balances request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await deps.preferencesStore.read();
  const network = STARKNET_NETWORKS[context.networkId];
  const balances = await deps.runtimeRpc.getTokenBalances({
    accountAddress: context.account.address,
    rpcUrls: networkRpcUrls(network, preferences),
    tokens: preferences.tokens.filter((token) => token.networkId === network.id),
  });
  return { accountId: context.account.id, balances, networkId: network.id, ok: true };
};

const handleDeploymentStatus: WalletOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.deploymentStatus")) {
    return { error: "invalid deployment status request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const deployed = await deps.runtimeRpc.getDeploymentStatus({
    accountAddress: context.account.address,
    rpcUrls: networkRpcUrls(
      STARKNET_NETWORKS[context.networkId],
      await deps.preferencesStore.read(),
    ),
  });
  return { accountId: context.account.id, deployed, ok: true };
};

const handleVerifyClassHash: WalletOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.verifyClassHash")) {
    return { error: "invalid class hash verification request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  if (!deps.runtimeRpc.verifyAccountClassHash) {
    return { error: "class hash verification unavailable" };
  }
  const verification = await deps.runtimeRpc.verifyAccountClassHash({
    accountAddress: context.account.address,
    expectedClassHash: context.account.classHash,
    rpcUrls: networkRpcUrls(
      STARKNET_NETWORKS[context.networkId],
      await deps.preferencesStore.read(),
    ),
  });
  return { accountId: context.account.id, ok: true, verification };
};

const handleDeployAccount: WalletOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.deployAccount")) {
    return { error: "invalid deploy account request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const { account, networkId, vaultPassphrase } = context;
  const result = await deps.runtimeRpc.submitAccountDeployment({
    account,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], await deps.preferencesStore.read()),
    signHash: accountHashSigner(deps, account, vaultPassphrase),
  });
  await deps.activity.record({
    accountId: account.id,
    hash: result.transactionHash,
    kind: "deploy",
    networkId,
    summary: "Deploy account contract",
  });
  return { ok: true, transactionHash: result.transactionHash };
};

const handleReviewTransfer: WalletOpsHandler = async (deps, message) => {
  const input = readReviewTransferInput(message);
  if (!input) {
    return { error: "invalid transfer review request" };
  }
  const context = await transferContext(deps, input);
  if ("error" in context) {
    return { error: context.error };
  }
  const { account, preferences, token, vaultPassphrase } = context;
  const amountRaw = parseTokenAmount(input.amount, token.decimals);
  const call = buildErc20TransferCall(token.address, input.recipient, amountRaw);
  const report = verifyCalls([call], verificationContext(account, preferences));
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences);
  const deployed = await deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: account.address, rpcUrls })
    .catch(() => true);
  const estimated = deployed
    ? await deps.runtimeRpc
        .estimateInvokeFee({
          account,
          calls: [call],
          rpcUrls,
          signHash: accountHashSigner(deps, account, vaultPassphrase),
        })
        .catch(() => null)
    : null;
  const { fee, feeEstimateFailed } = resolveReviewFee({ deployed, fee: estimated });
  // Fee-affordability guard (issue 191): compare the estimate against the
  // account's STRK balance, counting the transfer amount itself when the sent
  // token is STRK (the fee competes with the amount). Warn-only and fail-open:
  // an unreadable balance yields "unknown" and no claim is made.
  const feeAffordability = resolveFeeAffordability({
    balance: fee === null ? null : await readStrkBalance(deps, account, preferences),
    fee,
    sendAmount: sameFelt(token.address, STRK_TOKEN_ADDRESS) ? amountRaw : null,
  });
  return {
    ok: true,
    review: {
      fee,
      feeAffordability,
      feeEstimateFailed,
      flags: report.flags,
      requiresDeployment: !deployed,
      summaries: report.calls.map((decoded) => decoded.summary),
    },
  };
};

const handleTransfer: WalletOpsHandler = async (deps, message) => {
  const input = readTransferInput(message);
  if (!input) {
    return { error: "invalid transfer request" };
  }
  const context = await transferContext(deps, input);
  if ("error" in context) {
    return { error: context.error };
  }
  const { account, preferences, token, vaultPassphrase } = context;
  const result = await deps.runtimeRpc.submitErc20Transfer({
    account,
    amount: input.amount,
    recipient: input.recipient,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
    signHash: accountHashSigner(deps, account, vaultPassphrase),
    speed: input.speed,
    token,
  });
  const report = verifyCalls([result.call], verificationContext(account, preferences));
  await deps.activity.record({
    accountId: account.id,
    amount: input.amount,
    counterparty: input.recipient,
    hash: result.transactionHash,
    kind: "transfer",
    networkId: account.networkId,
    summary: report.calls[0]?.summary ?? `Send ${token.symbol}`,
    token: token.symbol,
  });
  return { ok: true, transactionHash: result.transactionHash };
};

const handleActivity: WalletOpsHandler = async (deps, message) => {
  const input = readActivityInput(message);
  if (!input) {
    return { error: "invalid activity request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { activity: [], ok: true };
  }
  const target = await activityTarget(deps, context, input.accountId);
  if (!target) {
    return { error: "activity scope unavailable" };
  }
  const local = await reconcileScope(deps, target.scope, (deps.now ?? systemClock)());
  const history = await accountHistory(deps, target);
  return {
    activity: mergeActivity(local, history.onChain),
    ...(history.unavailable ? { historyUnavailable: true } : {}),
    ok: true,
  };
};

/**
 * Drains the failure notices background reconciliation recorded while the side
 * panel was closed. Each notice is returned exactly once; the activity entry
 * keeps its terminal status whether or not the notice was ever displayed.
 */
const handleTransactionAlerts: WalletOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.transactionAlerts")) {
    return { error: "invalid transaction alerts request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { alerts: [], ok: true };
  }
  const entries = await deps.activity
    .takeFailureNotices({ accountId: context.account.id, networkId: context.networkId })
    .catch(() => []);
  return { alerts: entries.map(failureNoticeMessage), ok: true };
};

const handleLock: WalletOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.lock")) {
    return { error: "invalid lock request" };
  }
  return runActiveStateMutation(deps.activeStateCoordinator, async () => {
    // Revoke parked device signs before clearing the session.
    deps.ledgerSignQueue?.rejectAll("wallet locked");
    deps.session.lock();
    return statusResponse(deps.wallet, deps.session, deps.preferencesStore);
  });
};

/**
 * Dispatch table for wallet operation messages, keyed by message type. Keeping
 * each branch a self-contained handler leaves the router a pure lookup.
 */
const WALLET_OPS_HANDLERS: Readonly<Record<string, WalletOpsHandler>> = {
  "wallet.activity": handleActivity,
  "wallet.deployAccount": handleDeployAccount,
  "wallet.deploymentStatus": handleDeploymentStatus,
  "wallet.getBalances": handleGetBalances,
  "wallet.lock": handleLock,
  "wallet.reviewTransfer": handleReviewTransfer,
  "wallet.transactionAlerts": handleTransactionAlerts,
  "wallet.transfer": handleTransfer,
  "wallet.verifyClassHash": handleVerifyClassHash,
};

/**
 * Handles wallet operation messages; returns null for other message types.
 */
export const handleWalletOps = async (
  deps: WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = WALLET_OPS_HANDLERS[messageType];
  return handler ? handler(deps, message) : null;
};

/**
 * Fetches one authorized account's real on-chain transaction history for the feed.
 * Degrades honestly: with no history source wired or no
 * tracked tokens it yields an empty list with `unavailable: false`, so the feed
 * shows the local log without a false "offline" indicator; a thrown transport
 * error sets `unavailable` so the caller can surface that the history could not
 * be reached.
 */
const accountHistory = async (
  deps: WalletOpsDeps,
  context: {
    readonly accountId: string;
    readonly address: string;
    readonly networkId: StarknetNetworkId;
  },
): Promise<{ readonly onChain: readonly ActivityEntry[]; readonly unavailable: boolean }> => {
  const scan = deps.runtimeRpc.getTransactionHistory;
  if (!scan) {
    return { onChain: [], unavailable: false };
  }
  const preferences = await deps.preferencesStore.read();
  const tokens = preferences.tokens.filter((token) => token.networkId === context.networkId);
  if (tokens.length === 0) {
    return { onChain: [], unavailable: false };
  }
  try {
    const onChain = await scan({
      account: context.address,
      accountId: context.accountId,
      networkId: context.networkId,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
      tokens,
    });
    return { onChain, unavailable: false };
  } catch {
    return { onChain: [], unavailable: true };
  }
};

const activityTarget = async (
  deps: WalletOpsDeps,
  context: { readonly account: AccountRef; readonly networkId: StarknetNetworkId },
  requestedAccountId: string | undefined,
): Promise<{
  readonly accountId: string;
  readonly address: string;
  readonly networkId: StarknetNetworkId;
  readonly scope: ActivityScope;
} | null> => {
  if (requestedAccountId === undefined || requestedAccountId === context.account.id) {
    return {
      accountId: context.account.id,
      address: context.account.address,
      networkId: context.networkId,
      scope: { accountId: context.account.id, networkId: context.networkId },
    };
  }
  const record = (await deps.multisigStore?.listMultisigs())?.find(
    (stored) =>
      stored.id === requestedAccountId &&
      stored.networkId === context.networkId &&
      stored.signers.some((signer) => sameFelt(signer, context.account.address)),
  );
  return record
    ? {
        accountId: record.id,
        address: record.address,
        networkId: record.networkId,
        scope: { accountId: record.id, networkId: record.networkId },
      }
    : null;
};
