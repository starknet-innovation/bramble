/**
 * Approval-gated STRK20 privacy provider operations. Every handler validates
 * sender, origin, connection grant, and payload before touching private state.
 */

import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "../security/blocklist";
import { WalletError } from "../shared/errors";
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { normalizeWalletOrigin } from "../shared/origin";
import { STARKNET_NETWORKS } from "../starknet/networks";
import {
  isStrk20DappName,
  isStrk20Felt,
  readStrk20Actions,
  readStrk20Tokens,
  type Strk20Action,
} from "../starknet/strk20/schemas";
import {
  prepareStrk20CallAndProof,
  quoteStrk20Plan,
  readStrk20Balances,
  type Strk20SubmissionPlan,
  submitStrk20Actions,
  summarizeStrk20Action,
  summarizeStrk20Plan,
} from "../starknet/strk20/service";
import type { ActivityLog } from "../storage/activity-store";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { type ApprovalContext, createApprovalContext } from "./approval-context";
import { notifyApprovalsChanged } from "./approval-notifier";
import type { ApprovalQueue } from "./approvals";
import type { LedgerSignQueue } from "./ledger-sign-queue";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { UnlockSession } from "./session";
import type { SignatureWaiters } from "./signature-waiters";
import { strk20AccountContext, strk20ServiceForRuntime } from "./strk20-account-context";
import type {
  Strk20DisclosureApprovalKind,
  Strk20DisclosureRequest,
} from "./strk20-approval-types";

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

/**
 * Dependencies needed to execute a held STRK20 invoke once the user approves.
 */
export type Strk20ExecuteDeps = {
  readonly activity: ActivityLog;
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial test
   * stubs stay valid; a Ledger private transfer with no queue wired fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

type ResolvedAccount = {
  readonly account: AccountRef;
  readonly passphrase: string;
  readonly preferences: Awaited<ReturnType<WalletPreferencesStore["read"]>>;
  readonly rpcUrls: readonly string[];
};

// Known STRK20 errors carry a stable message that maps to a spec code on the
// wire; anything else collapses to a generic failure (UNKNOWN_ERROR).
const strk20ErrorMessage = (error: unknown): string =>
  error instanceof WalletError ? error.message : "strk20 request failed";

// Resolves the origin's active-network account, or an error response the caller
// can return directly. A locked wallet or a revoked grant fails safely.
const resolveAccount = async (
  deps: Pick<Strk20OpsDeps, "preferencesStore" | "session" | "wallet">,
  origin: string,
  expected?: ApprovalContext,
): Promise<ResolvedAccount | { readonly error: string }> => {
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
  return {
    account,
    passphrase,
    preferences,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
  };
};

const readBalancesMessage = (
  message: unknown,
): { readonly origin: string; readonly tokens: readonly string[] } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "tokens", "type"]) ||
    message["type"] !== "wallet.strk20Balances"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  const tokens = readStrk20Tokens(message["tokens"]);
  return origin && tokens ? { origin, tokens } : null;
};

const readPrepareMessage = (
  message: unknown,
): {
  readonly actions: readonly Strk20Action[];
  readonly origin: string;
  readonly simulate: boolean;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["actions", "origin", "simulate", "type"]) ||
    message["type"] !== "wallet.strk20PrepareInvoke" ||
    typeof message["simulate"] !== "boolean"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  const actions = readStrk20Actions(message["actions"]);
  return origin && actions ? { actions, origin, simulate: message["simulate"] } : null;
};

const readInvokeMessage = (
  message: unknown,
): { readonly actions: readonly Strk20Action[]; readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["actions", "origin", "type"]) ||
    message["type"] !== "wallet.strk20InvokeTransaction"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  const actions = readStrk20Actions(message["actions"]);
  return origin && actions ? { actions, origin } : null;
};

const readSubaccountMessage = (
  message: unknown,
): {
  readonly dappName: string;
  readonly nonce?: string;
  readonly origin: string;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["dappName", "nonce", "origin", "type"]) ||
    message["type"] !== "wallet.strk20SubaccountCommitment" ||
    !isStrk20DappName(message["dappName"]) ||
    (message["nonce"] !== undefined && !isStrk20Felt(message["nonce"]))
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  return origin
    ? {
        dappName: message["dappName"],
        ...(message["nonce"] === undefined ? {} : { nonce: message["nonce"] }),
        origin,
      }
    : null;
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

const handleStrk20Balances: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readBalancesMessage(message);
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
  const input = readPrepareMessage(message);
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
  const input = readInvokeMessage(message);
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
      ...strk20AccountContext(deps, resolved),
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
  const input = readSubaccountMessage(message);
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

/**
 * Dispatch table for STRK20 privacy messages, keyed by message type. Each branch
 * is a self-contained handler, leaving the router a pure lookup.
 */
const STRK20_OPS_HANDLERS: Readonly<Record<string, Strk20OpsHandler>> = {
  "wallet.strk20Balances": handleStrk20Balances,
  "wallet.strk20InvokeTransaction": handleStrk20InvokeTransaction,
  "wallet.strk20PrepareInvoke": handleStrk20PrepareInvoke,
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
    if (approval.request.type === "balances") {
      const balances = await readStrk20Balances(strk20ServiceForRuntime(deps.runtimeRpc), {
        ...context,
        tokens: approval.request.tokens,
      });
      return { balances, ok: true };
    }
    if (approval.request.type === "prepare") {
      const callAndProof = await prepareStrk20CallAndProof(
        strk20ServiceForRuntime(deps.runtimeRpc),
        {
          ...context,
          actions: approval.request.actions,
          simulate: approval.request.simulate,
        },
      );
      return { callAndProof, ok: true };
    }
    const commitment = await strk20ServiceForRuntime(deps.runtimeRpc).subaccountCommitment({
      ...context,
      dappName: approval.request.dappName,
      ...(approval.request.nonce === undefined ? {} : { nonce: approval.request.nonce }),
    });
    return { commitment, ok: true };
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
  try {
    const result = await submitStrk20Actions(strk20ServiceForRuntime(deps.runtimeRpc), {
      ...strk20AccountContext(deps, resolved),
      actions: approval.actions,
      plan: approval.plan,
    });
    const actionCount = approval.actions.length;
    await deps.activity.record({
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
