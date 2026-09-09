/** Dapp provider operations validate origin and phishing policy on every request. */

import { walletErrorMessage } from "@bramble/core/errors";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import { mapStrk20StageError } from "@bramble/privacy/official-sdk-errors";
import { unavailableStrk20Service } from "@bramble/privacy/service";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { FeeEstimate } from "@bramble/starknet/rpc";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { AllowanceStore } from "@bramble/transactions/allowance-store";
import { standingAllowanceTotals } from "@bramble/transactions/allowances";
import {
  refuseOnAccountSelfCall,
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { type ApprovalContext, createApprovalContext } from "../approvals/approval-context";
import { requireApprovalAdmission } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalPayload, ApprovalQueue, PendingApproval } from "../approvals/approvals";
import {
  estimateInvokeApprovalFee,
  FAILED_INVOKE_FEE,
  PENDING_INVOKE_FEE,
} from "../approvals/invoke-fee-review";
import { type ResolvedOriginAccount, resolveOriginAccount } from "./provider-grant";

/** Re-exports the grant-resolution surface from its size-budget split. */
export type { ResolvedOriginAccount } from "./provider-grant";

import type { SignatureWaiters } from "../approvals/signature-waiters";
import { accountHashSigner } from "../ledger/account-hash-signer";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { strk20AccountContext } from "../privacy/strk20-account-context";
import { readAddInvokeTransactionInput } from "../routing/message-inputs";
import { isClaimedSenderOrigin, type RuntimeSender } from "../routing/senders";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type PassiveUnlockSession } from "../runtime/session";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import {
  readGetPermissionsInput,
  readRetryApprovalFeeInput,
  readWatchAssetInput,
} from "./provider-inputs";
import { trackWatchAsset, type WatchAssetAdmission } from "./watch-asset";

/**
 * Dependencies shared by the dapp provider operation handlers.
 */
export type ProviderOpsDeps = {
  /**
   * Allowance log, read (never written) here: it is what the pre-sign review
   * knows already stands for a `(token, spender)` pair, so an increase is judged
   * against the grant beneath it rather than on its own.
   */
  readonly allowanceStore: AllowanceStore;
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly guard?: OriginGuard;
  /**
   * Optional panel round-trip queue for keyless Ledger accounts. Production
   * invoke estimation does not call it; Ledger submission fails closed without it.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  /**
   * Non-renewing session view: a dapp polls these handlers on its own cadence,
   * so a passphrase read here must never extend the inactivity limit.
   */
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
  readonly waiters: SignatureWaiters;
  /** Bounds and deduplicates metadata work before a watch-asset approval exists. */
  readonly watchAssetAdmission: WatchAssetAdmission;
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
  /**
   * Non-renewing session view: the user's approval click already renewed the
   * window, so executing the held calls must not renew it for the dapp.
   */
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
};

const feeReviewTarget = (
  deps: Pick<ProviderOpsDeps, "ledgerSignQueue" | "session" | "wallet">,
  resolved: ResolvedOriginAccount,
  calls: readonly Call[],
  proof?: ApprovalPayload["proof"],
) => ({
  account: resolved.account,
  calls,
  preferences: resolved.preferences,
  ...(proof ? { proof } : {}),
  signer: () => accountHashSigner(deps, resolved.account, resolved.passphrase),
});

/**
 * Queues an exact invoke/proof batch and starts its fail-closed fee review.
 * Used both by wallet_addInvokeTransaction and the second stage of approved
 * public STRK20 operations so their reviewed and submitted calls cannot drift.
 */
export const queueInvokeApproval = async (
  deps: Pick<
    ProviderOpsDeps,
    "allowanceStore" | "approvals" | "ledgerSignQueue" | "runtimeRpc" | "session" | "wallet"
  >,
  resolved: ResolvedOriginAccount,
  input: {
    readonly calls: readonly Call[];
    readonly origin: string;
    readonly proof?: ApprovalPayload["proof"];
  },
): Promise<{ readonly approval: PendingApproval } | RuntimeResponse> => {
  requireApprovalAdmission(deps.approvals, input.origin);
  const trusted = verificationContext(resolved.account, resolved.preferences);
  const standing = standingAllowanceTotals(
    await deps.allowanceStore.list().catch(() => []),
    allowanceOwner(resolved.account),
    trusted,
  );
  const report = verifyCalls(input.calls, trusted, standing);
  const refusal =
    refuseOnAccountSelfCall(input.calls, resolved.account.address) ??
    refuseOnPoisonedRecipient(report);
  if (refusal) {
    return refusal;
  }
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
    reviewAssets: trusted.tokens
      .filter((token) => input.calls.some((call) => sameFelt(call.contractAddress, token.address)))
      .map((token) => ({ address: token.address, symbol: token.symbol })),
    summaries: report.calls.map((call) => call.summary),
  });
  notifyApprovalsChanged();
  const revision = deps.approvals.beginFeeEstimate(approval.id);
  if (revision) {
    void estimateInvokeApprovalFee(
      deps,
      feeReviewTarget(deps, resolved, input.calls, input.proof),
    ).then(
      (fee) => {
        if (deps.approvals.updateFee(revision, { kind: "invoke", review: fee })) {
          notifyApprovalsChanged();
        }
      },
      () => {
        if (deps.approvals.updateFee(revision, { kind: "invoke", review: FAILED_INVOKE_FEE })) {
          notifyApprovalsChanged();
        }
      },
    );
  }
  return { approval };
};

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
) => Promise<RuntimeResponse | null>;

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
  // Peek, never renew: a permission query is a passive read a page can issue on
  // a timer, so it must not extend the unlock lifetime.
  const passphrase = deps.session.peekPassphrase();
  const authorized = captureSessionAuthorization(deps.session);
  const granted = passphrase ? await deps.wallet.getGrantedAccounts(input.origin, passphrase) : [];
  if (passphrase && !authorized.isCurrent()) return { error: "wallet locked" };
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
  const approval = await trackWatchAsset(
    {
      admission: deps.watchAssetAdmission,
      approvals: deps.approvals,
      preferencesStore: deps.preferencesStore,
      runtimeRpc: deps.runtimeRpc,
    },
    input,
  );
  if (approval === true) return { ok: true, watched: true };
  return approval ? deps.waiters.register(approval.id) : { error: "invalid watch asset metadata" };
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
  // Refused before the vault read and the decode below: an invoke prompt never
  // deduplicates, so an origin already holding its full share of the queue is
  // getting this request refused at admission whatever the calls turn out to be.
  requireApprovalAdmission(deps.approvals, input.origin);
  const resolved = await resolveOriginAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  const queued = await queueInvokeApproval(deps, resolved, input);
  return "approval" in queued ? deps.waiters.register(queued.approval.id) : queued;
};

// Re-estimates a queued invoke against its pinned account and network.
const handleRetryApprovalFee: ProviderOpsHandler = async (deps, message) => {
  const input = readRetryApprovalFeeInput(message);
  if (!input) {
    return { error: "invalid fee retry request" };
  }
  const approval = deps.approvals.get(input.id);
  const payload = deps.approvals.payload(input.id);
  if (approval?.kind === "declare") {
    return null;
  }
  if (approval?.kind !== "invoke" || !payload?.calls) {
    return { error: "approval not found" };
  }
  const resolved = await resolveOriginAccount(deps, approval.origin, approval.context);
  if ("error" in resolved) {
    return resolved;
  }
  // Only the newest concurrent retry may update the card.
  const revision = deps.approvals.beginFeeEstimate(input.id);
  if (
    !revision ||
    !deps.approvals.updateFee(revision, { kind: "invoke", review: PENDING_INVOKE_FEE })
  ) {
    return { error: "approval not found" };
  }
  notifyApprovalsChanged();
  const fee = await estimateInvokeApprovalFee(
    deps,
    feeReviewTarget(deps, resolved, payload.calls, payload.proof),
  ).catch(() => FAILED_INVOKE_FEE);
  if (!deps.approvals.updateFee(revision, { kind: "invoke", review: fee })) {
    return { error: "a newer fee estimate replaced this one" };
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
  const handler = Object.hasOwn(PROVIDER_OPS_HANDLERS, messageType)
    ? PROVIDER_OPS_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, message, sender) : null;
};

/**
 * Executes a user-approved invoke: re-resolves the currently active account for
 * the origin (a locked wallet or a revoked grant fails safely), submits the held
 * calls, and records the transaction and any approvals. Returns an error
 * response instead of throwing so the caller can keep the approval queued.
 *
 * `reviewedFee` is the estimate the approval card was showing when the user
 * approved. It travels into the submit boundary as a signing ceiling, so a
 * transaction whose cost has moved past it since the review is refused rather
 * than signed — the site that asked for the call also controls state the call's
 * gas can depend on, and can move it while the card is open.
 */
export const executeInvokeApproval = async (
  deps: InvokeExecuteDeps,
  approval: {
    readonly context?: ApprovalContext;
    readonly origin: string;
    readonly payload: ApprovalPayload;
    readonly reviewedFee?: FeeEstimate;
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
  const { account, preferences } = resolved;
  const authorized = captureSessionAuthorization(deps.session);
  // The recipient policy is re-applied to the exact calls that are about to be
  // broadcast, not only to the ones that were queued: the address book can gain
  // a contact while the prompt sits open, and a payee that mimics it becomes a
  // lookalike only at that moment. Same shared gate as the queue-time check
  // above and as the post-consent check the STRK20 executor applies, so a
  // decision the user made against one trusted set is never carried out against
  // another. Refusal, not annotation — nothing is submitted.
  const refusal =
    refuseOnAccountSelfCall(calls, account.address) ??
    refuseOnPoisonedRecipient(verifyCalls(calls, verificationContext(account, preferences)));
  if (refusal) {
    return refusal;
  }
  // A keyless Ledger account signs on the device (verified against publicKeyX),
  // every other account through the vault — the same seam the wallet-initiated
  // paths use. A device rejection/timeout/verify-failure, or a Ledger account
  // with no queue wired, throws a WalletError from the sign path: catch it and
  // return `{ error }` (mirroring executeStrk20InvokeApproval) so the applier
  // settles the held request with the reason. Fails closed — nothing submitted.
  // Spread into whichever submit lane runs: the ceiling is a property of the
  // approval, not of the lane, so it is decided once here rather than at each.
  const ceiling = approval.reviewedFee ? { reviewedFee: approval.reviewedFee } : {};
  const strk20 = runtimeRpc.strk20 ?? unavailableStrk20Service;
  try {
    const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences);
    // One protected-account boundary for both lanes. The signing thunk and the
    // viewing-key thunk are built there, bound to the unlock that authorized
    // this approval, so a lock between the click and the broadcast revokes both
    // — a second local viewing-key reader here was the one copy that derived a
    // key for an already-locked wallet.
    const context = strk20AccountContext(deps, { ...resolved, rpcUrls });
    const result = approval.payload.proof
      ? await strk20.submitPrepared({
          ...context,
          calls,
          proof: approval.payload.proof,
          ...ceiling,
        })
      : await runtimeRpc.submitInvokeTransaction({
          account,
          calls,
          ...ceiling,
          isAuthorized: authorized.isCurrent,
          rpcUrls,
          signHash: context.signHash,
        });
    // Recorded before the activity line: see ./allowance-recording.
    await recordApproveAllowances({
      assets: verificationContext(account, preferences),
      calls,
      owner: allowanceOwner(account),
      store: allowanceStore,
    });
    await recordSubmittedActivity(activity, {
      accountId: account.id,
      hash: result.transactionHash,
      kind: "invoke",
      networkId: account.networkId,
      summary: `${approval.origin} submitted ${calls.length} call${calls.length === 1 ? "" : "s"}`,
    });
    return { ok: true, transactionHash: result.transactionHash };
  } catch (error) {
    return { error: invokeFailureMessage(error, approval.payload.proof !== undefined) };
  }
};
