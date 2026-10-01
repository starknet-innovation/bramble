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

import type { OriginGuard } from "@bramble/permissions/blocklist";
import type { OriginHistoryStore } from "@bramble/permissions/origin-history";
import { isLikelySpam } from "@bramble/portfolio/token-registry";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { type FeeEstimate, sameFeeEstimate } from "@bramble/starknet/fee-bounds";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { AllowanceStore } from "@bramble/transactions/allowance-store";
import { withTokenId } from "@bramble/wallet-model/preferences";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import {
  type DeferredStrk20Approval,
  executeStrk20DisclosureApproval,
  executeStrk20InvokeApproval,
  stageApprovedStrk20Deposit,
  stageApprovedStrk20Registration,
} from "../privacy/strk20-approval-execution";
import {
  matchesStrk20DisclosureKind,
  type Strk20DisclosureApprovalKind,
} from "../privacy/strk20-approval-types";
import { executeAddChainApproval } from "../provider/add-chain-ops";
import { executeInvokeApproval } from "../provider/provider-ops";
import { readApprovalIdInput } from "../routing/message-inputs";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { ActiveStateCoordinator } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type UnlockSession } from "../runtime/session";
import { executeSignApproval, executeSwitchChainApproval } from "../transactions/chain-ops";
import { executeDeclareApproval } from "../transactions/declare-ops";
import { FEE_REVIEW_REQUIRED } from "../transactions/fee-review";
import { settleClaimError, validateClaimContext } from "./approval-claim-context";
import { pendingFeeRefusal } from "./approval-fee-refusal";
import { approvalSession } from "./approval-session";
import type { ApprovalClaim, ApprovalKind, ApprovalQueue, PendingApproval } from "./approvals";
import type { SignatureWaiters } from "./signature-waiters";

/**
 * Dependencies for resolving a queued approval into its settled result. These
 * collaborators stay inside the privileged background boundary.
 */
export type ApprovalDecisionDeps = {
  readonly activeStateCoordinator: ActiveStateCoordinator;
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  readonly approvals: ApprovalQueue;
  readonly guard: OriginGuard;
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly originHistory: OriginHistoryStore;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly waiters: SignatureWaiters;
  readonly wallet: WalletStatusReader;
};

const NOT_FOUND: RuntimeResponse = { error: "approval not found" };
// What a connection whose active account moved between paint and click is refused with.
const ACCOUNT_CHANGED_REFUSAL = "the account changed since this request was reviewed";
/**
 * Outcome of applying an already-claimed approve decision.
 */
type ApplyResult =
  | DeferredStrk20Approval
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
type ApproveDecision = {
  readonly reviewedAccountId?: string;
  readonly reviewedFee?: FeeEstimate;
};

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
  // Same rule as wallet.addToken (audit 171): a dapp-suggested token that
  // borrows a known ticker or carries malformed metadata is stored hidden.
  if (isLikelySpam(approval.token)) {
    await deps.preferencesStore.setTokenHidden({
      hidden: true,
      tokenId: withTokenId(approval.token).id,
    });
  }
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
  if (
    !reviewedFee ||
    !approval.fee ||
    approval.feeEstimateFailed === true ||
    approval.feeEstimatePending === true
  ) {
    return reject(FEE_REVIEW_REQUIRED);
  }
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
      reviewedFee,
    },
  );
  return settleExecutor(result);
};

const applyStrk20Invoke: ApproveApplier = async (deps, { approval, payload }) => {
  if (!payload?.actions || !payload.strk20Plan) {
    return reject(NOT_FOUND);
  }
  const staged = await stageApprovedStrk20Deposit(deps, { approval, payload });
  if (staged) return staged;
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
  if (payload.strk20Request.type === "register") {
    return (
      (await stageApprovedStrk20Registration(deps, { approval, payload })) ?? reject(NOT_FOUND)
    );
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
    {
      activeStateCoordinator: deps.activeStateCoordinator,
      approvals: deps.approvals,
      preferencesStore: deps.preferencesStore,
      session: deps.session,
      wallet: deps.wallet,
    },
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

const applyDeclare: ApproveApplier = async (deps, { approval, payload }, decision) => {
  if (payload?.declare === undefined) {
    return reject(NOT_FOUND);
  }
  const feeRefusal = pendingFeeRefusal(approval, decision.reviewedFee);
  if (feeRefusal) return reject(feeRefusal);
  const declaration = approval.declaration;
  if (!declaration?.fee || !decision.reviewedFee) {
    return reject(FEE_REVIEW_REQUIRED);
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
      reviewedFee: declaration.fee,
      // Bind each component of the displayed total at its own submit boundary.
      ...(declaration.deploymentFee ? { reviewedDeploymentFee: declaration.deploymentFee } : {}),
    },
  );
  return settleExecutor(result);
};

const applyConnect: ApproveApplier = async (deps, { approval }, decision) => {
  return deps.activeStateCoordinator.run(async () => {
    const passphrase = deps.session.getPassphrase();
    const authorized = captureSessionAuthorization(deps.session);
    if (!passphrase || !authorized.isCurrent()) {
      return reject({ error: "wallet locked" });
    }
    // The grant goes to the account the card named, never to whichever account
    // happens to be active when the click lands: the user can switch accounts
    // in the panel while a prompt is open, and a grant that followed the switch
    // would share an account nobody reviewed. The card's echo is compared to the
    // vault's active account and a mismatch is refused, mirroring the fee echo;
    // the id is then pinned into the grant so the write cannot drift either.
    const activeAccountId = (await deps.wallet.readVault(passphrase)).activeAccountId;
    if (!authorized.isCurrent()) {
      return reject({ error: "wallet locked" });
    }
    if (
      decision.reviewedAccountId !== undefined &&
      decision.reviewedAccountId !== activeAccountId
    ) {
      return reject({ error: ACCOUNT_CHANGED_REFUSAL });
    }
    // Explicit lock shares this coordinator; alarm expiry is checked across
    // the durable write by the vault's isAuthorized hook.
    const accounts = await deps.wallet.grantOrigin({
      ...(activeAccountId ? { accountId: activeAccountId } : {}),
      isAuthorized: authorized.isCurrent,
      origin: approval.origin,
      vaultPassphrase: passphrase,
    });
    return {
      respond: () => ({ accounts, ok: true }),
      settle: { accounts, ok: true },
      status: "settle",
    };
  });
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

const applyApproveDecision = async (
  deps: ApprovalDecisionDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readApprovalIdInput(message);
  if (!input) {
    return { error: "invalid approval request" };
  }
  // Refuse a missing or stale fee echo before consuming the queue entry.
  const feeRefusal = pendingFeeRefusal(deps.approvals.get(input.id), input.reviewedFee);
  if (feeRefusal) {
    return feeRefusal;
  }
  // Claim synchronously before any awaited work. A concurrent approve/deny for
  // the same id now sees not-found and can never execute the payload twice.
  const heldSession = approvalSession(deps.session);
  const claim = deps.approvals.claim(input.id);
  if (!claim) {
    return NOT_FOUND;
  }
  await deps.originHistory.record(claim.approval.origin).catch(() => undefined);
  if (deps.guard.isBlocked(claim.approval.origin)) {
    return settleClaimError(deps, input.id, { error: "origin blocked" });
  }
  let contextError: RuntimeResponse | null;
  try {
    contextError = await validateClaimContext(deps, claim);
  } catch {
    return settleClaimError(deps, input.id, { error: "approval execution failed" });
  }
  if (!heldSession.isCurrent() || contextError) {
    return settleClaimError(deps, input.id, contextError ?? { error: "wallet locked" });
  }
  // Everything the deciding surface echoed about its own render travels as the
  // decision; the reader already admits only the known, validated keys.
  const { id, ...decision } = input;
  let result: ApplyResult;
  try {
    result = await APPROVE_APPLIERS[claim.approval.kind](
      { ...deps, session: heldSession.session },
      claim,
      decision,
    );
  } catch {
    return settleClaimError(deps, id, { error: "approval execution failed" });
  }
  if (result.status === "reject") {
    return settleClaimError(deps, id, result.response);
  }
  if (result.status === "defer") {
    return result.respond(() => deps.approvals.list());
  }
  deps.waiters.settle(id, result.settle);
  return result.respond(() => deps.approvals.list());
};

const applyDenyDecision = async (
  deps: ApprovalDecisionDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readApprovalIdInput(message);
  if (!input) {
    return { error: "invalid approval request" };
  }
  const denied = deps.approvals.claim(input.id)?.approval ?? null;
  if (denied) {
    await deps.originHistory.record(denied.origin).catch(() => undefined);
    deps.waiters.settle(input.id, {
      error: denied.kind === "connect" ? "connection rejected" : "request rejected",
    });
  }
  return { ok: true, pending: deps.approvals.list() };
};

/**
 * Handles approve/deny decisions; returns null otherwise.
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
