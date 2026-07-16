/**
 * STRK20 privacy provider operations dispatched from the background message
 * handler: private balance reads, prepare (build call + proof without
 * submitting), and the state-changing invoke that is held behind a user
 * approval. Like the other dapp handlers, each verifies the claimed origin and
 * re-checks the phishing blocklist, and each requires the origin to hold a live
 * connection grant. Failures are returned as stable strings that map to the
 * spec error codes (118/119/120/163) on the wire — never thrown past this
 * boundary, so the specific privacy codes reach the dapp intact.
 */

import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "../security/blocklist";
import { WalletError } from "../shared/errors";
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { normalizeWalletOrigin } from "../shared/origin";
import { STARKNET_NETWORKS } from "../starknet/networks";
import { readStrk20Actions, readStrk20Tokens, type Strk20Action } from "../starknet/strk20/schemas";
import {
  prepareStrk20CallAndProof,
  readStrk20Balances,
  type Strk20Service,
  strk20CallToInvoke,
  summarizeStrk20Action,
  unavailableStrk20Service,
} from "../starknet/strk20/service";
import type { ActivityLog } from "../storage/activity-store";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { notifyApprovalsChanged } from "./approval-notifier";
import type { ApprovalQueue } from "./approvals";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { UnlockSession } from "./session";
import type { SignatureWaiters } from "./signature-waiters";

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
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

type ResolvedAccount = {
  readonly account: AccountRef;
  readonly passphrase: string;
  readonly proverUrl: string | null;
  readonly rpcUrls: readonly string[];
};

const strk20Service = (runtimeRpc: RuntimeRpc): Strk20Service =>
  runtimeRpc.strk20 ?? unavailableStrk20Service;

// Known STRK20 errors carry a stable message that maps to a spec code on the
// wire; anything else collapses to a generic failure (UNKNOWN_ERROR).
const strk20ErrorMessage = (error: unknown): string =>
  error instanceof WalletError ? error.message : "strk20 request failed";

// Resolves the origin's active-network account, or an error response the caller
// can return directly. A locked wallet or a revoked grant fails safely.
const resolveAccount = async (
  deps: Pick<Strk20OpsDeps, "preferencesStore" | "session" | "wallet">,
  origin: string,
): Promise<ResolvedAccount | { readonly error: string }> => {
  const passphrase = deps.session.getPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await deps.preferencesStore.read();
  const granted = await deps.wallet.getGrantedAccounts(origin, passphrase);
  const account = granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    return { error: "origin not connected" };
  }
  return {
    account,
    passphrase,
    proverUrl: preferences.strk20ProverUrl ?? null,
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
  try {
    const balances = await readStrk20Balances(strk20Service(deps.runtimeRpc), {
      account: resolved.account,
      proverUrl: resolved.proverUrl,
      rpcUrls: resolved.rpcUrls,
      tokens: input.tokens,
    });
    return { balances, ok: true };
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
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
  try {
    const callAndProof = await prepareStrk20CallAndProof(strk20Service(deps.runtimeRpc), {
      account: resolved.account,
      actions: input.actions,
      proverUrl: resolved.proverUrl,
      rpcUrls: resolved.rpcUrls,
      simulate: input.simulate,
    });
    return { callAndProof, ok: true };
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
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
  const approval = deps.approvals.requestStrk20Invoke({
    actions: input.actions,
    origin: input.origin,
    summaries: input.actions.map(summarizeStrk20Action),
  });
  notifyApprovalsChanged();
  return deps.waiters.register(approval.id);
};

/**
 * Dispatch table for STRK20 privacy messages, keyed by message type. Each branch
 * is a self-contained handler, leaving the router a pure lookup.
 */
const STRK20_OPS_HANDLERS: Readonly<Record<string, Strk20OpsHandler>> = {
  "wallet.strk20Balances": handleStrk20Balances,
  "wallet.strk20InvokeTransaction": handleStrk20InvokeTransaction,
  "wallet.strk20PrepareInvoke": handleStrk20PrepareInvoke,
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
 * Executes a user-approved STRK20 invoke: re-resolves the active account for the
 * origin, rebuilds the call and proof, submits it, and records the transaction.
 * The private action details never reach the activity summary. Returns an error
 * response instead of throwing so the caller can settle the held request.
 */
export const executeStrk20InvokeApproval = async (
  deps: Strk20ExecuteDeps,
  approval: { readonly actions: readonly Strk20Action[]; readonly origin: string },
): Promise<RuntimeResponse> => {
  const resolved = await resolveAccount(deps, approval.origin);
  if ("error" in resolved) {
    return resolved;
  }
  try {
    const callAndProof = await prepareStrk20CallAndProof(strk20Service(deps.runtimeRpc), {
      account: resolved.account,
      actions: approval.actions,
      proverUrl: resolved.proverUrl,
      rpcUrls: resolved.rpcUrls,
      simulate: false,
    });
    const result = await deps.runtimeRpc.submitInvokeTransaction({
      account: resolved.account,
      calls: [strk20CallToInvoke(callAndProof.call)],
      rpcUrls: resolved.rpcUrls,
      signHash: (messageHash) =>
        deps.wallet.signHash({
          accountId: resolved.account.id,
          messageHash,
          vaultPassphrase: resolved.passphrase,
        }),
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
