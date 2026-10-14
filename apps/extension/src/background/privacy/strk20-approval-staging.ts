/**
 * Staging of approved STRK20 requests that pay their fee from the public
 * account: a deposit-only batch and a pool registration. After the dapp-facing
 * consent, each is prepared here and parked behind a second, exact-call
 * network-fee approval; nothing is signed or broadcast at this boundary. Split
 * from ./strk20-approval-execution, which runs the private (relayed) routes.
 */

import {
  type PreparedStrk20AccountSubmission,
  prepareStrk20AccountActions,
  prepareStrk20Registration,
  readStrk20RegistrationStatus,
  type Strk20SubmissionPlan,
} from "@bramble/privacy/service";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { ApprovalContext } from "../approvals/approval-context";
import type { ApprovalClaim, ApprovalQueue, PendingApproval } from "../approvals/approvals";
import { queueInvokeApproval, type ResolvedOriginAccount } from "../provider/provider-ops";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { strk20AccountContext, strk20ServiceForRuntime } from "./strk20-account-context";
import { STRK20_REGISTRATION_SUMMARY } from "./strk20-activity";
import {
  assertCurrentRecipientPolicy,
  type ResolvedAccount,
  resolveAccount,
  type Strk20ExecuteDeps,
  strk20ErrorMessage,
} from "./strk20-approval-execution";
import type { Strk20DisclosureRequest } from "./strk20-approval-types";
import { assertPublicPoolSpendAffordable } from "./strk20-op-context";
import { refusePoisonedStrk20Actions } from "./strk20-recipient-policy";
import { bindStrk20ActionsToOrigin } from "./strk20-shadow-account";

type Strk20StagingDeps = Strk20ExecuteDeps & {
  readonly approvals: ApprovalQueue;
  /** The held dapp response, re-parked on the fee approval that follows. */
  readonly waiters: { readonly move: (fromId: string, toId: string) => void };
};

/**
 * Outcome that parks the original dapp waiter on a second exact-call fee
 * approval without resolving it early.
 */
export type DeferredStrk20Approval = {
  readonly status: "defer";
  readonly respond: (listPending: () => readonly PendingApproval[]) => RuntimeResponse;
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
  activitySummary?: string,
): Promise<
  DeferredStrk20Approval | { readonly status: "reject"; readonly response: RuntimeResponse }
> => {
  if ("error" in prepared) return { response: prepared, status: "reject" };
  const queued = await queueInvokeApproval(deps, prepared.resolved, {
    ...(activitySummary === undefined ? {} : { activitySummary }),
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
  claim: ApprovalClaim,
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
  claim: ApprovalClaim,
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
    STRK20_REGISTRATION_SUMMARY,
  );
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
