/**
 * Native sweep of a recorded shadow account (#443, PR 5). A shadow account is
 * bound to its site, so if the site disappears, or a `diff`/`exact` policy
 * leaves a remainder, only this wallet can move what is left. The sweep is one
 * OPEN transfer to this account per token the shadow account holds, then a
 * `shadow_account_invoke` with no calls and `collect_policy: all`, which the
 * anonymizer accepts and which settles every balance into private notes. It is
 * always relayed, so the relay fee comes from the private balance.
 *
 * The preparation answers on its request (a few reads and a relay quote, no
 * proof) and is executed through the shared one-time preparation path.
 */
import { WalletError } from "@bramble/core/errors";
import {
  quoteStrk20Actions,
  readStrk20RegistrationStatus,
  type Strk20SubmissionResult,
  submitStrk20Actions,
  summarizeStrk20Plan,
} from "@bramble/privacy/service";
import {
  SHADOW_INVOKE_ANONYMIZER,
  SHADOW_INVOKE_SETTLES,
  SHADOW_SWEEP_SUMMARY,
} from "@bramble/privacy/shadow-account-copy";
import {
  SHADOW_ACCOUNT_HOLDS_NO_TRACKED_TOKEN,
  SHADOW_SWEEP_BREAKS_BATCH_RULE,
} from "@bramble/privacy/shadow-account-refusals";
import type { TokenConfig } from "@bramble/settings/preferences";
import { activityOrigin } from "@bramble/transactions/activity";
import type { ShadowAccountScopeRef } from "@bramble/vault/shadow-account-scopes";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import { strk20BatchRefusal } from "@bramble/wallet-protocol/strk20-batch";
import { createApprovalContext } from "../approvals/approval-context";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";
import { strk20FeeAssetFor } from "./strk20-fee-reference";
import type { ActivePrivacyContext, Strk20WalletOpsDeps } from "./strk20-op-context";
import { bindStrk20ActionsToOrigin } from "./strk20-shadow-account";
import { readShadowAccounts, type ShadowScopeTarget } from "./strk20-shadow-reads";
import {
  type Strk20ShadowSweepPreparation,
  strk20WalletPreparationPayload,
} from "./strk20-wallet-preparations";

const displayNonce = (nonce: string): string => BigInt(nonce).toString();

// The exact sweep batch: an OPEN transfer to `owner` per held token, in the
// given order, before one call-less shadow invoke under the site's `label`.
const shadowSweepActions = (
  owner: string,
  tokens: readonly string[],
  label: string,
  nonce: string,
): readonly Strk20Action[] => [
  ...tokens.map((token) => ({
    amount: "OPEN",
    recipient: owner,
    token,
    type: "transfer" as const,
  })),
  {
    calls: [],
    collect_policy: { type: "all" as const },
    dapp_name: label,
    nonce,
    type: "shadow_account_invoke" as const,
  },
];

/**
 * Builds and stores the one-time sweep review for one recorded shadow account.
 * Refuses when the account is not registered, the scope's anonymizer is not
 * the one configured, the shadow account holds no tracked token, or the relay
 * route cannot pay its fee from the private balance.
 */
export const prepareShadowSweep = async (
  deps: Strk20WalletOpsDeps,
  context: ActivePrivacyContext,
  records: readonly ShadowAccountScopeRef[],
  target: ShadowScopeTarget & { readonly nonce: string },
): Promise<RuntimeResponse> => {
  const service = strk20ServiceForRuntime(deps.runtimeRpc);
  const registration = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    token: context.token.address,
  });
  if (registration !== "registered") {
    return { error: "Activate private balances before sending privately" };
  }
  const listed = await readShadowAccounts(deps, context, records, target, [BigInt(target.nonce)]);
  const shadow = listed.accounts.find((entry) => BigInt(entry.nonce) === BigInt(target.nonce));
  const held: readonly TokenConfig[] = (shadow?.balances ?? []).flatMap((balance) => {
    const token = context.preferences.tokens.find((candidate) => candidate.id === balance.tokenId);
    return token && BigInt(balance.balance) > 0n ? [token] : [];
  });
  const [first] = held;
  const config = context.accountContext.config;
  if (!shadow || !first || !config) {
    return { error: SHADOW_ACCOUNT_HOLDS_NO_TRACKED_TOKEN };
  }
  const owner = context.accountContext.account.address;
  const actions = shadowSweepActions(
    owner,
    held.map((token) => token.address),
    target.label,
    target.nonce,
  );
  // The sweep is a wallet-built batch, but it must still satisfy every rule a
  // site's batch is held to before approval.
  if (strk20BatchRefusal(actions) !== null) {
    throw new WalletError(SHADOW_SWEEP_BREAKS_BATCH_RULE);
  }
  const plan = await quoteStrk20Actions(service, { ...context.accountContext, actions });
  const unsigned: Omit<Strk20ShadowSweepPreparation, "context" | "id"> = {
    actions,
    anonymizer: listed.anonymizer,
    kind: "shadow-sweep",
    label: target.label,
    nonce: target.nonce,
    origin: target.origin,
    plan,
    poolAddress: config.poolAddress,
    recipient: owner,
    summaries: [
      SHADOW_SWEEP_SUMMARY(displayNonce(target.nonce), activityOrigin(target.origin)),
      SHADOW_INVOKE_ANONYMIZER(listed.anonymizer),
      SHADOW_INVOKE_SETTLES(held.map((token) => token.symbol).join(", ")),
      summarizeStrk20Plan(plan, strk20FeeAssetFor(context.accountContext.account.networkId, plan)),
    ],
    token: first,
  };
  const approvalContext = await createApprovalContext(
    context.accountContext.account,
    strk20WalletPreparationPayload(unsigned),
  );
  return {
    ok: true,
    strk20Preparation: deps.strk20Preparations.put({
      ...unsigned,
      context: approvalContext,
      id: approvalContext.payloadDigest,
    }),
  };
};

/**
 * Submits a reviewed sweep: re-checks registration and that the network still
 * routes shadow invokes through the reviewed anonymizer, binds the site's label
 * to the recorded origin, and relays the exact reviewed batch.
 */
export const submitShadowSweep = async (
  service: ReturnType<typeof strk20ServiceForRuntime>,
  preparation: Strk20ShadowSweepPreparation,
  context: ActivePrivacyContext,
): Promise<Strk20SubmissionResult> => {
  context.accountContext.onPhase?.({ phase: "checking registration" });
  const registration = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    token: context.token.address,
  });
  if (registration !== "registered") {
    throw new WalletError("Private registration is no longer active");
  }
  if (
    !sameFelt(context.accountContext.config?.shadowAccountAnonymizerAddress, preparation.anonymizer)
  ) {
    throw new WalletError("Privacy preparation changed");
  }
  return submitStrk20Actions(service, {
    ...context.accountContext,
    actions: await bindStrk20ActionsToOrigin(preparation.origin, preparation.actions),
    plan: preparation.plan,
  });
};
