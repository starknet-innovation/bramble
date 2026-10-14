/**
 * Execution of STRK20 requests the user has already approved, plus the account
 * resolution every one of them re-runs first. Split from the request handlers in
 * ./strk20-ops.ts because the trust question differs: those decide whether to
 * QUEUE an approval, these run after consent and are the last point at which a
 * revoked grant, a switched network, or a locked wallet must still fail closed.
 * No SDK private-state operation, protected signing, or proving happens before
 * this boundary.
 */

import { WalletError } from "@bramble/core/errors";
import {
  prepareStrk20CallAndProof,
  readStrk20Balances,
  type Strk20SubmissionPlan,
  type Strk20SubmissionResult,
  submitStrk20Actions,
} from "@bramble/privacy/service";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { type ActivityLog, activityOrigin } from "@bramble/transactions/activity";
import type { AllowanceStore } from "@bramble/transactions/allowance-store";
import { verificationContext } from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { ApprovalContext } from "../approvals/approval-context";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { resolveOriginAccount } from "../provider/provider-grant";
import type { ResolvedOriginAccount } from "../provider/provider-ops";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls, observedVaultAccountAddresses } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { PassiveUnlockSession } from "../runtime/session";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import {
  type TrustedRecipientDeps,
  withTrustedRecipients,
} from "../transactions/trusted-recipients";
import { strk20AccountContext, strk20ServiceForRuntime } from "./strk20-account-context";
import type { Strk20DisclosureRequest } from "./strk20-approval-types";
import {
  refusePoisonedStrk20Actions,
  type Strk20TrustedPreferences,
} from "./strk20-recipient-policy";
import { bindStrk20ActionsToOrigin, strk20ShadowAccountCommitment } from "./strk20-shadow-account";
import {
  disclosureScopeRecording,
  invokeScopeRecording,
  recordShadowScopeUses,
} from "./strk20-shadow-scopes";

/**
 * Dependencies needed to execute a held STRK20 invoke once the user approves.
 */
export type Strk20ExecuteDeps = {
  readonly activity: ActivityLog;
  /** Log the pool approvals a submission grants are tracked in. */
  readonly allowanceStore: AllowanceStore;
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial test
   * stubs stay valid; a Ledger private transfer with no queue wired fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  /** Watched shared accounts, trusted by the execution-time lookalike check (Sherlock 140). */
  readonly multisigStore?: TrustedRecipientDeps["multisigStore"];
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * The account an approved STRK20 operation runs as, resolved fresh at
 * execution time together with the preferences and RPC endpoints it was
 * resolved against.
 */
export type ResolvedAccount = {
  readonly account: AccountRef;
  readonly passphrase: string;
  readonly preferences: ResolvedOriginAccount["preferences"];
  readonly rpcUrls: readonly string[];
};

/**
 * Maps a thrown STRK20 failure to the message the provider boundary returns.
 * Known wallet errors carry a stable message that maps to a spec code on the
 * wire; anything else collapses to a generic failure (UNKNOWN_ERROR) so an SDK
 * or service internal never reaches a dapp.
 */
export const strk20ErrorMessage = (error: unknown): string =>
  error instanceof WalletError ? error.message : "strk20 request failed";

/**
 * Resolves the origin's active-network account, or an error response the caller
 * can return directly.
 *
 * Trust boundary: `origin` is dapp-supplied and the grant may have been revoked
 * or the network switched since the request was queued, so the account is
 * re-read from the vault and re-matched against `expected` every time. A locked
 * wallet, a changed active network, or a revoked grant fails safely with an
 * error — never with a stale account. The session read is a non-renewing peek.
 */
export const resolveAccount = async (
  deps: Pick<Strk20ExecuteDeps, "preferencesStore" | "session" | "wallet"> & TrustedRecipientDeps,
  origin: string,
  expected?: ApprovalContext,
): Promise<ResolvedAccount | { readonly error: string }> => {
  const resolved = await resolveOriginAccount(
    {
      activity: deps.activity,
      multisigStore: deps.multisigStore,
      preferencesStore: deps.preferencesStore,
      session: deps.session,
      wallet: deps.wallet,
    },
    origin,
    expected,
  );
  if ("error" in resolved) return resolved;
  return {
    ...resolved,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[resolved.account.networkId], resolved.preferences),
  };
};

// Entering the pool approves it to pull the deposit and its fee from the
// account's PUBLIC balance. Those grants belong to the account that submitted
// them, so they are tracked like any other approval this wallet broadcasts —
// see `Strk20SubmissionResult` for why the submitter reports them. Every caller
// files them BEFORE writing the activity line: an activity write that fails
// must not be able to lose the record of a grant that is already on chain.
const recordPoolAllowances = (
  deps: Strk20ExecuteDeps,
  resolved: { readonly account: AccountRef; readonly preferences: Strk20TrustedPreferences },
  result: Strk20SubmissionResult,
): Promise<void> =>
  recordApproveAllowances({
    assets: verificationContext(resolved.account, resolved.preferences),
    calls: result.allowanceGrants ?? [],
    owner: allowanceOwner(resolved.account),
    store: deps.allowanceStore,
    transactionHash: result.transactionHash,
  });

/**
 * Re-applies the recipient policy against fresh preferences immediately before
 * a proof is built. Throws the refusal; shared with the public-route staging.
 */
export const assertCurrentRecipientPolicy = async (
  deps: Pick<Strk20ExecuteDeps, "activity" | "preferencesStore" | "session" | "wallet">,
  account: AccountRef,
  actions: readonly Strk20Action[],
): Promise<void> => {
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    await observedVaultAccountAddresses(deps.wallet, deps.session),
  );
  const refusal = refusePoisonedStrk20Actions(account, preferences, actions);
  if (refusal) {
    throw new WalletError(refusal.error);
  }
};

// The anonymizer the card named must still be the one this network routes
// shadow invokes through: changing it moves every shadow account, so an
// approval reviewed under one anonymizer must never execute under another.
// `required` is whether the request needs an anonymizer at all; one that does
// but carries no reviewed value is refused rather than trusted.
const reviewedAnonymizerRefusal = (
  configured: string | undefined,
  reviewed: string | undefined,
  required: boolean,
): { readonly error: string } | null =>
  (required && reviewed === undefined) ||
  (reviewed !== undefined && !sameFelt(configured, reviewed))
    ? { error: "approval context changed" }
    : null;

const hasShadowInvoke = (actions: readonly Strk20Action[]): boolean =>
  actions.some((action) => action.type === "shadow_account_invoke");

type ApprovedRequest<T extends Strk20DisclosureRequest["type"]> = Extract<
  Strk20DisclosureRequest,
  { readonly type: T }
>;

// An approved proof request. Throws on an SDK or vault failure; the caller maps it.
const executeApprovedPrepare = async (
  deps: Strk20ExecuteDeps,
  resolved: ResolvedAccount,
  origin: string,
  request: ApprovedRequest<"prepare">,
): Promise<RuntimeResponse> => {
  // Re-applied after consent, not only before it: the contact this recipient
  // mimics may have been saved while the request sat in the queue, and the
  // proof this produces is submittable.
  const refusal = refusePoisonedStrk20Actions(
    resolved.account,
    resolved.preferences,
    request.actions,
  );
  if (refusal) {
    return refusal;
  }
  const context = strk20AccountContext(deps, resolved);
  const moved = reviewedAnonymizerRefusal(
    context.config?.shadowAccountAnonymizerAddress,
    request.anonymizer,
    hasShadowInvoke(request.actions),
  );
  if (moved) {
    return moved;
  }
  // A submittable proof can act through the shadow account once the site
  // relays it, so the scope is recorded first; a simulation cannot.
  const recording = disclosureScopeRecording(request);
  if (recording) {
    await recordShadowScopeUses(deps.wallet, resolved, { ...recording, origin });
  }
  const callAndProof = await prepareStrk20CallAndProof(strk20ServiceForRuntime(deps.runtimeRpc), {
    ...context,
    actions: await bindStrk20ActionsToOrigin(origin, request.actions),
    simulate: request.simulate,
  });
  return { callAndProof, ok: true };
};

// An approved commitment disclosure. Throws on an SDK or vault failure.
const executeApprovedCommitment = async (
  deps: Strk20ExecuteDeps,
  resolved: ResolvedAccount,
  origin: string,
  request: ApprovedRequest<"shadowAccount">,
): Promise<RuntimeResponse> => {
  const context = strk20AccountContext(deps, resolved);
  const moved = reviewedAnonymizerRefusal(
    context.config?.shadowAccountAnonymizerAddress,
    request.anonymizer,
    true,
  );
  if (moved) {
    return moved;
  }
  // Recorded when the commitment is shared, not only on invoke: a site can
  // fund the precomputed address before the shadow account is deployed.
  const recording = disclosureScopeRecording(request);
  if (recording) {
    await recordShadowScopeUses(deps.wallet, resolved, { ...recording, origin });
  }
  return strk20ShadowAccountCommitment(deps.runtimeRpc, context, { origin, request });
};

/**
 * Executes an approved private disclosure or proof request after re-validating
 * the origin's account and network context. No SDK private-state operation runs
 * before this boundary.
 */
export const executeStrk20DisclosureApproval = async (
  deps: Strk20ExecuteDeps,
  approval: {
    readonly context?: ApprovalContext;
    readonly origin: string;
    readonly request: Strk20DisclosureRequest;
  },
): Promise<RuntimeResponse> => {
  const resolved = await resolveAccount(deps, approval.origin, approval.context);
  if ("error" in resolved) {
    return resolved;
  }
  const context = strk20AccountContext(deps, resolved);
  try {
    if (approval.request.type === "register") {
      return { error: "registration requires a network-fee approval" };
    }
    if (approval.request.type === "balances") {
      const balances = await readStrk20Balances(strk20ServiceForRuntime(deps.runtimeRpc), {
        ...context,
        tokens: approval.request.tokens,
      });
      return { balances, ok: true };
    }
    if (approval.request.type === "prepare") {
      return await executeApprovedPrepare(deps, resolved, approval.origin, approval.request);
    }
    return await executeApprovedCommitment(deps, resolved, approval.origin, approval.request);
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
};

/**
 * Executes a user-approved STRK20 invoke: re-resolves the active account for the
 * origin, proves the exact frozen actions plus the reviewed paymaster fee, and
 * submits them through the privacy relayer. No protected signing or proving is
 * performed before approval.
 */
export const executeStrk20InvokeApproval = async (
  deps: Strk20ExecuteDeps,
  approval: {
    readonly actions: readonly Strk20Action[];
    readonly context?: ApprovalContext;
    readonly origin: string;
    readonly plan: Strk20SubmissionPlan;
    /** The anonymizer the card named, when the batch holds a shadow invoke. */
    readonly shadowAccountAnonymizer?: string;
  },
): Promise<RuntimeResponse> => {
  const resolved = await resolveAccount(deps, approval.origin, approval.context);
  if ("error" in resolved) {
    return resolved;
  }
  const moved = reviewedAnonymizerRefusal(
    resolved.preferences.strk20Networks?.[resolved.account.networkId]
      ?.shadowAccountAnonymizerAddress,
    approval.shadowAccountAnonymizer,
    hasShadowInvoke(approval.actions),
  );
  if (moved) {
    return moved;
  }
  // The last gate before a private payment is broadcast, applied to the exact
  // frozen actions that will be proved and submitted. The request-time check in
  // ./strk20-ops stops the prompt from ever appearing; this one stops a payment
  // whose recipient only became a lookalike after the prompt was raised.
  const refusal = refusePoisonedStrk20Actions(
    resolved.account,
    resolved.preferences,
    approval.actions,
  );
  if (refusal) {
    return refusal;
  }
  try {
    const recording = invokeScopeRecording(approval.shadowAccountAnonymizer, approval.actions);
    if (recording) {
      await recordShadowScopeUses(deps.wallet, resolved, { ...recording, origin: approval.origin });
    }
    const result = await submitStrk20Actions(strk20ServiceForRuntime(deps.runtimeRpc), {
      ...strk20AccountContext(deps, resolved),
      actions: await bindStrk20ActionsToOrigin(approval.origin, approval.actions),
      beforeProof: () => assertCurrentRecipientPolicy(deps, resolved.account, approval.actions),
      plan: approval.plan,
    });
    const actionCount = approval.actions.length;
    await recordPoolAllowances(deps, resolved, result);
    await recordSubmittedActivity(deps.activity, {
      accountId: resolved.account.id,
      hash: result.transactionHash,
      kind: "invoke",
      networkId: resolved.account.networkId,
      summary: `${activityOrigin(approval.origin)} submitted a private transaction (${actionCount} action${
        actionCount === 1 ? "" : "s"
      })`,
    });
    return { ok: true, transactionHash: result.transactionHash };
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
};
