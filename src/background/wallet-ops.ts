/**
 * RPC-heavy wallet operations dispatched from the background message handler:
 * balances, deployment, transfer review and submission, and the activity feed.
 */
import { STARKNET_NETWORKS, type StarknetNetworkId } from "../starknet/networks";
import { buildErc20TransferCall, type FeeEstimate, parseTokenAmount } from "../starknet/rpc";
import { mergeActivity } from "../starknet/tx-history";
import { verifyCalls } from "../starknet/verify";
import type { ActivityEntry, ActivityLog } from "../storage/activity-store";
import type { AllowanceStore } from "../storage/allowance-store";
import type { WalletPreferences, WalletPreferencesStore } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { readReviewTransferInput, readTransferInput, readTypeOnlyInput } from "./message-inputs";
import type { RuntimeRpc } from "./runtime-rpc";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import type { UnlockSession } from "./session";

/**
 * Dependencies shared by the wallet, allowance, and NFT operations handlers.
 */
export type WalletOpsDeps = {
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
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
) => signerFor(deps, context.account, context.vaultPassphrase);

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

const signerFor =
  (deps: WalletOpsDeps, account: AccountRef, vaultPassphrase: string) => (messageHash: string) =>
    deps.wallet.signHash({ accountId: account.id, messageHash, vaultPassphrase });

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

/**
 * Handles wallet operation messages; returns null for other message types.
 */
export const handleWalletOps = async (
  deps: WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const { activity, preferencesStore, runtimeRpc } = deps;

  if (messageType === "wallet.getBalances") {
    if (!readTypeOnlyInput(message, "wallet.getBalances")) {
      return { error: "invalid balances request" };
    }
    const context = await activeAccountContext(deps.wallet, deps.session, preferencesStore);
    if (context.error !== undefined) {
      return { error: context.error };
    }
    const preferences = await preferencesStore.read();
    const network = STARKNET_NETWORKS[context.networkId];
    const balances = await runtimeRpc.getTokenBalances({
      accountAddress: context.account.address,
      rpcUrls: networkRpcUrls(network, preferences),
      tokens: preferences.tokens.filter((token) => token.networkId === network.id),
    });
    return { accountId: context.account.id, balances, networkId: network.id, ok: true };
  }

  if (messageType === "wallet.deploymentStatus") {
    if (!readTypeOnlyInput(message, "wallet.deploymentStatus")) {
      return { error: "invalid deployment status request" };
    }
    const context = await activeAccountContext(deps.wallet, deps.session, preferencesStore);
    if (context.error !== undefined) {
      return { error: context.error };
    }
    const deployed = await runtimeRpc.getDeploymentStatus({
      accountAddress: context.account.address,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], await preferencesStore.read()),
    });
    return { accountId: context.account.id, deployed, ok: true };
  }

  if (messageType === "wallet.verifyClassHash") {
    if (!readTypeOnlyInput(message, "wallet.verifyClassHash")) {
      return { error: "invalid class hash verification request" };
    }
    const context = await activeAccountContext(deps.wallet, deps.session, preferencesStore);
    if (context.error !== undefined) {
      return { error: context.error };
    }
    if (!runtimeRpc.verifyAccountClassHash) {
      return { error: "class hash verification unavailable" };
    }
    const verification = await runtimeRpc.verifyAccountClassHash({
      accountAddress: context.account.address,
      expectedClassHash: context.account.classHash,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], await preferencesStore.read()),
    });
    return { accountId: context.account.id, ok: true, verification };
  }

  if (messageType === "wallet.deployAccount") {
    if (!readTypeOnlyInput(message, "wallet.deployAccount")) {
      return { error: "invalid deploy account request" };
    }
    const context = await activeAccountContext(deps.wallet, deps.session, preferencesStore);
    if (context.error !== undefined) {
      return { error: context.error };
    }
    const { account, networkId, vaultPassphrase } = context;
    const result = await runtimeRpc.submitAccountDeployment({
      account,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], await preferencesStore.read()),
      signHash: signerFor(deps, account, vaultPassphrase),
    });
    await activity.record({
      accountId: account.id,
      hash: result.transactionHash,
      kind: "deploy",
      networkId,
      summary: "Deploy account contract",
    });
    return { ok: true, transactionHash: result.transactionHash };
  }

  if (messageType === "wallet.reviewTransfer") {
    const input = readReviewTransferInput(message);
    if (!input) {
      return { error: "invalid transfer review request" };
    }
    const context = await transferContext(deps, input);
    if ("error" in context) {
      return { error: context.error };
    }
    const { account, preferences, token, vaultPassphrase } = context;
    const call = buildErc20TransferCall(
      token.address,
      input.recipient,
      parseTokenAmount(input.amount, token.decimals),
    );
    const report = verifyCalls([call], verificationContext(account, preferences));
    const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences);
    const deployed = await runtimeRpc
      .getDeploymentStatus({ accountAddress: account.address, rpcUrls })
      .catch(() => true);
    const estimated = deployed
      ? await runtimeRpc
          .estimateInvokeFee({
            account,
            calls: [call],
            rpcUrls,
            signHash: signerFor(deps, account, vaultPassphrase),
          })
          .catch(() => null)
      : null;
    const { fee, feeEstimateFailed } = resolveReviewFee({ deployed, fee: estimated });
    return {
      ok: true,
      review: {
        fee,
        feeEstimateFailed,
        flags: report.flags,
        requiresDeployment: !deployed,
        summaries: report.calls.map((decoded) => decoded.summary),
      },
    };
  }

  if (messageType === "wallet.transfer") {
    const input = readTransferInput(message);
    if (!input) {
      return { error: "invalid transfer request" };
    }
    const context = await transferContext(deps, input);
    if ("error" in context) {
      return { error: context.error };
    }
    const { account, preferences, token, vaultPassphrase } = context;
    const result = await runtimeRpc.submitErc20Transfer({
      account,
      amount: input.amount,
      recipient: input.recipient,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
      signHash: signerFor(deps, account, vaultPassphrase),
      speed: input.speed,
      token,
    });
    const report = verifyCalls([result.call], verificationContext(account, preferences));
    await activity.record({
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
  }

  if (messageType === "wallet.activity") {
    if (!readTypeOnlyInput(message, "wallet.activity")) {
      return { error: "invalid activity request" };
    }
    const local = await reconcilePendingStatuses(deps);
    const history = await activeAccountHistory(deps);
    return {
      activity: mergeActivity(local, history.onChain),
      ...(history.unavailable ? { historyUnavailable: true } : {}),
      ok: true,
    };
  }

  return null;
};

/**
 * Re-polls the chain status of every locally recorded pending transaction, per
 * network, and returns the reconciled local activity log. A status query that
 * fails leaves those hashes pending rather than dropping them.
 */
const reconcilePendingStatuses = async (deps: WalletOpsDeps): Promise<readonly ActivityEntry[]> => {
  const { activity, preferencesStore, runtimeRpc } = deps;
  const entries = await activity.list();
  const pendingByNetwork = new Map<StarknetNetworkId, string[]>();
  for (const entry of entries) {
    if (entry.status === "pending") {
      pendingByNetwork.set(entry.networkId, [
        ...(pendingByNetwork.get(entry.networkId) ?? []),
        entry.hash,
      ]);
    }
  }
  if (pendingByNetwork.size === 0) {
    return entries;
  }
  const preferences = await preferencesStore.read();
  let statuses: Record<string, ActivityEntry["status"]> = {};
  for (const [networkId, hashes] of pendingByNetwork) {
    const result = await runtimeRpc
      .getTransactionStatuses({
        hashes,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], preferences),
      })
      .catch(() => ({}));
    statuses = { ...statuses, ...result };
  }
  return activity.updateStatuses(statuses);
};

/**
 * Fetches the active account's real on-chain transaction history for the feed.
 * Degrades honestly: with no history source wired, no active account, or no
 * tracked tokens it yields an empty list with `unavailable: false`, so the feed
 * shows the local log without a false "offline" indicator; a thrown transport
 * error sets `unavailable` so the caller can surface that the history could not
 * be reached.
 */
const activeAccountHistory = async (
  deps: WalletOpsDeps,
): Promise<{ readonly onChain: readonly ActivityEntry[]; readonly unavailable: boolean }> => {
  const scan = deps.runtimeRpc.getTransactionHistory;
  if (!scan) {
    return { onChain: [], unavailable: false };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { onChain: [], unavailable: false };
  }
  const preferences = await deps.preferencesStore.read();
  const tokens = preferences.tokens.filter((token) => token.networkId === context.networkId);
  if (tokens.length === 0) {
    return { onChain: [], unavailable: false };
  }
  try {
    const onChain = await scan({
      account: context.account.address,
      accountId: context.account.id,
      networkId: context.networkId,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
      tokens,
    });
    return { onChain, unavailable: false };
  } catch {
    return { onChain: [], unavailable: true };
  }
};
