/**
 * dApp-facing provider operations dispatched from the background message
 * handler: origin permission queries, watch-asset requests, and per-transaction
 * invoke prompts. These reach the background from the content bridge, so each
 * verifies the claimed origin and re-checks the phishing blocklist — a blocked
 * origin gets nothing back even if it still holds an old connection grant.
 */

import { errorDetail, walletErrorMessage } from "@mc-wallet/core/errors";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { canonicalFelt, STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { Call } from "starknet";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@mc-wallet/permissions/blocklist";
import { resolveFeeAffordability } from "@mc-wallet/transactions/fee-funds";
import type { FeeEstimate } from "@mc-wallet/starknet/rpc";
import { mapStrk20StageError } from "@mc-wallet/privacy/official-sdk-errors";
import { unavailableStrk20Service } from "@mc-wallet/privacy/service";
import { verifyCalls } from "@mc-wallet/transactions/verify";
import type { ActivityLog } from "@mc-wallet/transactions/activity";
import type { AllowanceStore } from "@mc-wallet/transactions/allowance-store";
import type { WalletPreferences, WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import { accountHashSigner } from "../ledger/account-hash-signer";
import { recordApproveAllowances } from "../portfolio/allowance-ops";
import { type ApprovalContext, createApprovalContext } from "../approvals/approval-context";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalPayload, ApprovalQueue, InvokeFeeReview } from "../approvals/approvals";
import { readStrkBalance } from "../transactions/fee-guard";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { readAddInvokeTransactionInput } from "../routing/message-inputs";
import {
  readGetPermissionsInput,
  readRetryApprovalFeeInput,
  readWatchAssetInput,
} from "./provider-inputs";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "../routing/senders";
import type { UnlockSession } from "../runtime/session";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import { FEE_ESTIMATE_SUMMARY, resolveReviewFee, verificationContext } from "../accounts/wallet-ops";
import type { WalletStatusReader } from "../accounts/wallet-reader";
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

// Curated, dapp-safe message for a failed invoke. For a plain invoke the node's
// own reason is carried separately as `detail` at the call site: an underfunded
// fee collapses to "invoke request failed" here, which is right for the page and
// useless to the user, and `settleExecutor` keeps `detail` from reaching the
// dapp. A proof-bearing failure gets no `detail` at all — see the call site.
const invokeFailureMessage = (error: unknown, hasProof: boolean): string => {
  if (!hasProof) {
    return walletErrorMessage(error, "invoke request failed");
  }
  try {
    mapStrk20StageError("submission", error);
  } catch (mapped) {
    return walletErrorMessage(mapped, "invoke request failed");
  }
  return "invoke request failed";
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
  // The node's own reason for a rejected estimate. Without it the panel can only
  // blame the connection, which is wrong for the common case: `skipValidate`
  // skips `__validate__` but still executes the calls, so a dapp transaction
  // that would revert on-chain fails here for a reason only the node knows.
  let estimateDetail: string | null = null;
  if (deployed) {
    try {
      estimated = await deps.runtimeRpc.estimateInvokeFee({
        account: resolved.account,
        calls: [...calls],
        rpcUrls,
        signHash: accountHashSigner(
          deps,
          resolved.account,
          resolved.passphrase,
          "dapp-transaction",
        ),
      });
    } catch (error) {
      estimated = null;
      estimateDetail = errorDetail(error, FEE_ESTIMATE_SUMMARY);
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
    // Only carried alongside a failure the user can act on; a recovered estimate
    // never ships a stale reason.
    ...(feeEstimateFailed && estimateDetail !== null
      ? { feeEstimateDetail: estimateDetail }
      : {}),
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
  if (input.proof && input.calls.length !== 1) {
    return { error: "invalid invoke request" };
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
    context: await createApprovalContext(resolved.account, {
      calls: input.calls,
      ...(input.proof === undefined ? {} : { proof: input.proof }),
    }),
    fee: PENDING_INVOKE_FEE,
    flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
    origin: input.origin,
    ...(input.proof === undefined ? {} : { proof: input.proof }),
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
  const preparedCall = calls.length === 1 ? calls[0] : undefined;
  if (approval.payload.proof && !preparedCall) {
    return { error: "invalid prepared strk20 invocation" };
  }
  // A keyless Ledger account signs on the device (verified against publicKeyX),
  // every other account through the vault — the same seam the wallet-initiated
  // paths use. A device rejection/timeout/verify-failure, or a Ledger account
  // with no queue wired, throws a WalletError from the sign path: catch it and
  // return `{ error }` (mirroring executeStrk20InvokeApproval) so the applier
  // settles the held dapp request with the real reason instead of leaving it to
  // hang on an unhandled throw. Fails closed — nothing is submitted on error.
  try {
    const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences);
    // The two branches sign for different reasons, so each builds its own signer:
    // the proof branch broadcasts an already-authorized private action, while the
    // plain branch authorizes the site's calls themselves.
    const result = approval.payload.proof
      ? await (runtimeRpc.strk20 ?? unavailableStrk20Service).submitPrepared({
          account,
          call: preparedCall as Call,
          config: preferences.strk20Networks?.[account.networkId] ?? null,
          proof: approval.payload.proof,
          rpcUrls,
          // This branch performs only the submit half: the site already collected
          // the CallSet authorization when it prepared the proof. Both entries name
          // the broadcast because that is the only signature this path takes.
          signHash: accountHashSigner(deps, account, passphrase, "strk20-broadcast"),
          submitSignHash: accountHashSigner(deps, account, passphrase, "strk20-broadcast"),
          viewingKey: async () => {
            const derive = deps.wallet.deriveStrk20ViewingKey;
            const config = preferences.strk20Networks?.[account.networkId] ?? null;
            const poolAddress = config ? canonicalFelt(config.poolAddress) : null;
            if (!derive || !poolAddress) {
              throw new Error("strk20 services unavailable");
            }
            return derive({
              accountId: account.id,
              chainId: STARKNET_NETWORKS[account.networkId].chainId,
              poolAddress,
              vaultPassphrase: passphrase,
            });
          },
        })
      : await runtimeRpc.submitInvokeTransaction({
          account,
          calls,
          rpcUrls,
          signHash: accountHashSigner(deps, account, passphrase, "dapp-transaction"),
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
    const hasProof = approval.payload.proof !== undefined;
    const message = invokeFailureMessage(error, hasProof);
    // Only a plain invoke may carry the raw reason. A proof-bearing failure is
    // sanitized by `mapStrk20StageError` precisely because the raw error can echo
    // a private request body, so that text must not reach any surface — the
    // structured reason it already produces is the whole story there.
    const detail = hasProof ? null : errorDetail(error, message);
    return detail === null ? { error: message } : { detail, error: message };
  }
};
