/** Dapp provider operations validate origin and phishing policy on every request. */

import { walletErrorMessage } from "@mc-wallet/core/errors";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@mc-wallet/permissions/blocklist";
import { mapStrk20StageError } from "@mc-wallet/privacy/official-sdk-errors";
import { unavailableStrk20Service } from "@mc-wallet/privacy/service";
import type { WalletPreferences, WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { FeeEstimate } from "@mc-wallet/starknet/rpc";
import type { ActivityLog } from "@mc-wallet/transactions/activity";
import type { AllowanceStore } from "@mc-wallet/transactions/allowance-store";
import { standingAllowanceTotals } from "@mc-wallet/transactions/allowances";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@mc-wallet/transactions/verify";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { canonicalAddress, STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { Call } from "starknet";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { type ApprovalContext, createApprovalContext } from "../approvals/approval-context";
import { requireApprovalAdmission } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalPayload, ApprovalQueue } from "../approvals/approvals";
import {
  estimateInvokeApprovalFee,
  FAILED_INVOKE_FEE,
  PENDING_INVOKE_FEE,
} from "../approvals/invoke-fee-review";
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
import type { PassiveUnlockSession } from "../runtime/session";
import {
  readGetPermissionsInput,
  readRetryApprovalFeeInput,
  readWatchAssetInput,
} from "./provider-inputs";
import { watchAssetToken } from "./watch-asset";

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
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial
   * test stubs stay valid. Production invoke estimation skips account
   * validation and does not call this queue; the seam remains part of the RPC
   * input shape shared with submit paths and narrow test doubles.
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
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
};

// Resolves the account an origin's grant currently maps to on the active
// network, or an error response the caller returns directly. A locked wallet or
// a revoked grant fails safely. Single source for the dapp handlers and the
// held-invoke executor so the fail-closed ordering never drifts between them.
// Peek, never renew: an origin that keeps calling must not be able to hold the
// wallet unlocked past its inactivity limit.
const resolveOriginAccount = async (
  deps: GrantResolverDeps,
  origin: string,
  expected?: ApprovalContext,
): Promise<ResolvedOriginAccount | { readonly error: string }> => {
  const passphrase = deps.session.peekPassphrase();
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

// Builds the fee-review target from a resolved grant. The signer is constructed
// here, where the vault credential already lives, so the estimator never
// receives one — and it is passed as a thunk so that construction happens inside
// the estimator's own failure handling rather than at the call site.
const feeReviewTarget = (
  deps: Pick<ProviderOpsDeps, "ledgerSignQueue" | "session" | "wallet">,
  resolved: ResolvedOriginAccount,
  calls: readonly Call[],
) => ({
  account: resolved.account,
  calls,
  preferences: resolved.preferences,
  signer: () => accountHashSigner(deps, resolved.account, resolved.passphrase),
});

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
  // Peek, never renew: a permission query is a passive read a page can issue on
  // a timer, so it must not extend the unlock lifetime.
  const passphrase = deps.session.peekPassphrase();
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
  const normalizedAddress = canonicalAddress(input.asset.address);
  const alreadyTracked = preferences.tokens.some(
    (token) =>
      token.networkId === networkId && canonicalAddress(token.address) === normalizedAddress,
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
  // Refused before the vault read and the decode below: an invoke prompt never
  // deduplicates, so an origin already holding its full share of the queue is
  // getting this request refused at admission whatever the calls turn out to be.
  requireApprovalAdmission(deps.approvals, input.origin);
  const resolved = await resolveOriginAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  if (input.proof && input.calls.length !== 1) {
    return { error: "invalid invoke request" };
  }
  const trusted = verificationContext(resolved.account, resolved.preferences);
  // The reviewer's unlimited-approval total starts from what this account has
  // already allowed, not from zero: `increase_allowance(spender, 1)` on top of a
  // standing 2^128-1 grant crosses the threshold on chain, and a total that
  // began at zero read it as one wei and said nothing. The log is bookkeeping,
  // not authority — a read failure seeds nothing and the rule falls back to the
  // network-free reading, which can miss a flag but never invent one.
  const standing = standingAllowanceTotals(
    await deps.allowanceStore.list().catch(() => []),
    allowanceOwner(resolved.account),
    trusted,
  );
  const report = verifyCalls(input.calls, trusted, standing);
  // Refused before the prompt is ever queued: a site asking the wallet to pay an
  // address that mimics one of the user's saved contacts is not a request the
  // user should be given a confirm button for. Same shared policy the in-wallet
  // ERC20 send, NFT send, swap, and pool routes apply.
  const refusal = refuseOnPoisonedRecipient(report);
  if (refusal) {
    return refusal;
  }
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
  // Claimed before the estimate starts, so a retry pressed while this first
  // estimate is still running supersedes it rather than being overwritten by it.
  const revision = deps.approvals.beginInvokeFeeEstimate(approval.id);
  if (revision) {
    void estimateInvokeApprovalFee(deps, feeReviewTarget(deps, resolved, input.calls)).then(
      (fee) => {
        if (deps.approvals.updateInvokeFee(revision, fee)) {
          notifyApprovalsChanged();
        }
      },
      () => {
        if (deps.approvals.updateInvokeFee(revision, FAILED_INVOKE_FEE)) {
          notifyApprovalsChanged();
        }
      },
    );
  }
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
  // One claim covers both writes below. A second retry — from this surface or
  // another open one — takes a later claim, and this one then writes nothing:
  // the figure the card ends up showing is always the newest estimate, never an
  // older one that happened to resolve last.
  const revision = deps.approvals.beginInvokeFeeEstimate(input.id);
  if (!revision || !deps.approvals.updateInvokeFee(revision, PENDING_INVOKE_FEE)) {
    return { error: "approval not found" };
  }
  notifyApprovalsChanged();
  const fee = await estimateInvokeApprovalFee(
    deps,
    feeReviewTarget(deps, resolved, payload.calls),
  ).catch(() => FAILED_INVOKE_FEE);
  if (!deps.approvals.updateInvokeFee(revision, fee)) {
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
  const preparedCall = calls.length === 1 ? calls[0] : undefined;
  if (approval.payload.proof && !preparedCall) {
    return { error: "invalid prepared strk20 invocation" };
  }
  // The recipient policy is re-applied to the exact calls that are about to be
  // broadcast, not only to the ones that were queued: the address book can gain
  // a contact while the prompt sits open, and a payee that mimics it becomes a
  // lookalike only at that moment. Same shared gate as the queue-time check
  // above and as the post-consent check the STRK20 executor applies, so a
  // decision the user made against one trusted set is never carried out against
  // another. Refusal, not annotation — nothing is submitted.
  const poisoned = refuseOnPoisonedRecipient(
    verifyCalls(calls, verificationContext(account, preferences)),
  );
  if (poisoned) {
    return poisoned;
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
          call: preparedCall as Call,
          proof: approval.payload.proof,
          ...ceiling,
        })
      : await runtimeRpc.submitInvokeTransaction({
          account,
          calls,
          ...ceiling,
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
    await activity.record({
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
