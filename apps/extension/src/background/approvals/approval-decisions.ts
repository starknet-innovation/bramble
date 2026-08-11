/**
 * Resolution of queued dapp approvals. `wallet.approveOrigin` settles the held
 * dapp request with its real result (granted accounts, signature, transaction
 * hash, tracked token, or new chain id) and clears the approval;
 * `wallet.denyOrigin` rejects the held request with a spec USER_REFUSED_OP so
 * the dapp promise settles rather than hanging. Only extension pages reach here.
 *
 * An approve decision may carry the fee the deciding surface was displaying.
 * That echo — not the queue's copy at claim time — is what a fee-bearing
 * submission is held to, and a queue that has moved on from it refuses the
 * decision instead of substituting its own figure.
 */

import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { OriginGuard } from "@mc-wallet/permissions/blocklist";
import type { ActivityLog } from "@mc-wallet/transactions/activity";
import type { AllowanceStore } from "@mc-wallet/transactions/allowance-store";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import { executeAddChainApproval } from "../provider/add-chain-ops";

import { approvalPayloadMatchesContext } from "./approval-context";
import type { ApprovalClaim, ApprovalKind, ApprovalQueue, PendingApproval } from "./approvals";
import { executeSignApproval, executeSwitchChainApproval } from "../transactions/chain-ops";
import { executeDeclareApproval } from "../transactions/declare-ops";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { readApprovalIdInput } from "../routing/message-inputs";
import { executeInvokeApproval } from "../provider/provider-ops";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
import type { SignatureWaiters } from "./signature-waiters";
import {
  executeStrk20DisclosureApproval,
  executeStrk20InvokeApproval,
} from "../privacy/strk20-approval-execution";
import {
  matchesStrk20DisclosureKind,
  type Strk20DisclosureApprovalKind,
} from "../privacy/strk20-approval-types";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { type FeeEstimate, sameFeeEstimate } from "@mc-wallet/starknet/fee-bounds";


/**
 * Dependencies for resolving a queued approval into its settled result.
 */
export type ApprovalDecisionDeps = {
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  readonly approvals: ApprovalQueue;
  readonly guard: OriginGuard;
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly waiters: SignatureWaiters;
  readonly wallet: WalletStatusReader;
};

const NOT_FOUND: RuntimeResponse = { error: "approval not found" };

/**
 * Outcome of applying an already-claimed approve decision. `reject` settles
 * the held request with the failure; `settle` delivers its execution result.
 * The id has already been removed atomically before either branch runs.
 */
type ApplyResult =
  | { readonly status: "reject"; readonly response: RuntimeResponse }
  | {
      readonly status: "settle";
      readonly settle: RuntimeResponse;
      readonly respond: (listPending: () => readonly PendingApproval[]) => RuntimeResponse;
    };

/**
 * What the deciding surface reported about its own render, alongside the id it
 * decided. Only the fee travels today; it is separate from the claimed approval
 * because it describes the CARD, not the queue entry.
 */
type ApproveDecision = { readonly reviewedFee?: FeeEstimate };

type ApproveApplier = (
  deps: ApprovalDecisionDeps,
  claim: ApprovalClaim,
  decision: ApproveDecision,
) => Promise<ApplyResult>;

const reject = (response: RuntimeResponse): ApplyResult => ({ response, status: "reject" });

/**
 * Shared tail for executor-backed kinds: settle the executor result either way,
 * pass its error through on failure, and surface `{ ok, pending }` on success.
 */
const settleExecutor = (result: RuntimeResponse): ApplyResult => ({
  respond: (listPending) => ("error" in result ? result : { ok: true, pending: listPending() }),
  settle: result,
  status: "settle",
});

const applyWatchAsset: ApproveApplier = async (deps, { approval }) => {
  if (!approval.token) {
    return reject(NOT_FOUND);
  }
  await deps.preferencesStore.upsertToken(approval.token);
  return {
    respond: (listPending) => ({ ok: true, pending: listPending() }),
    settle: { ok: true, watched: true },
    status: "settle",
  };
};

const applyInvoke: ApproveApplier = async (deps, { approval, payload }, decision) => {
  if (!payload) {
    return reject(NOT_FOUND);
  }
  const reviewedFee = decision.reviewedFee;
  // The ceiling is the figure the clicking surface says it was displaying, and
  // it only binds if the queue still agrees with it. A fee slot can be replaced
  // between paint and click — a retry pressed on a second open wallet surface
  // re-estimates the same approval — so a card that has not repainted since
  // would otherwise consent to a snapshot it never showed. A moved figure is
  // refused rather than substituted: the honest answer is "re-review", not a
  // ceiling of the wallet's own choosing.
  if (reviewedFee && !(approval.fee && sameFeeEstimate(reviewedFee, approval.fee))) {
    return reject({ error: "the fee changed since this request was reviewed" });
  }
  const result = await executeInvokeApproval(
    {
      activity: deps.activity,
      allowanceStore: deps.allowanceStore,
      preferencesStore: deps.preferencesStore,
      runtimeRpc: deps.runtimeRpc,
      session: deps.session,
      wallet: deps.wallet,
      ...(deps.ledgerSignQueue ? { ledgerSignQueue: deps.ledgerSignQueue } : {}),
    },
    {
      ...(approval.context === undefined ? {} : { context: approval.context }),
      origin: approval.origin,
      payload,
      // No echo means the surface displayed no fee to consent to (still
      // estimating, or the estimate failed), so the submission goes out unbound
      // — honest, and the same treatment the panel send journeys give a review
      // they could not price.
      ...(reviewedFee ? { reviewedFee } : {}),
    },
  );
  return settleExecutor(result);
};

const applyStrk20Invoke: ApproveApplier = async (deps, { approval, payload }) => {
  if (!payload?.actions || !payload.strk20Plan) {
    return reject(NOT_FOUND);
  }
  const result = await executeStrk20InvokeApproval(
    {
      activity: deps.activity,
      allowanceStore: deps.allowanceStore,
      preferencesStore: deps.preferencesStore,
      runtimeRpc: deps.runtimeRpc,
      session: deps.session,
      wallet: deps.wallet,
      ...(deps.ledgerSignQueue ? { ledgerSignQueue: deps.ledgerSignQueue } : {}),
    },
    {
      actions: payload.actions,
      ...(approval.context === undefined ? {} : { context: approval.context }),
      origin: approval.origin,
      plan: payload.strk20Plan,
    },
  );
  return settleExecutor(result);
};

const isStrk20DisclosureKind = (kind: ApprovalKind): kind is Strk20DisclosureApprovalKind =>
  kind === "strk20-balances" ||
  kind === "strk20-prepare" ||
  kind === "strk20-register" ||
  kind === "strk20-subaccount";

const applyStrk20Disclosure: ApproveApplier = async (deps, { approval, payload }) => {
  if (
    !payload?.strk20Request ||
    !isStrk20DisclosureKind(approval.kind) ||
    !matchesStrk20DisclosureKind(approval.kind, payload.strk20Request)
  ) {
    return reject(NOT_FOUND);
  }
  const result = await executeStrk20DisclosureApproval(
    {
      activity: deps.activity,
      allowanceStore: deps.allowanceStore,
      preferencesStore: deps.preferencesStore,
      runtimeRpc: deps.runtimeRpc,
      session: deps.session,
      wallet: deps.wallet,
      ...(deps.ledgerSignQueue ? { ledgerSignQueue: deps.ledgerSignQueue } : {}),
    },
    {
      ...(approval.context === undefined ? {} : { context: approval.context }),
      origin: approval.origin,
      request: payload.strk20Request,
    },
  );
  return settleExecutor(result);
};

const applySignTypedData: ApproveApplier = async (deps, { approval, payload }) => {
  if (payload?.typedData === undefined) {
    return reject(NOT_FOUND);
  }
  const result = await executeSignApproval(
    {
      preferencesStore: deps.preferencesStore,
      session: deps.session,
      wallet: deps.wallet,
      ...(deps.ledgerSignQueue ? { ledgerSignQueue: deps.ledgerSignQueue } : {}),
    },
    {
      ...(approval.context === undefined ? {} : { context: approval.context }),
      origin: approval.origin,
      typedData: payload.typedData,
    },
  );
  return settleExecutor(result);
};

const applySwitchChain: ApproveApplier = async (deps, { approval, payload }) => {
  if (payload?.networkId === undefined || payload.chainId === undefined) {
    return reject(NOT_FOUND);
  }
  const chainId = payload.chainId;
  const result = await executeSwitchChainApproval(
    { preferencesStore: deps.preferencesStore, session: deps.session, wallet: deps.wallet },
    { networkId: payload.networkId, origin: approval.origin },
  );
  return {
    respond: (listPending) =>
      "error" in result ? result : { chainId, ok: true, pending: listPending() },
    settle: result,
    status: "settle",
  };
};

const applyAddChain: ApproveApplier = async (deps, { payload }) => {
  if (payload?.chain === undefined) {
    return reject(NOT_FOUND);
  }
  const result = await executeAddChainApproval(
    { preferencesStore: deps.preferencesStore },
    { chain: payload.chain },
  );
  return settleExecutor(result);
};

const applyDeclare: ApproveApplier = async (deps, { approval, payload }) => {
  if (payload?.declare === undefined) {
    return reject(NOT_FOUND);
  }
  const result = await executeDeclareApproval(
    {
      activity: deps.activity,
      preferencesStore: deps.preferencesStore,
      runtimeRpc: deps.runtimeRpc,
      session: deps.session,
      wallet: deps.wallet,
      ...(deps.ledgerSignQueue ? { ledgerSignQueue: deps.ledgerSignQueue } : {}),
    },
    {
      ...(approval.context === undefined ? {} : { context: approval.context }),
      declare: payload.declare,
      origin: approval.origin,
      // The declaration fee shown on the card. Null (estimate failed) leaves
      // the submission unbound, which is honest — no fee was reviewed.
      ...(approval.declaration?.fee ? { reviewedFee: approval.declaration.fee } : {}),
      // The deployment fee shown on the same card, for an undeployed account.
      // The card adds the two into an "Estimated total", so both halves of that
      // total are bound or the total is a number the wallet does not stand by.
      ...(approval.declaration?.deploymentFee
        ? { reviewedDeploymentFee: approval.declaration.deploymentFee }
        : {}),
    },
  );
  return settleExecutor(result);
};

const applyConnect: ApproveApplier = async (deps, { approval }) => {
  const passphrase = deps.session.getPassphrase();
  if (!passphrase) {
    return reject({ error: "wallet locked" });
  }
  // Deliver the granted accounts back through the dapp's held requestAccounts
  // channel (if any) so enable() resolves after approval.
  const accounts = await deps.wallet.grantOrigin({
    origin: approval.origin,
    vaultPassphrase: passphrase,
  });
  return {
    respond: () => ({ accounts, ok: true }),
    settle: { accounts, ok: true },
    status: "settle",
  };
};

/**
 * Total map from approval kind to its approve applier. Keeping it exhaustive
 * over `ApprovalKind` means an added kind is a compile error here rather than a
 * silent fall-through to the connection path.
 */
const APPROVE_APPLIERS: Record<ApprovalKind, ApproveApplier> = {
  "add-chain": applyAddChain,
  connect: applyConnect,
  declare: applyDeclare,
  invoke: applyInvoke,
  "sign-typed-data": applySignTypedData,
  "strk20-balances": applyStrk20Disclosure,
  "strk20-invoke": applyStrk20Invoke,
  "strk20-prepare": applyStrk20Disclosure,
  "strk20-register": applyStrk20Disclosure,
  "strk20-subaccount": applyStrk20Disclosure,
  "switch-chain": applySwitchChain,
  "watch-asset": applyWatchAsset,
};

const validateClaimContext = async (
  deps: ApprovalDecisionDeps,
  claim: ApprovalClaim,
): Promise<RuntimeResponse | null> => {
  const { context } = claim.approval;
  if (!context) {
    return null;
  }
  const passphrase = deps.session.getPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await deps.preferencesStore.read();
  if (
    preferences.activeNetworkId !== context.networkId ||
    STARKNET_NETWORKS[context.networkId].chainId !== context.chainId
  ) {
    return { error: "approval context changed" };
  }
  const granted = await deps.wallet.getGrantedAccounts(claim.approval.origin, passphrase);
  if (
    !granted.some(
      (account) => account.id === context.accountId && account.networkId === context.networkId,
    )
  ) {
    return { error: "approval context changed" };
  }
  return claim.payload && (await approvalPayloadMatchesContext(context, claim.payload))
    ? null
    : { error: "approval payload changed" };
};

const settleClaimError = (
  deps: ApprovalDecisionDeps,
  id: string,
  response: RuntimeResponse,
): RuntimeResponse => {
  deps.waiters.settle(id, response);
  return response;
};

const applyApproveDecision = async (
  deps: ApprovalDecisionDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readApprovalIdInput(message);
  if (!input) {
    return { error: "invalid approval request" };
  }
  // Claim synchronously before any awaited work. A concurrent approve/deny for
  // the same id now sees not-found and can never execute the payload twice.
  const claim = deps.approvals.claim(input.id);
  if (!claim) {
    return NOT_FOUND;
  }
  if (deps.guard.isBlocked(claim.approval.origin)) {
    return settleClaimError(deps, input.id, { error: "origin blocked" });
  }
  let contextError: RuntimeResponse | null;
  try {
    contextError = await validateClaimContext(deps, claim);
  } catch {
    return settleClaimError(deps, input.id, { error: "approval execution failed" });
  }
  if (contextError) {
    return settleClaimError(deps, input.id, contextError);
  }
  let result: ApplyResult;
  try {
    result = await APPROVE_APPLIERS[claim.approval.kind](deps, claim, {
      ...(input.reviewedFee ? { reviewedFee: input.reviewedFee } : {}),
    });
  } catch {
    return settleClaimError(deps, input.id, { error: "approval execution failed" });
  }
  if (result.status === "reject") {
    return settleClaimError(deps, input.id, result.response);
  }
  deps.waiters.settle(input.id, result.settle);
  return result.respond(() => deps.approvals.list());
};

const applyDenyDecision = (deps: ApprovalDecisionDeps, message: unknown): RuntimeResponse => {
  const input = readApprovalIdInput(message);
  if (!input) {
    return { error: "invalid approval request" };
  }
  const denied = deps.approvals.claim(input.id)?.approval ?? null;
  // Reject the dapp's held request (if any) so it does not hang after a deny.
  if (denied) {
    deps.waiters.settle(input.id, {
      error: denied.kind === "connect" ? "connection rejected" : "request rejected",
    });
  }
  return { ok: true, pending: deps.approvals.list() };
};

/**
 * Handles `wallet.approveOrigin` / `wallet.denyOrigin`; returns null otherwise.
 */
export const handleApprovalDecision = async (
  deps: ApprovalDecisionDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.approveOrigin") {
    return applyApproveDecision(deps, message);
  }
  if (messageType === "wallet.denyOrigin") {
    return applyDenyDecision(deps, message);
  }
  return null;
};
