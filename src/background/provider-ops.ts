/**
 * dApp-facing provider operations dispatched from the background message
 * handler: origin permission queries, watch-asset requests, and per-transaction
 * invoke prompts. These reach the background from the content bridge, so each
 * verifies the claimed origin and re-checks the phishing blocklist — a blocked
 * origin gets nothing back even if it still holds an old connection grant.
 */
import type { Call } from "starknet";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "../security/blocklist";
import { walletErrorMessage } from "../shared/errors";
import { resolveFeeAffordability } from "../starknet/fee-funds";
import { STARKNET_NETWORKS } from "../starknet/networks";
import type { FeeEstimate } from "../starknet/rpc";
import { verifyCalls } from "../starknet/verify";
import type { ActivityLog } from "../storage/activity-store";
import type { AllowanceStore } from "../storage/allowance-store";
import type { WalletPreferences, WalletPreferencesStore } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { accountHashSigner } from "./account-hash-signer";
import { recordApproveAllowances } from "./allowance-ops";
import { type ApprovalContext, createApprovalContext } from "./approval-context";
import { notifyApprovalsChanged } from "./approval-notifier";
import type { ApprovalPayload, ApprovalQueue, InvokeFeeReview } from "./approvals";
import { readStrkBalance } from "./fee-guard";
import type { LedgerSignQueue } from "./ledger-sign-queue";
import { readAddInvokeTransactionInput } from "./message-inputs";
import {
  readGetPermissionsInput,
  readRetryApprovalFeeInput,
  readWatchAssetInput,
} from "./provider-inputs";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { UnlockSession } from "./session";
import type { SignatureWaiters } from "./signature-waiters";
import { resolveReviewFee, verificationContext } from "./wallet-ops";
import type { WalletStatusReader } from "./wallet-reader";
import { canonicalTokenAddress, watchAssetToken } from "./watch-asset";

/**
 * Dependencies shared by the dapp provider operation handlers.
 */
export type ProviderOpsDeps = {
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly guard?: OriginGuard;
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial
   * test stubs stay valid. Production invoke estimation skips account
   * validation and does not call this queue; the seam remains part of the RPC
   * input shape shared with submit paths and narrow test doubles.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
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
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial test
   * stubs stay valid; a Ledger invoke with no queue wired fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
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
  expected?: ApprovalContext,
): Promise<ResolvedOriginAccount | { readonly error: string }> => {
  const passphrase = deps.session.getPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await deps.preferencesStore.read();
  if (expected && preferences.activeNetworkId !== expected.networkId) {
    return { error: "approval context changed" };
  }
  const granted = await deps.wallet.getGrantedAccounts(origin, passphrase);
  const account = expected
    ? granted.find(
        (stored) =>
          stored.id === expected.accountId &&
          stored.networkId === expected.networkId &&
          stored.networkId === preferences.activeNetworkId,
      )
    : granted.find((stored) => stored.networkId === preferences.activeNetworkId);
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

// Estimates the fee for a queued dapp invoke, mirroring the Send review's
// shape (deployment status → estimate → resolveReviewFee) so both journeys
// classify fee outcomes identically. Nothing is broadcast or signed because
// the RPC estimate skips account validation. Any failure — transport, RPC, or
// signer construction — degrades to a retryable "estimate failed" state.
const estimateInvokeApprovalFee = async (
  deps: Pick<ProviderOpsDeps, "ledgerSignQueue" | "runtimeRpc" | "wallet">,
  resolved: ResolvedOriginAccount,
  calls: readonly Call[],
): Promise<InvokeFeeReview> => {
  const rpcUrls = networkRpcUrls(
    STARKNET_NETWORKS[resolved.account.networkId],
    resolved.preferences,
  );
  let deployed = true;
  try {
    deployed = await deps.runtimeRpc.getDeploymentStatus({
      accountAddress: resolved.account.address,
      rpcUrls,
    });
  } catch {
    deployed = true;
  }
  let estimated: FeeEstimate | null = null;
  if (deployed) {
    try {
      estimated = await deps.runtimeRpc.estimateInvokeFee({
        account: resolved.account,
        calls: [...calls],
        rpcUrls,
        signHash: accountHashSigner(deps, resolved.account, resolved.passphrase),
      });
    } catch {
      estimated = null;
    }
  }
  const { fee, feeEstimateFailed } = resolveReviewFee({ deployed, fee: estimated });
  // Fee-affordability guard (issue 191): compare the estimate against the
  // account's STRK balance via the shared predicate. Warn-only and fail-open —
  // an unreadable balance yields "unknown" and never blocks the approval.
  const feeAffordability = resolveFeeAffordability({
    balance:
      fee === null ? null : await readStrkBalance(deps, resolved.account, resolved.preferences),
    fee,
  });
  return {
    fee,
    feeAffordability,
    feeEstimateFailed,
    feeEstimatePending: false,
    requiresDeployment: !deployed,
  };
};

const PENDING_INVOKE_FEE: InvokeFeeReview = {
  fee: null,
  feeAffordability: "unknown",
  feeEstimateFailed: false,
  feeEstimatePending: true,
  requiresDeployment: false,
};

const FAILED_INVOKE_FEE: InvokeFeeReview = {
  fee: null,
  feeAffordability: "unknown",
  feeEstimateFailed: true,
  feeEstimatePending: false,
  requiresDeployment: false,
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
  // Queue and foreground the request before any network work. Fee estimation
  // can involve deployment, fee, and balance RPCs; awaiting those
  // here previously left the dapp on "Waiting for wallet" with no visible
  // request. Approval remains disabled while this initial estimate is pending.
  const approval = deps.approvals.requestInvoke({
    calls: input.calls,
    context: await createApprovalContext(resolved.account, { calls: input.calls }),
    fee: PENDING_INVOKE_FEE,
    flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
    origin: input.origin,
    summaries: report.calls.map((call) => call.summary),
  });
  notifyApprovalsChanged();
  void estimateInvokeApprovalFee(deps, resolved, input.calls).then(
    (fee) => {
      if (deps.approvals.updateInvokeFee(approval.id, fee)) {
        notifyApprovalsChanged();
      }
    },
    () => {
      if (deps.approvals.updateInvokeFee(approval.id, FAILED_INVOKE_FEE)) {
        notifyApprovalsChanged();
      }
    },
  );
  return deps.waiters.register(approval.id);
};

// Re-estimates the fee for a queued invoke approval on the panel's request
// (the retry affordance on the approval card). Privileged-sender only — the
// message type is not dapp-reachable. Re-resolves the origin's account against
// the approval's pinned context so a network or account switch since queueing
// fails safely instead of estimating against the wrong account.
const handleRetryApprovalFee: ProviderOpsHandler = async (deps, message) => {
  const input = readRetryApprovalFeeInput(message);
  if (!input) {
    return { error: "invalid fee retry request" };
  }
  const approval = deps.approvals.get(input.id);
  const payload = deps.approvals.payload(input.id);
  if (approval?.kind !== "invoke" || !payload?.calls) {
    return { error: "approval not found" };
  }
  const resolved = await resolveOriginAccount(deps, approval.origin, approval.context);
  if ("error" in resolved) {
    return resolved;
  }
  if (!deps.approvals.updateInvokeFee(input.id, PENDING_INVOKE_FEE)) {
    return { error: "approval not found" };
  }
  notifyApprovalsChanged();
  const fee = await estimateInvokeApprovalFee(deps, resolved, payload.calls).catch(
    () => FAILED_INVOKE_FEE,
  );
  if (!deps.approvals.updateInvokeFee(input.id, fee)) {
    return { error: "approval not found" };
  }
  notifyApprovalsChanged();
  return { ok: true };
};

/**
 * Dispatch table for dapp provider messages, keyed by message type. Each branch
 * is a self-contained handler, leaving the router a pure lookup.
 */
const PROVIDER_OPS_HANDLERS: Readonly<Record<string, ProviderOpsHandler>> = {
  "wallet.addInvokeTransaction": handleAddInvokeTransaction,
  "wallet.getPermissions": handleGetPermissions,
  "wallet.retryApprovalFee": handleRetryApprovalFee,
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
  approval: {
    readonly context?: ApprovalContext;
    readonly origin: string;
    readonly payload: ApprovalPayload;
  },
): Promise<RuntimeResponse> => {
  const { activity, allowanceStore, runtimeRpc } = deps;
  const calls = approval.payload.calls;
  if (!calls) {
    return { error: "approval not found" };
  }
  const resolved = await resolveOriginAccount(deps, approval.origin, approval.context);
  if ("error" in resolved) {
    return resolved;
  }
  const { account, passphrase, preferences } = resolved;
  // A keyless Ledger account signs on the device (verified against publicKeyX),
  // every other account through the vault — the same seam the wallet-initiated
  // paths use. A device rejection/timeout/verify-failure, or a Ledger account
  // with no queue wired, throws a WalletError from the sign path: catch it and
  // return `{ error }` (mirroring executeStrk20InvokeApproval) so the applier
  // settles the held dapp request with the real reason instead of leaving it to
  // hang on an unhandled throw. Fails closed — nothing is submitted on error.
  try {
    const result = await runtimeRpc.submitInvokeTransaction({
      account,
      calls,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
      signHash: accountHashSigner(deps, account, passphrase),
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
  } catch (error) {
    return { error: walletErrorMessage(error, "invoke request failed") };
  }
};
