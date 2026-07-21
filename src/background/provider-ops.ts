/**
 * dApp-facing provider operations dispatched from the background message
 * handler: origin permission queries, watch-asset requests, and per-transaction
 * invoke prompts. These reach the background from the content bridge, so each
 * verifies the claimed origin and re-checks the phishing blocklist — a blocked
 * origin gets nothing back even if it still holds an old connection grant.
 */
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "../security/blocklist";
import { STARKNET_NETWORKS } from "../starknet/networks";
import { verifyCalls } from "../starknet/verify";
import type { ActivityLog } from "../storage/activity-store";
import type { AllowanceStore } from "../storage/allowance-store";
import type { WalletPreferences, WalletPreferencesStore } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { recordApproveAllowances } from "./allowance-ops";
import { notifyApprovalsChanged } from "./approval-notifier";
import type { ApprovalPayload, ApprovalQueue } from "./approvals";
import { ledgerDappSigningError } from "./ledger-signer";
import { readAddInvokeTransactionInput } from "./message-inputs";
import { readGetPermissionsInput, readWatchAssetInput } from "./provider-inputs";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { UnlockSession } from "./session";
import type { SignatureWaiters } from "./signature-waiters";
import { verificationContext } from "./wallet-ops";
import { canonicalTokenAddress, watchAssetToken } from "./watch-asset";

/**
 * Dependencies shared by the dapp provider operation handlers.
 */
export type ProviderOpsDeps = {
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly guard?: OriginGuard;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
  readonly waiters: SignatureWaiters;
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
 * The active-network account resolved for an origin's live connection grant,
 * together with the passphrase and preferences read while resolving it.
 */
type ResolvedOriginAccount = {
  readonly account: AccountRef;
  readonly passphrase: string;
  readonly preferences: WalletPreferences;
};

/**
 * Dependencies needed to resolve an origin's active-network account. Both the
 * dapp handlers and the held-approval executor satisfy this shape.
 */
type GrantResolverDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

// Resolves the account an origin's grant currently maps to on the active
// network, or an error response the caller returns directly. A locked wallet or
// a revoked grant fails safely. Single source for the dapp handlers and the
// held-invoke executor so the fail-closed ordering never drifts between them.
const resolveOriginAccount = async (
  deps: GrantResolverDeps,
  origin: string,
): Promise<ResolvedOriginAccount | { readonly error: string }> => {
  const passphrase = deps.session.getPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await deps.preferencesStore.read();
  const granted = await deps.wallet.getGrantedAccounts(origin, passphrase);
  const account = granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    return { error: "origin not connected" };
  }
  return { account, passphrase, preferences };
};

// Fail-closed perimeter shared by the dapp surfaces that error on a blocked
// origin: a claimed-origin mismatch or a blocklisted origin yields the error
// response, otherwise null so the caller proceeds.
const gateDappOrigin = (
  deps: Pick<ProviderOpsDeps, "extensionId" | "guard">,
  sender: RuntimeSender | undefined,
  origin: string,
): { readonly error: string } | null => {
  if (!isClaimedSenderOrigin(sender, deps.extensionId, origin)) {
    return { error: "sender origin mismatch" };
  }
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(origin)) {
    return { error: "origin blocked" };
  }
  return null;
};

type ProviderOpsHandler = (
  deps: ProviderOpsDeps,
  message: unknown,
  sender: RuntimeSender | undefined,
) => Promise<RuntimeResponse>;

const handleGetPermissions: ProviderOpsHandler = async (deps, message, sender) => {
  const input = readGetPermissionsInput(message);
  if (!input) {
    return { error: "invalid permissions request" };
  }
  if (!isClaimedSenderOrigin(sender, deps.extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(input.origin)) {
    return { ok: true, permissions: [] };
  }
  const passphrase = deps.session.getPassphrase();
  const granted = passphrase ? await deps.wallet.getGrantedAccounts(input.origin, passphrase) : [];
  return { ok: true, permissions: granted.length > 0 ? ["accounts"] : [] };
};

const handleWatchAsset: ProviderOpsHandler = async (deps, message, sender) => {
  const input = readWatchAssetInput(message);
  if (!input) {
    return { error: "invalid watch asset request" };
  }
  const gate = gateDappOrigin(deps, sender, input.origin);
  if (gate) {
    return gate;
  }
  const preferences = await deps.preferencesStore.read();
  const networkId = preferences.activeNetworkId;
  const normalizedAddress = canonicalTokenAddress(input.asset.address);
  const alreadyTracked = preferences.tokens.some(
    (token) =>
      token.networkId === networkId && canonicalTokenAddress(token.address) === normalizedAddress,
  );
  if (alreadyTracked) {
    return { ok: true, watched: true };
  }
  const metadata = await deps.runtimeRpc
    .getTokenMetadata({
      address: input.asset.address,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], preferences),
    })
    .catch(() => null);
  const token = watchAssetToken(input.asset, metadata, networkId);
  if (!token) {
    return { error: "invalid watch asset metadata" };
  }
  const approval = deps.approvals.requestWatchAsset({ origin: input.origin, token });
  notifyApprovalsChanged();
  return deps.waiters.register(approval.id);
};

const handleAddInvokeTransaction: ProviderOpsHandler = async (deps, message, sender) => {
  const input = readAddInvokeTransactionInput(message);
  if (!input) {
    return { error: "invalid invoke request" };
  }
  const gate = gateDappOrigin(deps, sender, input.origin);
  if (gate) {
    return gate;
  }
  const resolved = await resolveOriginAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  const report = verifyCalls(
    input.calls,
    verificationContext(resolved.account, resolved.preferences),
  );
  const approval = deps.approvals.requestInvoke({
    calls: input.calls,
    flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
    origin: input.origin,
    summaries: report.calls.map((call) => call.summary),
  });
  notifyApprovalsChanged();
  return deps.waiters.register(approval.id);
};

/**
 * Dispatch table for dapp provider messages, keyed by message type. Each branch
 * is a self-contained handler, leaving the router a pure lookup.
 */
const PROVIDER_OPS_HANDLERS: Readonly<Record<string, ProviderOpsHandler>> = {
  "wallet.addInvokeTransaction": handleAddInvokeTransaction,
  "wallet.getPermissions": handleGetPermissions,
  "wallet.watchAsset": handleWatchAsset,
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
  const handler = PROVIDER_OPS_HANDLERS[messageType];
  return handler ? handler(deps, message, sender) : null;
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
  const { activity, allowanceStore, runtimeRpc, wallet } = deps;
  const calls = approval.payload.calls;
  if (!calls) {
    return { error: "approval not found" };
  }
  const resolved = await resolveOriginAccount(deps, approval.origin);
  if ("error" in resolved) {
    return resolved;
  }
  const { account, passphrase, preferences } = resolved;
  const ledgerError = ledgerDappSigningError(account);
  if (ledgerError) {
    return { error: ledgerError };
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
