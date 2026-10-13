/**
 * Approval-gated STRK20 privacy provider operations. Every handler validates
 * sender, origin, connection grant, and payload before touching private state.
 * All six are dapp-reachable, so every session read here is a non-renewing peek.
 */

import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import {
  formatStrk20PoolFee,
  quoteStrk20Plan,
  summarizeStrk20Plan,
} from "@bramble/privacy/service";
import { SHADOW_INVOKE_ANONYMIZER } from "@bramble/privacy/shadow-account-copy";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import { strk20BatchRefusalError } from "@bramble/wallet-protocol/strk20-batch";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { createApprovalContext } from "../approvals/approval-context";
import { type ApprovalReservation, withApprovalReservation } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue } from "../approvals/approvals";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import {
  type ExtensionIdentity,
  isClaimedSenderOrigin,
  type RuntimeSender,
} from "../routing/senders";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { PassiveUnlockSession } from "../runtime/session";
import { strk20AccountContext, strk20ServiceForRuntime } from "./strk20-account-context";
import {
  type ResolvedAccount,
  resolveAccount,
  strk20ErrorMessage,
} from "./strk20-approval-execution";
import { strk20FeeAssetFor } from "./strk20-fee-reference";
import { holdStrk20Notice, MISSING_ANONYMIZER_REFUSAL } from "./strk20-notice";
import { assertPublicPoolSpendAffordable } from "./strk20-op-context";
import {
  actionTokenAddresses,
  batchReview,
  configuredAnonymizer,
  needsAnonymizer,
  queueStrk20Disclosure,
  reviewAssetsFor,
  strk20BatchSummaryRefusal,
} from "./strk20-ops-review";
import {
  readStrk20BalancesMessage,
  readStrk20InvokeMessage,
  readStrk20PrepareMessage,
  readStrk20RegisterMessage,
  readStrk20ShadowAccountMessage,
} from "./strk20-provider-inputs";
import { poisonedStrk20ActionFlags } from "./strk20-recipient-policy";
import { invokeScopeRecording, shadowRecordRefusal } from "./strk20-shadow-scopes";

/**
 * Dependencies shared by the STRK20 provider operation handlers.
 */
export type Strk20OpsDeps = {
  readonly activity: ActivityLog;
  readonly approvals: ApprovalQueue;
  readonly extension: ExtensionIdentity;
  readonly guard?: OriginGuard;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
  readonly waiters: SignatureWaiters;
};

const gateOrigin = (
  deps: Strk20OpsDeps,
  origin: string,
  sender: RuntimeSender | undefined,
): { readonly error: string } | null => {
  if (!isClaimedSenderOrigin(sender, deps.extension, origin)) {
    return { error: "sender origin mismatch" };
  }
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(origin)) {
    return { error: "origin blocked" };
  }
  return null;
};

type Strk20OpsHandler = (
  deps: Strk20OpsDeps,
  message: unknown,
  sender: RuntimeSender | undefined,
) => Promise<RuntimeResponse>;

const handleStrk20Register: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20RegisterMessage(message);
  if (!input) {
    return { error: "invalid strk20 registration request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  // Admitted on arrival, before anything that depends on what this user has
  // set up: the reservation holds this request's queue slot, and the deadline
  // its card or notice expires from, while the work below runs. Over-cap
  // bursts are therefore refused at once on every path (audit N2, N3).
  return withApprovalReservation(deps.approvals, input.origin, async (_release, admission) => {
    const resolved = await resolveAccount(deps, input.origin);
    if ("error" in resolved) {
      return resolved;
    }
    if (resolved.account.derivation.kind === "ledger") {
      return { error: "Private balances are not available for Ledger accounts" };
    }
    const config = resolved.preferences.strk20Networks?.[resolved.account.networkId];
    const token = resolved.preferences.tokens.find(
      (candidate) => candidate.networkId === resolved.account.networkId,
    );
    if (!config || !token) {
      return { error: "strk20 services unavailable" };
    }
    try {
      const accountContext = strk20AccountContext(deps, resolved);
      const service = strk20ServiceForRuntime(deps.runtimeRpc);
      if (!service.poolFee) {
        return { error: "strk20 services unavailable" };
      }
      const poolFeeFri = await service.poolFee(accountContext);
      await assertPublicPoolSpendAffordable(
        deps,
        { accountContext, preferences: resolved.preferences, token },
        poolFeeFri,
      );
      return queueStrk20Disclosure(deps, resolved, {
        admission,
        holdFailures: false,
        kind: "strk20-register",
        origin: input.origin,
        request: {
          poolAddress: config.poolAddress,
          poolFeeFri,
          token: token.address,
          type: "register",
        },
        summaries: [
          "Activate private balances for this account",
          `Privacy pool ${config.poolAddress}`,
          `Registration preflight token ${token.address}`,
          `Approve and pay the reviewed ${formatStrk20PoolFee(poolFeeFri)} pool fee`,
          "Publishes a viewing-key commitment, never the viewing key",
          "Opens this account's own private channel",
        ],
      });
    } catch (error) {
      return { error: strk20ErrorMessage(error) };
    }
  });
};

const handleStrk20Balances: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20BalancesMessage(message);
  if (!input) {
    return { error: "invalid strk20 balances request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  // Admitted on arrival, before anything that depends on what this user has
  // set up: the reservation holds this request's queue slot, and the deadline
  // its card or notice expires from, while the work below runs. Over-cap
  // bursts are therefore refused at once on every path (audit N2, N3).
  return withApprovalReservation(deps.approvals, input.origin, async (_release, admission) => {
    const resolved = await resolveAccount(deps, input.origin);
    if ("error" in resolved) {
      return resolved;
    }
    return queueStrk20Disclosure(deps, resolved, {
      admission,
      holdFailures: false,
      kind: "strk20-balances",
      origin: input.origin,
      request: { tokens: input.tokens, type: "balances" },
      summaries:
        input.tokens.length === 0
          ? ["Share all private token balances"]
          : [
              `Share private balances for ${input.tokens.length} token${input.tokens.length === 1 ? "" : "s"}`,
              ...input.tokens.map((token) => `Token ${token}`),
            ],
    });
  });
};

// The answer a batch gets before its card, or null to go on. The summary
// bound is decided from the site's input before anything that depends on what
// this user has set up, so it is the same for every user (audit N1); a batch
// that needs the missing anonymizer is held on the notice.
const batchPrecheck = (
  deps: Strk20OpsDeps,
  resolved: ResolvedAccount,
  origin: string,
  actions: readonly Strk20Action[],
  admission: ApprovalReservation,
): Promise<RuntimeResponse> | RuntimeResponse | null => {
  const unrenderable = strk20BatchSummaryRefusal(actions, origin, resolved.account.address);
  if (unrenderable) {
    return { error: unrenderable };
  }
  if (needsAnonymizer(actions) && configuredAnonymizer(resolved) === undefined) {
    return holdStrk20Notice(deps, origin, MISSING_ANONYMIZER_REFUSAL, undefined, admission);
  }
  return null;
};

const handleStrk20PrepareInvoke: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20PrepareMessage(message);
  if (!input) {
    return { error: "invalid strk20 prepare request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  // A batch the SDK or pool is known to reject, or whose reviewed call is not
  // the executed one, is refused before it can reach the user (#443).
  const refusal = strk20BatchRefusalError(input.actions);
  if (refusal) {
    return { error: refusal };
  }
  // Admitted on arrival, before anything that depends on what this user has
  // set up: the reservation holds this request's queue slot, and the deadline
  // its card or notice expires from, while the work below runs. Over-cap
  // bursts are therefore refused at once on every path (audit N2, N3).
  return withApprovalReservation(deps.approvals, input.origin, async (_release, admission) => {
    const resolved = await resolveAccount(deps, input.origin);
    if ("error" in resolved) {
      return resolved;
    }
    const early = batchPrecheck(deps, resolved, input.origin, input.actions, admission);
    if (early) {
      return early;
    }
    // The same recipient policy the wallet's own pool routes apply. A poisoned
    // payment is queued with the flag, which leaves the card with Deny only,
    // rather than refused at once: an instant refusal told the site which
    // addresses the user has saved or paid (Sherlock 140).
    const flags = poisonedStrk20ActionFlags(resolved.account, resolved.preferences, input.actions);
    const review = batchReview(resolved, input.origin, input.actions);
    return queueStrk20Disclosure(deps, resolved, {
      admission,
      flags,
      holdFailures: needsAnonymizer(input.actions),
      kind: "strk20-prepare",
      origin: input.origin,
      request: {
        actions: input.actions,
        ...(review.anonymizer === undefined ? {} : { anonymizer: review.anonymizer }),
        simulate: input.simulate,
        type: "prepare",
      },
      summaries: [
        ...review.summaries,
        input.simulate
          ? "Simulate only — no submittable proof"
          : "Generate a submittable private proof for this site",
      ],
    });
  });
};

// The invoke card's work once the request is admitted: the account, the
// pre-card checks, the record bound and the quote, then the card itself.
const queueStrk20Invoke = async (
  deps: Strk20OpsDeps,
  input: NonNullable<ReturnType<typeof readStrk20InvokeMessage>>,
  admission: ApprovalReservation,
): Promise<RuntimeResponse> => {
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  const early = batchPrecheck(deps, resolved, input.origin, input.actions, admission);
  if (early) {
    return early;
  }
  // A private transfer or withdrawal to an address that mimics a saved contact
  // is the same attack whether the wallet composed it or the site did. It is
  // queued with the flag, Deny only, rather than refused on arrival, so the
  // site cannot use the answer to read the address book (Sherlock 140).
  const flags = poisonedStrk20ActionFlags(resolved.account, resolved.preferences, input.actions);
  const review = batchReview(resolved, input.origin, input.actions);
  const recording = invokeScopeRecording(review.anonymizer, input.actions);
  const unrecordable = await shadowRecordRefusal(deps.wallet, resolved, input.origin, recording);
  if (unrecordable) {
    return holdStrk20Notice(deps, input.origin, unrecordable.error, "record-limit", admission);
  }
  try {
    const plan = await quoteStrk20Plan(strk20ServiceForRuntime(deps.runtimeRpc), {
      ...strk20AccountContext(deps, resolved),
      actions: input.actions,
    });
    const anonymizer =
      review.anonymizer === undefined ? {} : { shadowAccountAnonymizer: review.anonymizer };
    const payload = { actions: input.actions, ...anonymizer, strk20Plan: plan };
    const approval = deps.approvals.requestStrk20Invoke({
      ...anonymizer,
      arrivedAt: admission.arrivedAt,
      actions: input.actions,
      context: await createApprovalContext(resolved.account, payload),
      flags,
      origin: input.origin,
      plan,
      reviewAssets: reviewAssetsFor(resolved, [
        ...actionTokenAddresses(input.actions),
        ...("feeAction" in plan ? [plan.feeAction.token] : []),
      ]),
      summaries: [
        ...review.summaries,
        summarizeStrk20Plan(plan, strk20FeeAssetFor(resolved.account.networkId, plan)),
      ],
    });
    admission.release();
    notifyApprovalsChanged();
    return deps.waiters.register(approval.id);
  } catch (error) {
    // A shadow batch's quote runs only when an anonymizer is configured, so
    // an instant failure would tell the site one is: it is held instead.
    return needsAnonymizer(input.actions)
      ? holdStrk20Notice(deps, input.origin, strk20ErrorMessage(error), "request-failed", admission)
      : { error: strk20ErrorMessage(error) };
  }
};

const handleStrk20InvokeTransaction: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20InvokeMessage(message);
  if (!input) {
    return { error: "invalid strk20 invoke request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  const refusal = strk20BatchRefusalError(input.actions);
  if (refusal) {
    return { error: refusal };
  }
  // Admitted on arrival, before anything that depends on what this user has
  // set up: the reservation holds this request's queue slot, and the deadline
  // its card or notice expires from, while the work below runs. Over-cap
  // bursts are therefore refused at once on every path (audit N2, N3).
  return withApprovalReservation(deps.approvals, input.origin, (_release, admission) =>
    queueStrk20Invoke(deps, input, admission),
  );
};

const handleStrk20ShadowAccountCommitment: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20ShadowAccountMessage(message);
  if (!input) {
    return { error: "invalid strk20 shadow account request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  // Admitted on arrival, before anything that depends on what this user has
  // set up: the reservation holds this request's queue slot, and the deadline
  // its card or notice expires from, while the work below runs. Over-cap
  // bursts are therefore refused at once on every path (audit N2, N3).
  return withApprovalReservation(deps.approvals, input.origin, async (_release, admission) => {
    const resolved = await resolveAccount(deps, input.origin);
    if ("error" in resolved) {
      return resolved;
    }
    const anonymizer = configuredAnonymizer(resolved);
    if (anonymizer === undefined) {
      return holdStrk20Notice(deps, input.origin, MISSING_ANONYMIZER_REFUSAL, undefined, admission);
    }
    return queueStrk20Disclosure(deps, resolved, {
      admission,
      holdFailures: true,
      kind: "strk20-shadow-account",
      origin: input.origin,
      request: {
        anonymizer,
        dappName: input.dappName,
        ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
        type: "shadowAccount",
      },
      summaries: [
        `Share a private shadow account commitment for ${input.origin}`,
        `Site-chosen scope label ${input.dappName}`,
        ...(input.nonce === undefined ? [] : [`Nonce ${input.nonce}`]),
        SHADOW_INVOKE_ANONYMIZER(anonymizer),
      ],
    });
  });
};

// Dispatch table kept explicit so the router defaults closed.
const STRK20_OPS_HANDLERS: Readonly<Record<string, Strk20OpsHandler>> = {
  "wallet.strk20Balances": handleStrk20Balances,
  "wallet.strk20InvokeTransaction": handleStrk20InvokeTransaction,
  "wallet.strk20PrepareInvoke": handleStrk20PrepareInvoke,
  "wallet.strk20Register": handleStrk20Register,
  "wallet.strk20ShadowAccountCommitment": handleStrk20ShadowAccountCommitment,
};

/**
 * Handles the STRK20 privacy messages; returns null for other message types.
 * The invoke request is never auto-submitted: it is queued as a "Private
 * transaction" approval and its response is held until the user decides.
 */
export const handleStrk20Ops = async (
  deps: Strk20OpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(STRK20_OPS_HANDLERS, messageType)
    ? STRK20_OPS_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, message, sender) : null;
};
