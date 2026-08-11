/**
 * Approval-gated STRK20 privacy provider operations. Every handler validates
 * sender, origin, connection grant, and payload before touching private state.
 */

import { STRK20_SIGN_INTENTS } from "@mc-wallet/ledger-protocol/intent";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@mc-wallet/permissions/blocklist";
import {
  quoteStrk20Plan,
  summarizeStrk20Action,
  summarizeStrk20Plan,
} from "@mc-wallet/privacy/service";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { ActivityLog } from "@mc-wallet/transactions/activity";
import { createApprovalContext } from "../approvals/approval-context";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue } from "../approvals/approvals";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import { isClaimedSenderOrigin, type RuntimeSender } from "../routing/senders";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
import { strk20AccountContext, strk20ServiceForRuntime } from "./strk20-account-context";
import type {
  Strk20DisclosureApprovalKind,
  Strk20DisclosureRequest,
} from "./strk20-approval-types";
import { assertPublicPoolSpendAffordable } from "./strk20-op-context";
import { type ResolvedAccount, resolveAccount, strk20ErrorMessage } from "./strk20-origin-account";
import {
  readStrk20BalancesMessage,
  readStrk20InvokeMessage,
  readStrk20PrepareMessage,
  readStrk20RegisterMessage,
  readStrk20SubaccountMessage,
} from "./strk20-provider-inputs";
import type { WalletStatusReader } from "../accounts/wallet-reader";

/**
 * Dependencies shared by the STRK20 provider operation handlers.
 */
export type Strk20OpsDeps = {
  readonly activity: ActivityLog;
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly guard?: OriginGuard;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
  readonly waiters: SignatureWaiters;
};

const gateOrigin = (
  deps: Strk20OpsDeps,
  origin: string,
  sender: RuntimeSender | undefined,
): { readonly error: string } | null => {
  if (!isClaimedSenderOrigin(sender, deps.extensionId, origin)) {
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

const queueDisclosure = async (
  deps: Strk20OpsDeps,
  resolved: ResolvedAccount,
  input: {
    readonly kind: Strk20DisclosureApprovalKind;
    readonly origin: string;
    readonly request: Strk20DisclosureRequest;
    readonly summaries: readonly string[];
  },
): Promise<RuntimeResponse> => {
  try {
    const payload = { strk20Request: input.request };
    const approval = deps.approvals.requestStrk20Disclosure({
      context: await createApprovalContext(resolved.account, payload),
      kind: input.kind,
      origin: input.origin,
      request: input.request,
      summaries: input.summaries,
    });
    notifyApprovalsChanged();
    return deps.waiters.register(approval.id);
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
};

const handleStrk20Register: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20RegisterMessage(message);
  if (!input) {
    return { error: "invalid strk20 registration request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  // A Ledger account registers through its retained, scope-bound key; without one
  // the derivation below fails closed, which is honest here — a dapp cannot drive
  // the device ceremony, so the user must run it from the wallet first.
  const config = resolved.preferences.strk20Networks?.[resolved.account.networkId];
  const token = resolved.preferences.tokens.find(
    (candidate) => candidate.networkId === resolved.account.networkId,
  );
  if (!config || !token) {
    return { error: "strk20 services unavailable" };
  }
  try {
    const accountContext = strk20AccountContext(deps, resolved, STRK20_SIGN_INTENTS.register);
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
    return queueDisclosure(deps, resolved, {
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
        `Approve and pay the reviewed ${poolFeeFri} STRK fri pool fee`,
        "Publishes a viewing-key commitment (never the key) and opens this account's own channel",
      ],
    });
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
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
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  return queueDisclosure(deps, resolved, {
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
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  return queueDisclosure(deps, resolved, {
    kind: "strk20-prepare",
    origin: input.origin,
    request: { actions: input.actions, simulate: input.simulate, type: "prepare" },
    summaries: [
      ...input.actions.map(summarizeStrk20Action),
      input.simulate
        ? "Simulate only — no submittable proof"
        : "Generate a submittable private proof for this site",
    ],
  });
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
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  try {
    const plan = await quoteStrk20Plan(strk20ServiceForRuntime(deps.runtimeRpc), {
      ...strk20AccountContext(deps, resolved, STRK20_SIGN_INTENTS.dapp),
      actions: input.actions,
    });
    const payload = { actions: input.actions, strk20Plan: plan };
    const approval = deps.approvals.requestStrk20Invoke({
      actions: input.actions,
      context: await createApprovalContext(resolved.account, payload),
      origin: input.origin,
      plan,
      summaries: [...input.actions.map(summarizeStrk20Action), summarizeStrk20Plan(plan)],
    });
    notifyApprovalsChanged();
    return deps.waiters.register(approval.id);
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
};

const handleStrk20SubaccountCommitment: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20SubaccountMessage(message);
  if (!input) {
    return { error: "invalid strk20 subaccount request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  return queueDisclosure(deps, resolved, {
    kind: "strk20-subaccount",
    origin: input.origin,
    request: {
      dappName: input.dappName,
      ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
      type: "subaccount",
    },
    summaries: [
      `Share a private sub-account commitment for ${input.dappName}`,
      ...(input.nonce === undefined ? [] : [`Nonce ${input.nonce}`]),
    ],
  });
};

// Dispatch table kept explicit so the router defaults closed.
const STRK20_OPS_HANDLERS: Readonly<Record<string, Strk20OpsHandler>> = {
  "wallet.strk20Balances": handleStrk20Balances,
  "wallet.strk20InvokeTransaction": handleStrk20InvokeTransaction,
  "wallet.strk20PrepareInvoke": handleStrk20PrepareInvoke,
  "wallet.strk20Register": handleStrk20Register,
  "wallet.strk20SubaccountCommitment": handleStrk20SubaccountCommitment,
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
  const handler = STRK20_OPS_HANDLERS[messageType];
  return handler ? handler(deps, message, sender) : null;
};
