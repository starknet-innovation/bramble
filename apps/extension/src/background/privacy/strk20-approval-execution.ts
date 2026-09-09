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
import type { PreparedStrk20AccountSubmission } from "@bramble/privacy/service";
import {
  prepareStrk20AccountActions,
  prepareStrk20CallAndProof,
  prepareStrk20Registration,
  readStrk20Balances,
  readStrk20RegistrationStatus,
  type Strk20SubmissionPlan,
  type Strk20SubmissionResult,
  submitStrk20Actions,
} from "@bramble/privacy/service";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { AllowanceStore } from "@bramble/transactions/allowance-store";
import { verificationContext } from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { ApprovalContext } from "../approvals/approval-context";
import type { ApprovalQueue } from "../approvals/approvals";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { resolveOriginAccount } from "../provider/provider-grant";
import { queueInvokeApproval, type ResolvedOriginAccount } from "../provider/provider-ops";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { PassiveUnlockSession } from "../runtime/session";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import { strk20AccountContext, strk20ServiceForRuntime } from "./strk20-account-context";
import type { Strk20DisclosureRequest } from "./strk20-approval-types";
import { assertPublicPoolSpendAffordable } from "./strk20-op-context";
import {
  refusePoisonedStrk20Actions,
  type Strk20TrustedPreferences,
} from "./strk20-recipient-policy";
import { bindStrk20ActionsToOrigin, strk20SubaccountCommitment } from "./strk20-subaccount";

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
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
};

type Strk20StagingDeps = Strk20ExecuteDeps & {
  readonly approvals: ApprovalQueue;
  readonly waiters: SignatureWaiters;
};

/**
 * Outcome that parks the original dapp waiter on a second exact-call fee
 * approval without resolving it early.
 */
export type DeferredStrk20Approval = {
  readonly status: "defer";
  readonly respond: (
    listPending: () => readonly import("../approvals/approvals").PendingApproval[],
  ) => RuntimeResponse;
};

const deferPreparedPublicInvoke = async (
  deps: Strk20StagingDeps,
  approval: { readonly id: string; readonly origin: string },
  prepared:
    | {
        readonly prepared: PreparedStrk20AccountSubmission;
        readonly resolved: ResolvedOriginAccount;
      }
    | { readonly error: string },
): Promise<
  DeferredStrk20Approval | { readonly status: "reject"; readonly response: RuntimeResponse }
> => {
  if ("error" in prepared) return { response: prepared, status: "reject" };
  const queued = await queueInvokeApproval(deps, prepared.resolved, {
    calls: prepared.prepared.calls,
    origin: approval.origin,
    proof: prepared.prepared.proof,
  });
  if (!("approval" in queued)) return { response: queued, status: "reject" };
  deps.waiters.move(approval.id, queued.approval.id);
  return { respond: (listPending) => ({ ok: true, pending: listPending() }), status: "defer" };
};

/**
 * Stages an approved public deposit behind an exact-call fee approval. Null
 * means the approved plan is not the wallet-funded public route.
 */
export const stageApprovedStrk20Deposit = async (
  deps: Strk20StagingDeps,
  claim: import("../approvals/approvals").ApprovalClaim,
): Promise<
  DeferredStrk20Approval | { readonly status: "reject"; readonly response: RuntimeResponse } | null
> => {
  const { approval, payload } = claim;
  if (!payload?.actions || payload.strk20Plan?.mode !== "account") return null;
  return deferPreparedPublicInvoke(
    deps,
    approval,
    await prepareApprovedStrk20AccountActions(deps, {
      actions: payload.actions,
      ...(approval.context === undefined ? {} : { context: approval.context }),
      origin: approval.origin,
      plan: payload.strk20Plan,
    }),
  );
};

/**
 * Stages approved registration behind an exact-call fee approval. Null means
 * the claimed disclosure is not a registration request.
 */
export const stageApprovedStrk20Registration = async (
  deps: Strk20StagingDeps,
  claim: import("../approvals/approvals").ApprovalClaim,
): Promise<
  DeferredStrk20Approval | { readonly status: "reject"; readonly response: RuntimeResponse } | null
> => {
  const { approval, payload } = claim;
  if (payload?.strk20Request?.type !== "register") return null;
  return deferPreparedPublicInvoke(
    deps,
    approval,
    await prepareApprovedStrk20Registration(deps, {
      ...(approval.context === undefined ? {} : { context: approval.context }),
      origin: approval.origin,
      request: payload.strk20Request,
    }),
  );
};

/**
 * The account an approved STRK20 operation runs as, resolved fresh at
 * execution time together with the preferences and RPC endpoints it was
 * resolved against.
 */
export type ResolvedAccount = {
  readonly account: AccountRef;
  readonly passphrase: string;
  readonly preferences: Awaited<ReturnType<WalletPreferencesStore["read"]>>;
  readonly rpcUrls: readonly string[];
};

/**
 * After disclosure consent, prepares the exact public registration batch for
 * a second ordinary invoke/fee approval. Nothing is signed or broadcast here.
 */
const prepareApprovedStrk20Registration = async (
  deps: Strk20ExecuteDeps,
  approval: {
    readonly context?: ApprovalContext;
    readonly origin: string;
    readonly request: Extract<Strk20DisclosureRequest, { readonly type: "register" }>;
  },
): Promise<
  | {
      readonly prepared: Awaited<ReturnType<typeof prepareStrk20Registration>>;
      readonly resolved: ResolvedAccount;
    }
  | { readonly error: string }
> => {
  const resolved = await resolveAccount(deps, approval.origin, approval.context);
  if ("error" in resolved) {
    return resolved;
  }
  const context = strk20AccountContext(deps, resolved);
  try {
    const registration = approval.request;
    const config = context.config;
    const token = resolved.preferences.tokens.find(
      (candidate) =>
        candidate.networkId === resolved.account.networkId &&
        sameFelt(candidate.address, registration.token),
    );
    if (
      resolved.account.derivation.kind === "ledger" ||
      !config ||
      !sameFelt(config.poolAddress, registration.poolAddress) ||
      !token
    ) {
      return { error: "approval context changed" };
    }
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    if (
      (await readStrk20RegistrationStatus(service, {
        ...context,
        token: registration.token,
      })) === "registered"
    ) {
      return { error: "Private balances are already active" };
    }
    if (
      !(await deps.runtimeRpc.getDeploymentStatus({
        accountAddress: resolved.account.address,
        rpcUrls: resolved.rpcUrls,
      }))
    ) {
      return { error: "Deploy this account before activating private balances" };
    }
    await assertPublicPoolSpendAffordable(
      deps,
      { accountContext: context, preferences: resolved.preferences, token },
      registration.poolFeeFri,
    );
    return {
      prepared: await prepareStrk20Registration(service, {
        ...context,
        poolFeeFri: registration.poolFeeFri,
      }),
      resolved,
    };
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
};

/**
 * Prepares an approved public deposit for its second exact-call fee approval.
 * Returns a refusal on stale context/policy and never signs or broadcasts.
 */
const prepareApprovedStrk20AccountActions = async (
  deps: Strk20ExecuteDeps,
  approval: {
    readonly actions: readonly Strk20Action[];
    readonly context?: ApprovalContext;
    readonly origin: string;
    readonly plan: Extract<Strk20SubmissionPlan, { readonly mode: "account" }>;
  },
): Promise<
  | {
      readonly prepared: Awaited<ReturnType<typeof prepareStrk20AccountActions>>;
      readonly resolved: ResolvedAccount;
    }
  | { readonly error: string }
> => {
  const resolved = await resolveAccount(deps, approval.origin, approval.context);
  if ("error" in resolved) {
    return resolved;
  }
  const refusal = refusePoisonedStrk20Actions(
    resolved.account,
    resolved.preferences,
    approval.actions,
  );
  if (refusal) {
    return refusal;
  }
  try {
    if (
      !(await deps.runtimeRpc.getDeploymentStatus({
        accountAddress: resolved.account.address,
        rpcUrls: resolved.rpcUrls,
      }))
    ) {
      return { error: "Deploy this account before submitting a public private deposit" };
    }
    const context = strk20AccountContext(deps, resolved);
    const actions = await bindStrk20ActionsToOrigin(approval.origin, approval.actions);
    return {
      prepared: await prepareStrk20AccountActions(strk20ServiceForRuntime(deps.runtimeRpc), {
        ...context,
        actions,
        beforeProof: () => assertCurrentRecipientPolicy(deps, resolved.account, approval.actions),
        poolFeeFri: approval.plan.poolFeeFri,
      }),
      resolved,
    };
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
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
  deps: Pick<Strk20ExecuteDeps, "preferencesStore" | "session" | "wallet">,
  origin: string,
  expected?: ApprovalContext,
): Promise<ResolvedAccount | { readonly error: string }> => {
  const resolved = await resolveOriginAccount(
    {
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
  });

const assertCurrentRecipientPolicy = async (
  deps: Pick<Strk20ExecuteDeps, "preferencesStore">,
  account: AccountRef,
  actions: readonly Strk20Action[],
): Promise<void> => {
  const refusal = refusePoisonedStrk20Actions(account, await deps.preferencesStore.read(), actions);
  if (refusal) {
    throw new WalletError(refusal.error);
  }
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
      // Re-applied after consent, not only before it: the contact this recipient
      // mimics may have been saved while the request sat in the queue, and the
      // proof this produces is submittable.
      const refusal = refusePoisonedStrk20Actions(
        resolved.account,
        resolved.preferences,
        approval.request.actions,
      );
      if (refusal) {
        return refusal;
      }
      const callAndProof = await prepareStrk20CallAndProof(
        strk20ServiceForRuntime(deps.runtimeRpc),
        {
          ...context,
          actions: await bindStrk20ActionsToOrigin(approval.origin, approval.request.actions),
          simulate: approval.request.simulate,
        },
      );
      return { callAndProof, ok: true };
    }
    return strk20SubaccountCommitment(deps.runtimeRpc, context, {
      origin: approval.origin,
      request: approval.request,
    });
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
  },
): Promise<RuntimeResponse> => {
  const resolved = await resolveAccount(deps, approval.origin, approval.context);
  if ("error" in resolved) {
    return resolved;
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
      summary: `${approval.origin} submitted a private transaction (${actionCount} action${
        actionCount === 1 ? "" : "s"
      })`,
    });
    return { ok: true, transactionHash: result.transactionHash };
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
};
