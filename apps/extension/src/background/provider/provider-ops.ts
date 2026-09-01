/** Dapp provider operations validate origin and phishing policy on every request. */

import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@mc-wallet/permissions/blocklist";
import type { WalletPreferences, WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { ActivityLog } from "@mc-wallet/transactions/activity";
import type { AllowanceStore } from "@mc-wallet/transactions/allowance-store";
import { standingAllowanceTotals } from "@mc-wallet/transactions/allowances";
import {
  refuseOnAccountSelfCall,
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@mc-wallet/transactions/verify";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { Call } from "starknet";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { type ApprovalContext, createApprovalContext } from "../approvals/approval-context";
import { requireApprovalAdmission } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalPayload, ApprovalQueue, PendingApproval } from "../approvals/approvals";
import {
  estimateInvokeApprovalFee,
  FAILED_INVOKE_FEE,
  PENDING_INVOKE_FEE,
} from "../approvals/invoke-fee-review";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import { accountHashSigner } from "../ledger/account-hash-signer";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { allowanceOwner } from "../portfolio/allowance-recording";
import { readAddInvokeTransactionInput } from "../routing/message-inputs";
import { isClaimedSenderOrigin, type RuntimeSender } from "../routing/senders";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { PassiveUnlockSession } from "../runtime/session";
import {
  readGetPermissionsInput,
  readRetryApprovalFeeInput,
  readWatchAssetInput,
} from "./provider-inputs";
import { trackWatchAsset, type WatchAssetAdmission } from "./watch-asset";

/**
 * Dependencies shared by the dapp provider operation handlers.
 */
export type ProviderOpsDeps = {
  /**
   * Allowance log, read (never written) here: it is what the pre-sign review
   * knows already stands for a `(token, spender)` pair, so an increase is judged
   * against the grant beneath it rather than on its own.
   */
  readonly allowanceStore: AllowanceStore;
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly guard?: OriginGuard;
  /**
   * Optional panel round-trip queue for keyless Ledger accounts. Production
   * invoke estimation does not call it; Ledger submission fails closed without it.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  /**
   * Non-renewing session view: a dapp polls these handlers on its own cadence,
   * so a passphrase read here must never extend the inactivity limit.
   */
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
  readonly waiters: SignatureWaiters;
  /** Bounds and deduplicates metadata work before a watch-asset approval exists. */
  readonly watchAssetAdmission: WatchAssetAdmission;
};

/**
 * Dependencies needed to execute a held invoke approval once the user signs off.
 */
export type InvokeExecuteDeps = {
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial test
   * stubs stay valid; a Ledger invoke with no queue wired fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  /**
   * Non-renewing session view: the user's approval click already renewed the
   * window, so executing the held calls must not renew it for the dapp.
   */
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * The active-network account resolved for an origin's live connection grant,
 * together with the passphrase and preferences read while resolving it.
 */
export type ResolvedOriginAccount = {
  readonly account: AccountRef;
  readonly passphrase: string;
  readonly preferences: WalletPreferences;
};

/**
 * Dependencies needed to resolve an origin's active-network account. Both the
 * dapp handlers and the held-approval executor satisfy this shape.
 */
type GrantResolverDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Resolves the account an origin's grant currently maps to on the active
 * network, or an error response the caller returns directly. A locked wallet or
 * a revoked grant fails safely. Single source for the dapp handlers and the
 * held-invoke executor so the fail-closed ordering never drifts between them.
 *
 * Peek, never renew: an origin that keeps calling must not be able to hold the
 * wallet unlocked past its inactivity limit.
 */
export const resolveOriginAccount = async (
  deps: GrantResolverDeps,
  origin: string,
  expected?: ApprovalContext,
): Promise<ResolvedOriginAccount | { readonly error: string }> => {
  const passphrase = deps.session.peekPassphrase();
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
  return { account, passphrase, preferences };
};

// Builds the fee-review target from a resolved grant. The signer is constructed
// here, where the vault credential already lives, so the estimator never
// receives one — and it is passed as a thunk so that construction happens inside
// the estimator's own failure handling rather than at the call site.
const feeReviewTarget = (
  deps: Pick<ProviderOpsDeps, "ledgerSignQueue" | "session" | "wallet">,
  resolved: ResolvedOriginAccount,
  calls: readonly Call[],
  proof?: ApprovalPayload["proof"],
) => ({
  account: resolved.account,
  calls,
  preferences: resolved.preferences,
  ...(proof ? { proof } : {}),
  signer: () => accountHashSigner(deps, resolved.account, resolved.passphrase, "dapp-transaction"),
});

/**
 * Queues an exact invoke/proof batch and starts its fail-closed fee review.
 * Used both by wallet_addInvokeTransaction and the second stage of approved
 * public STRK20 operations so their reviewed and submitted calls cannot drift.
 */
export const queueInvokeApproval = async (
  deps: Pick<
    ProviderOpsDeps,
    "allowanceStore" | "approvals" | "ledgerSignQueue" | "runtimeRpc" | "session" | "wallet"
  >,
  resolved: ResolvedOriginAccount,
  input: {
    readonly calls: readonly Call[];
    readonly origin: string;
    readonly proof?: ApprovalPayload["proof"];
  },
): Promise<{ readonly approval: PendingApproval } | RuntimeResponse> => {
  requireApprovalAdmission(deps.approvals, input.origin);
  const trusted = verificationContext(resolved.account, resolved.preferences);
  const standing = standingAllowanceTotals(
    await deps.allowanceStore.list().catch(() => []),
    allowanceOwner(resolved.account),
    trusted,
  );
  const report = verifyCalls(input.calls, trusted, standing);
  const refusal =
    refuseOnAccountSelfCall(input.calls, resolved.account.address) ??
    refuseOnPoisonedRecipient(report);
  if (refusal) {
    return refusal;
  }
  const approval = deps.approvals.requestInvoke({
    calls: input.calls,
    context: await createApprovalContext(resolved.account, {
      calls: input.calls,
      ...(input.proof === undefined ? {} : { proof: input.proof }),
    }),
    fee: PENDING_INVOKE_FEE,
    flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
    origin: input.origin,
    ...(input.proof === undefined ? {} : { proof: input.proof }),
    reviewAssets: trusted.tokens
      .filter((token) => input.calls.some((call) => sameFelt(call.contractAddress, token.address)))
      .map((token) => ({ address: token.address, symbol: token.symbol })),
    summaries: report.calls.map((call) => call.summary),
  });
  notifyApprovalsChanged();
  const revision = deps.approvals.beginFeeEstimate(approval.id);
  if (revision) {
    void estimateInvokeApprovalFee(
      deps,
      feeReviewTarget(deps, resolved, input.calls, input.proof),
    ).then(
      (fee) => {
        if (deps.approvals.updateFee(revision, { kind: "invoke", review: fee })) {
          notifyApprovalsChanged();
        }
      },
      () => {
        if (deps.approvals.updateFee(revision, { kind: "invoke", review: FAILED_INVOKE_FEE })) {
          notifyApprovalsChanged();
        }
      },
    );
  }
  return { approval };
};

// Fail-closed perimeter shared by the dapp surfaces that error on a blocked
// origin: a claimed-origin mismatch or a blocklisted origin yields the error
// response, otherwise null so the caller proceeds.
const gateDappOrigin = (
  deps: Pick<ProviderOpsDeps, "extensionId" | "guard">,
  sender: RuntimeSender | undefined,
  origin: string,
): { readonly error: string } | null => {
  if (!isClaimedSenderOrigin(sender, deps.extensionId, origin)) {
    return { error: "sender origin mismatch" };
  }
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(origin)) {
    return { error: "origin blocked" };
  }
  return null;
};

type ProviderOpsHandler = (
  deps: ProviderOpsDeps,
  message: unknown,
  sender: RuntimeSender | undefined,
) => Promise<RuntimeResponse | null>;

const handleGetPermissions: ProviderOpsHandler = async (deps, message, sender) => {
  const input = readGetPermissionsInput(message);
  if (!input) {
    return { error: "invalid permissions request" };
  }
  if (!isClaimedSenderOrigin(sender, deps.extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(input.origin)) {
    return { ok: true, permissions: [] };
  }
  // Peek, never renew: a permission query is a passive read a page can issue on
  // a timer, so it must not extend the unlock lifetime.
  const passphrase = deps.session.peekPassphrase();
  const granted = passphrase ? await deps.wallet.getGrantedAccounts(input.origin, passphrase) : [];
  return { ok: true, permissions: granted.length > 0 ? ["accounts"] : [] };
};

const handleWatchAsset: ProviderOpsHandler = async (deps, message, sender) => {
  const input = readWatchAssetInput(message);
  if (!input) {
    return { error: "invalid watch asset request" };
  }
  const gate = gateDappOrigin(deps, sender, input.origin);
  if (gate) {
    return gate;
  }
  const approval = await trackWatchAsset(
    {
      admission: deps.watchAssetAdmission,
      approvals: deps.approvals,
      preferencesStore: deps.preferencesStore,
      runtimeRpc: deps.runtimeRpc,
    },
    input,
  );
  if (approval === true) return { ok: true, watched: true };
  return approval ? deps.waiters.register(approval.id) : { error: "invalid watch asset metadata" };
};

const handleAddInvokeTransaction: ProviderOpsHandler = async (deps, message, sender) => {
  const input = readAddInvokeTransactionInput(message);
  if (!input) {
    return { error: "invalid invoke request" };
  }
  const gate = gateDappOrigin(deps, sender, input.origin);
  if (gate) {
    return gate;
  }
  // Refused before the vault read and the decode below: an invoke prompt never
  // deduplicates, so an origin already holding its full share of the queue is
  // getting this request refused at admission whatever the calls turn out to be.
  requireApprovalAdmission(deps.approvals, input.origin);
  const resolved = await resolveOriginAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  const queued = await queueInvokeApproval(deps, resolved, input);
  return "approval" in queued ? deps.waiters.register(queued.approval.id) : queued;
};

// Re-estimates a queued invoke against its pinned account and network.
const handleRetryApprovalFee: ProviderOpsHandler = async (deps, message) => {
  const input = readRetryApprovalFeeInput(message);
  if (!input) {
    return { error: "invalid fee retry request" };
  }
  const approval = deps.approvals.get(input.id);
  const payload = deps.approvals.payload(input.id);
  if (approval?.kind === "declare") {
    return null;
  }
  if (approval?.kind !== "invoke" || !payload?.calls) {
    return { error: "approval not found" };
  }
  const resolved = await resolveOriginAccount(deps, approval.origin, approval.context);
  if ("error" in resolved) {
    return resolved;
  }
  // Only the newest concurrent retry may update the card.
  const revision = deps.approvals.beginFeeEstimate(input.id);
  if (
    !revision ||
    !deps.approvals.updateFee(revision, { kind: "invoke", review: PENDING_INVOKE_FEE })
  ) {
    return { error: "approval not found" };
  }
  notifyApprovalsChanged();
  const fee = await estimateInvokeApprovalFee(
    deps,
    feeReviewTarget(deps, resolved, payload.calls, payload.proof),
  ).catch(() => FAILED_INVOKE_FEE);
  if (!deps.approvals.updateFee(revision, { kind: "invoke", review: fee })) {
    return { error: "a newer fee estimate replaced this one" };
  }
  notifyApprovalsChanged();
  return { ok: true };
};

/**
 * Dispatch table for dapp provider messages, keyed by message type. Each branch
 * is a self-contained handler, leaving the router a pure lookup.
 */
const PROVIDER_OPS_HANDLERS: Readonly<Record<string, ProviderOpsHandler>> = {
  "wallet.addInvokeTransaction": handleAddInvokeTransaction,
  "wallet.getPermissions": handleGetPermissions,
  "wallet.retryApprovalFee": handleRetryApprovalFee,
  "wallet.watchAsset": handleWatchAsset,
};

/**
 * Handles dapp permission, watch-asset, and invoke messages; returns null for
 * others. Invoke requests are never auto-submitted: they are decoded and queued
 * as an approval so the user can review the calls before anything is signed.
 */
export const handleProviderOps = async (
  deps: ProviderOpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(PROVIDER_OPS_HANDLERS, messageType)
    ? PROVIDER_OPS_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, message, sender) : null;
};
