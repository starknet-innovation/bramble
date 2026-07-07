/**
 * dApp-facing provider operations dispatched from the background message
 * handler: origin permission queries, watch-asset requests, and per-transaction
 * invoke prompts. These reach the background from the content bridge, so each
 * verifies the claimed origin and re-checks the phishing blocklist — a blocked
 * origin gets nothing back even if it still holds an old connection grant.
 */
import { isBlockedOrigin } from "../security/blocklist";
import { STARKNET_NETWORKS } from "../starknet/networks";
import { verifyCalls } from "../starknet/verify";
import type { ActivityLog } from "../storage/activity-store";
import type { AllowanceStore } from "../storage/allowance-store";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import { recordApproveAllowances } from "./allowance-ops";
import type { ApprovalPayload, ApprovalQueue } from "./approvals";
import { readAddInvokeTransactionInput } from "./message-inputs";
import { readGetPermissionsInput, readWatchAssetInput } from "./provider-inputs";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { UnlockSession } from "./session";
import { canonicalTokenAddress, watchAssetToken } from "./watch-asset";

/**
 * Dependencies shared by the dapp provider operation handlers.
 */
export type ProviderOpsDeps = {
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Dependencies needed to execute a held invoke approval once the user signs off.
 */
export type InvokeExecuteDeps = {
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Handles dapp permission, watch-asset, and invoke messages; returns null for
 * others. Invoke requests are never auto-submitted: they are decoded and queued
 * as an approval so the user can review the calls before anything is signed.
 */
export const handleProviderOps = async (
  deps: ProviderOpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  const { approvals, extensionId, preferencesStore, runtimeRpc, session, wallet } = deps;

  if (messageType === "wallet.getPermissions") {
    const input = readGetPermissionsInput(message);
    if (!input) {
      return { error: "invalid permissions request" };
    }
    if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
      return { error: "sender origin mismatch" };
    }
    if (isBlockedOrigin(input.origin)) {
      return { ok: true, permissions: [] };
    }
    const passphrase = session.getPassphrase();
    const granted = passphrase ? await wallet.getGrantedAccounts(input.origin, passphrase) : [];
    return { ok: true, permissions: granted.length > 0 ? ["accounts"] : [] };
  }

  if (messageType === "wallet.watchAsset") {
    const input = readWatchAssetInput(message);
    if (!input) {
      return { error: "invalid watch asset request" };
    }
    if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
      return { error: "sender origin mismatch" };
    }
    if (isBlockedOrigin(input.origin)) {
      return { error: "origin blocked" };
    }
    const preferences = await preferencesStore.read();
    const networkId = preferences.activeNetworkId;
    const normalizedAddress = canonicalTokenAddress(input.asset.address);
    const alreadyTracked = preferences.tokens.some(
      (token) =>
        token.networkId === networkId && canonicalTokenAddress(token.address) === normalizedAddress,
    );
    if (alreadyTracked) {
      return { ok: true, watched: true };
    }
    const metadata = await runtimeRpc
      .getTokenMetadata({
        address: input.asset.address,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], preferences),
      })
      .catch(() => null);
    const token = watchAssetToken(input.asset, metadata, networkId);
    if (!token) {
      return { error: "invalid watch asset metadata" };
    }
    return { ok: false, pending: approvals.requestWatchAsset({ origin: input.origin, token }) };
  }

  if (messageType === "wallet.addInvokeTransaction") {
    const input = readAddInvokeTransactionInput(message);
    if (!input) {
      return { error: "invalid invoke request" };
    }
    if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
      return { error: "sender origin mismatch" };
    }
    if (isBlockedOrigin(input.origin)) {
      return { error: "origin blocked" };
    }
    const passphrase = session.getPassphrase();
    if (!passphrase) {
      return { error: "wallet locked" };
    }
    const preferences = await preferencesStore.read();
    const granted = await wallet.getGrantedAccounts(input.origin, passphrase);
    const account = granted.find((stored) => stored.networkId === preferences.activeNetworkId);
    if (!account) {
      return { error: "origin not connected" };
    }
    const report = verifyCalls(input.calls, {
      account,
      addressBook: preferences.addressBook,
      tokens: preferences.tokens,
    });
    return {
      ok: false,
      pending: approvals.requestInvoke({
        calls: input.calls,
        flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
        origin: input.origin,
        summaries: report.calls.map((call) => call.summary),
      }),
    };
  }

  return null;
};

/**
 * Executes a user-approved invoke: re-resolves the currently active account for
 * the origin (a locked wallet or a revoked grant fails safely), submits the held
 * calls, and records the transaction and any approvals. Returns an error
 * response instead of throwing so the caller can keep the approval queued.
 */
export const executeInvokeApproval = async (
  deps: InvokeExecuteDeps,
  approval: { readonly origin: string; readonly payload: ApprovalPayload },
): Promise<RuntimeResponse> => {
  const { activity, allowanceStore, preferencesStore, runtimeRpc, session, wallet } = deps;
  const calls = approval.payload.calls;
  if (!calls) {
    return { error: "approval not found" };
  }
  const passphrase = session.getPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await preferencesStore.read();
  const granted = await wallet.getGrantedAccounts(approval.origin, passphrase);
  const account = granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    return { error: "origin not connected" };
  }
  const result = await runtimeRpc.submitInvokeTransaction({
    account,
    calls,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
    signHash: (messageHash) =>
      wallet.signHash({ accountId: account.id, messageHash, vaultPassphrase: passphrase }),
  });
  await activity.record({
    accountId: account.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: account.networkId,
    summary: `${approval.origin} submitted ${calls.length} call${calls.length === 1 ? "" : "s"}`,
  });
  await recordApproveAllowances(allowanceStore, calls, account);
  return { ok: true, transactionHash: result.transactionHash };
};
