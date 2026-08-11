/**
 * Execution of already-approved STRK20 privacy operations for a connected site.
 *
 * Split from ./strk20-ops by trust step, not just for size: everything here runs
 * only after the user approved a specific reviewed request, so each entry
 * re-resolves the origin's account and re-checks the approval context before any
 * private read, proof, or signature. Nothing in this module may be reached from
 * an unapproved message.
 */

import { STRK20_SIGN_INTENTS } from "@mc-wallet/ledger-protocol/intent";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { Strk20Action } from "@mc-wallet/wallet-protocol/strk20";
import {
  prepareStrk20CallAndProof,
  readStrk20Balances,
  readStrk20RegistrationStatus,
  registerStrk20Account,
  type Strk20SubmissionPlan,
  submitStrk20Actions,
} from "@mc-wallet/privacy/service";
import type { ActivityLog } from "@mc-wallet/transactions/activity";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { ApprovalContext } from "../approvals/approval-context";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
import { strk20AccountContext, strk20ServiceForRuntime } from "./strk20-account-context";
import type { Strk20DisclosureRequest } from "./strk20-approval-types";
import { assertPublicPoolSpendAffordable } from "./strk20-op-context";
import { resolveAccount, strk20ErrorMessage } from "./strk20-origin-account";
import type { WalletStatusReader } from "../accounts/wallet-reader";

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
  const context = strk20AccountContext(deps, resolved, STRK20_SIGN_INTENTS.dapp);
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
      // Registration signs for its own reason, not the authorize-labelled one.
      const result = await registerStrk20Account(service, {
        ...strk20AccountContext(deps, resolved, STRK20_SIGN_INTENTS.register),
        poolFeeFri: registration.poolFeeFri,
      });
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
      ...strk20AccountContext(deps, resolved, STRK20_SIGN_INTENTS.dapp),
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
