/**
 * dApp-facing `wallet_addDeclareTransaction` handling. A connected origin may
 * ask the wallet to declare a contract class, but the declare is never
 * auto-submitted: it is validated and queued as a "declare" approval whose
 * response is held until the user approves in the side panel. The large
 * CONTRACT_CLASS stays in the private approval payload, never in the UI
 * snapshot. On approve the declare is signed and submitted through the RPC
 * layer; on deny the held request settles as a refusal.
 */

import { walletErrorMessage } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { normalizeWalletOrigin } from "@bramble/core/origin";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { isProviderDeclare, type ProviderDeclare } from "@bramble/wallet-protocol/declare";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { type ApprovalContext, createApprovalContext } from "../approvals/approval-context";
import { withApprovalReservation } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { PendingApproval } from "../approvals/approval-snapshot";
import type { ApprovalQueue } from "../approvals/approvals";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import { accountHashSigner } from "../ledger/account-hash-signer";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { readRetryApprovalFeeInput } from "../provider/provider-inputs";
import {
  type ExtensionIdentity,
  isClaimedSenderOrigin,
  type RuntimeSender,
} from "../routing/senders";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type PassiveUnlockSession } from "../runtime/session";
import { FEE_REVIEW_REQUIRED } from "./fee-review";

/**
 * Dependencies for the dapp declare handler.
 */
export type DeclareOpsDeps = {
  readonly approvals: ApprovalQueue;
  readonly extension: ExtensionIdentity;
  readonly guard?: OriginGuard;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  /**
   * Non-renewing session view: a page can issue this request on its own
   * cadence, so reading the passphrase here must never extend the unlock
   * lifetime.
   */
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
  readonly waiters: SignatureWaiters;
};

/**
 * Dependencies needed to execute a held declare approval once the user signs off.
 */
export type DeclareExecuteDeps = {
  /**
   * Activity log a submitted declare is journalled in, so an approved,
   * fee-paying declare is auditable and followed to acceptance or revert like
   * every other submitted transaction. Required, deliberately: making it
   * optional is exactly how the journal was silently dropped by the one
   * production caller while the executor's own test kept passing.
   */
  readonly activity: ActivityLog;
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial test
   * stubs stay valid; a Ledger declare with no queue wired fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  /**
   * Non-renewing session view: the user's approval click already renewed the
   * window, so submitting the held declare must not renew it for the dapp.
   */
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Parses a `wallet.addDeclareTransaction` runtime message crossed from the
 * content bridge, re-validating the declare payload and normalizing the origin.
 */
export const readAddDeclareTransactionInput = (
  message: unknown,
): { readonly declare: ProviderDeclare; readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["declare", "origin", "type"]) ||
    message["type"] !== "wallet.addDeclareTransaction" ||
    !isProviderDeclare(message["declare"])
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { declare: message["declare"], origin } : null;
};

const declareSummaries = (declare: ProviderDeclare): readonly string[] => [
  `Compiled class hash ${declare.compiledClassHash}`,
  ...(declare.classHash === undefined ? [] : [`Class hash ${declare.classHash}`]),
];

// The activity line for a submitted declare. Deterministic and built only from
// the already-validated request felts, never from node output: activity
// summaries are load-bearing (multisig dedup guards match on them exactly — see
// multisig-deploy-ops.ts, which keys off "Declare multisig class" and a
// " at 0x…" deploy marker), so this wording is deliberately distinct from both
// and identifies the class the dapp asked to declare.
const declareActivitySummary = (declare: ProviderDeclare): string =>
  `Declare contract class ${declare.classHash ?? declare.compiledClassHash}`;

const countArray = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const declarationStructure = (declare: ProviderDeclare) => {
  const contract = isRecord(declare.contractClass) ? declare.contractClass : {};
  const entryPoints = isRecord(contract["entry_points_by_type"])
    ? Object.values(contract["entry_points_by_type"]).reduce<number>(
        (total, entries) => total + countArray(entries),
        0,
      )
    : 0;
  return {
    abiEntryCount: countArray(contract["abi"]),
    ...(declare.classHash === undefined ? {} : { classHash: declare.classHash }),
    compiledClassHash: declare.compiledClassHash,
    entryPointCount: entryPoints,
    sierraProgramLength: countArray(contract["sierra_program"]),
  };
};

const declarationReview = async (
  deps: DeclareOpsDeps,
  account: AccountRef,
  declare: ProviderDeclare,
  preferences: Awaited<ReturnType<WalletPreferencesStore["read"]>>,
  passphrase: string,
) => {
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences);
  let accountDeployment: "deployed" | "undeployed" | "unknown" = "unknown";
  try {
    accountDeployment = (await deps.runtimeRpc.getDeploymentStatus({
      accountAddress: account.address,
      rpcUrls,
    }))
      ? "deployed"
      : "undeployed";
  } catch {
    accountDeployment = "unknown";
  }
  const fee = deps.runtimeRpc.estimateDeclareFee
    ? await deps.runtimeRpc
        .estimateDeclareFee({
          account,
          compiledClassHash: declare.compiledClassHash,
          contractClass: declare.contractClass,
          rpcUrls,
          signHash: accountHashSigner(deps, account, passphrase),
          ...(declare.classHash === undefined ? {} : { classHash: declare.classHash }),
        })
        .catch(() => null)
    : null;
  const deploymentFee =
    accountDeployment === "undeployed" && deps.runtimeRpc.estimateAccountDeploymentFee
      ? await deps.runtimeRpc
          .estimateAccountDeploymentFee({
            account,
            rpcUrls,
            signHash: accountHashSigner(deps, account, passphrase),
          })
          .catch(() => null)
      : null;
  return {
    ...declarationStructure(declare),
    accountDeployment,
    deploymentFee,
    deploymentFeeEstimateFailed: accountDeployment === "undeployed" && deploymentFee === null,
    fee,
    feeEstimateFailed: fee === null,
  };
};

const declarationErrorMessage = (error: unknown): string => {
  const curated = walletErrorMessage(error, "");
  if (curated) {
    return curated;
  }
  const message = error instanceof Error ? error.message : "";
  if (/already declared/i.test(message)) {
    return "This contract class is already declared on the selected network.";
  }
  if (/insufficient|balance|fee.*exceed|max.*fee/i.test(message)) {
    return "The account does not have enough STRK to pay the declaration fee.";
  }
  if (/compiled class hash|class hash.*mismatch/i.test(message)) {
    return "The declaration artifact does not match its compiled class hash.";
  }
  if (/validation|validate/i.test(message)) {
    return "The account contract rejected the declaration during Starknet validation.";
  }
  return "Starknet rejected the declaration. Check the account's STRK balance, network, and class hashes, then try again.";
};

const retryDeclarationFee = async (
  deps: DeclareOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readRetryApprovalFeeInput(message);
  if (!input) return { error: "invalid fee retry request" };
  const approval = deps.approvals.get(input.id);
  const payload = deps.approvals.payload(input.id);
  if (approval?.kind !== "declare" || !payload?.declare || !approval.context) {
    return { error: "approval not found" };
  }
  const revision = deps.approvals.beginFeeEstimate(input.id);
  if (!revision) return { error: "approval not found" };
  // Withdraw the reviewed fee while the estimate is redone, so nothing can be
  // approved against it. The withdrawn shape is a failed estimate, the one
  // fee-less shape the panel accepts: an "estimating" shape (no fee, no
  // failure) is dropped by the panel's validator, which hid the card, and an
  // early return below would have left it hidden (Sherlock 241). A failed
  // estimate keeps the card on screen with its retry control.
  if (
    !approval.declaration ||
    !deps.approvals.updateFee(revision, {
      declaration: {
        ...approval.declaration,
        accountDeployment: "unknown",
        deploymentFee: null,
        deploymentFeeEstimateFailed: false,
        fee: null,
        feeEstimateFailed: true,
      },
      kind: "declare",
    })
  ) {
    return { error: "approval not found" };
  }
  notifyApprovalsChanged();
  const passphrase = deps.session.peekPassphrase();
  if (!passphrase) return { error: "wallet locked" };
  const preferences = await deps.preferencesStore.read();
  if (preferences.activeNetworkId !== approval.context.networkId) {
    return { error: "approval context changed" };
  }
  const granted = await deps.wallet.getGrantedAccounts(approval.origin, passphrase);
  const account = granted.find(
    (stored) =>
      stored.id === approval.context?.accountId &&
      stored.networkId === approval.context.networkId &&
      stored.networkId === preferences.activeNetworkId,
  );
  if (!account) return { error: "origin not connected" };
  const declaration = await declarationReview(
    deps,
    account,
    payload.declare,
    preferences,
    passphrase,
  );
  if (!deps.approvals.updateFee(revision, { declaration, kind: "declare" })) {
    return { error: "a newer fee estimate replaced this one" };
  }
  notifyApprovalsChanged();
  return { ok: true };
};

// Everything a declare does between admission and the queue: the session and
// vault reads, the class hash and both fee estimates. It runs under the
// origin's admission reservation, released in the same step that queues the
// approval.
const queueDeclare = async (
  deps: DeclareOpsDeps,
  input: NonNullable<ReturnType<typeof readAddDeclareTransactionInput>>,
  release: () => void,
): Promise<{ readonly approval: PendingApproval } | RuntimeResponse> => {
  const { approvals, preferencesStore, session, wallet } = deps;
  // Captured before the first read and re-checked after every await, so a
  // lock that lands mid-request admits no card under the unlock the user just
  // revoked (Sherlock 166).
  const authorized = captureSessionAuthorization(session);
  const passphrase = session.peekPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await preferencesStore.read();
  const granted = await wallet.getGrantedAccounts(input.origin, passphrase);
  if (!authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  const account = granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    return { error: "origin not connected" };
  }
  const context = await createApprovalContext(account, { declare: input.declare });
  const declaration = await declarationReview(
    deps,
    account,
    input.declare,
    preferences,
    passphrase,
  );
  if (!authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  const approval = approvals.requestDeclare({
    context,
    declare: input.declare,
    declaration,
    origin: input.origin,
    summaries: declareSummaries(input.declare),
  });
  release();
  notifyApprovalsChanged();
  return { approval };
};

/**
 * Handles a dapp declare message; returns null for other message types.
 */
export const handleDeclareOps = async (
  deps: DeclareOpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.retryApprovalFee") {
    return retryDeclarationFee(deps, message);
  }
  if (messageType !== "wallet.addDeclareTransaction") {
    return null;
  }
  const { approvals, extension, waiters } = deps;
  const guard = deps.guard ?? DEFAULT_ORIGIN_GUARD;
  const input = readAddDeclareTransactionInput(message);
  if (!input) {
    return { error: "invalid declare request" };
  }
  if (!isClaimedSenderOrigin(sender, extension, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if (guard.isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  // A declare prompt never deduplicates, and everything below it is expensive:
  // a vault read, then a declaration review that hashes the contract class and
  // estimates two fees. An origin already holding its share of the queue is
  // refused at admission regardless, so it is refused here instead of after.
  // The reservation counts this request against the caps while that work
  // runs, so concurrent requests cannot all start it (Sherlock 151).
  const queued = await withApprovalReservation(approvals, input.origin, (release) =>
    queueDeclare(deps, input, release),
  );
  // Registered once the reservation is released: the queued approval now
  // counts against the caps itself, and the held response settles only when
  // the user decides.
  return "approval" in queued ? waiters.register(queued.approval.id) : queued;
};

/**
 * Executes a user-approved declare: re-resolves the active account for the
 * origin (a locked wallet or revoked grant fails safely), submits the held
 * declare, and returns the node's transaction and class hashes. Returns an
 * actionable error response instead of throwing so the claimed request and
 * held dapp promise settle together without leaving stale approval controls.
 *
 * `reviewedFee` is the declaration fee the approval card was showing when the
 * user approved; it travels into the submit boundary as a signing ceiling, so a
 * declaration that has grown more expensive since the review is refused rather
 * than signed. `reviewedDeploymentFee` does the same for the account deployment
 * an undeployed account submits first — the card totals the two, so binding
 * only one of them would leave the larger half of that total unenforced.
 */
export const executeDeclareApproval = async (
  deps: DeclareExecuteDeps,
  input: {
    readonly context?: ApprovalContext;
    readonly declare: ProviderDeclare;
    readonly origin: string;
    readonly reviewedDeploymentFee?: FeeEstimate;
    readonly reviewedFee?: FeeEstimate;
  },
): Promise<RuntimeResponse> => {
  const { preferencesStore, runtimeRpc, session, wallet } = deps;
  if (!input.reviewedFee) {
    return FEE_REVIEW_REQUIRED;
  }
  const passphrase = session.peekPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const authorized = captureSessionAuthorization(session);
  const preferences = await preferencesStore.read();
  if (input.context && preferences.activeNetworkId !== input.context.networkId) {
    return { error: "approval context changed" };
  }
  const granted = await wallet.getGrantedAccounts(input.origin, passphrase);
  const account = input.context
    ? granted.find(
        (stored) =>
          stored.id === input.context?.accountId &&
          stored.networkId === input.context.networkId &&
          stored.networkId === preferences.activeNetworkId,
      )
    : granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    return { error: "origin not connected" };
  }
  // A keyless Ledger account signs on the device (verified against publicKeyX),
  // every other account through the vault — the same seam wallet-initiated txns
  // use. A device rejection/timeout/verify-failure, or a Ledger account with no
  // queue wired, throws a WalletError from the sign path: catch it and return
  // `{ error }` (mirroring executeStrk20InvokeApproval) so the applier settles
  // the held dapp request with the real reason instead of leaving it to hang on
  // an unhandled throw. Fails closed — nothing is submitted on error.
  let result: { readonly classHash: string; readonly transactionHash: string };
  try {
    result = await runtimeRpc.submitDeclareTransaction({
      account,
      compiledClassHash: input.declare.compiledClassHash,
      contractClass: input.declare.contractClass,
      isAuthorized: authorized.isCurrent,
      // The declaration fee the approval card showed becomes the ceiling this
      // submission may sign under (MCW-V09-119), and the deployment fee it
      // showed alongside becomes the ceiling on the deployment submitted first.
      ...(input.reviewedFee ? { reviewedFee: input.reviewedFee } : {}),
      ...(input.reviewedDeploymentFee
        ? { reviewedDeploymentFee: input.reviewedDeploymentFee }
        : {}),
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
      signHash: accountHashSigner(deps, account, passphrase),
      ...(input.declare.classHash === undefined ? {} : { classHash: input.declare.classHash }),
    });
  } catch (error) {
    return { error: declarationErrorMessage(error) };
  }
  // Journal the submitted declare like every other submitted transaction, so it
  // appears in the activity feed and CSV export and background reconciliation
  // follows it to acceptance or revert. The transaction is already on chain by
  // this point, so a storage failure must not be reported to the dapp as a
  // failed declare.
  await deps.activity
    .record({
      accountId: account.id,
      hash: result.transactionHash,
      kind: "declare",
      networkId: account.networkId,
      summary: declareActivitySummary(input.declare),
    })
    .catch(() => undefined);
  return { classHash: result.classHash, ok: true, transactionHash: result.transactionHash };
};
