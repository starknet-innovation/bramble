/**
 * Execution of STRK20 requests the user has already approved, plus the account
 * resolution every one of them re-runs first. Split from the request handlers in
 * ./strk20-ops.ts because the trust question differs: those decide whether to
 * QUEUE an approval, these run after consent and are the last point at which a
 * revoked grant, a switched network, or a locked wallet must still fail closed.
 * No SDK private-state operation, protected signing, or proving happens before
 * this boundary.
 */
import { WalletError } from "@mc-wallet/core/errors";
import {
  prepareStrk20CallAndProof,
  readStrk20Balances,
  readStrk20RegistrationStatus,
  registerStrk20Account,
  type Strk20SubmissionPlan,
  type Strk20SubmissionResult,
  submitStrk20Actions,
} from "@mc-wallet/privacy/service";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { ActivityLog } from "@mc-wallet/transactions/activity";
import type { AllowanceStore } from "@mc-wallet/transactions/allowance-store";
import { verificationContext } from "@mc-wallet/transactions/verify";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS, sameFelt } from "@mc-wallet/wallet-model/networks";
import type { Strk20Action } from "@mc-wallet/wallet-protocol/strk20";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { ApprovalContext } from "../approvals/approval-context";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { PassiveUnlockSession } from "../runtime/session";
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
  return {
    account,
    passphrase,
    preferences,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
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
      await assertPublicPoolSpendAffordable(
        deps,
        { accountContext: context, preferences: resolved.preferences, token },
        registration.poolFeeFri,
      );
      const result = await registerStrk20Account(service, {
        ...context,
        poolFeeFri: registration.poolFeeFri,
      });
      await recordPoolAllowances(deps, resolved, result);
      await deps.activity.record({
        accountId: resolved.account.id,
        hash: result.transactionHash,
        kind: "invoke",
        networkId: resolved.account.networkId,
        summary: `${approval.origin} activated private balances`,
      });
      return { ok: true, transactionHash: result.transactionHash };
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
