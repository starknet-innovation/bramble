/**
 * Execution of a reviewed, wallet-owned privacy preparation — the one path
 * every registration, shield, private send, and unshield is submitted through.
 * Split from ./strk20-wallet-ops by behaviour: that module answers state and
 * prepares a registration; this one consumes a preparation exactly once.
 *
 * The request that carries `wallet.strk20Execute` does the synchronous part —
 * validate, claim the one-time preparation, re-resolve the active account (the
 * user's own click, so the unlock window is renewed), re-check that nothing
 * the review committed to has moved, and re-apply the recipient policy — and
 * answers every refusal itself. The submission then runs as a tracked job
 * (./strk20-preparation-jobs): a relayed route proves at confirm, and a
 * public one waits on pool maturity before it signs, both of which can outlive
 * one runtime request. The panel polls for the hash.
 *
 * One-time execution is preserved by construction: the claim removes the
 * preparation before the job exists, so a second execute for the same id is
 * refused on its request whether the first job is running or settled, and a
 * poll after settlement returns the stored hash without touching the service.
 */

import { WalletError } from "@bramble/core/errors";
import type { Strk20PhaseSink } from "@bramble/privacy/phases";
import {
  readStrk20Balances,
  readStrk20RegistrationStatus,
  type Strk20SubmissionResult,
  submitStrk20Actions,
} from "@bramble/privacy/service";
import { SHADOW_SWEEP_ACTIVITY } from "@bramble/privacy/shadow-account-copy";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { activityToken } from "@bramble/transactions/activity";
import { verificationContext } from "@bramble/transactions/verify";
import { sameFelt } from "@bramble/wallet-model/networks";
import { PrivacyBlockerError, privacyShortfall } from "@bramble/wallet-protocol/privacy-blocker";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import { runNestedGatewayAnalyticsService } from "../analytics/gateway-analytics";
import { approvalPayloadMatchesContext } from "../approvals/approval-context";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { activeAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { afterBroadcast, recordSubmittedActivity } from "../transactions/activity-recording";
import { withTrustedRecipients } from "../transactions/trusted-recipients";
import type { Strk20WalletExecuteResponse } from "./runtime-strk20-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";
import { STRK20_REGISTRATION_SUMMARY } from "./strk20-activity";
import {
  type ActivePrivacyContext,
  assertPublicPoolSpendAffordable,
  errorText,
  reportingPrivacyContext,
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";
import { refusePoisonedStrk20Actions } from "./strk20-recipient-policy";
import { submitShadowSweep } from "./strk20-shadow-sweep";
import {
  type Strk20WalletPreparation,
  strk20WalletPreparationPayload,
} from "./strk20-wallet-preparations";

// The registration summary is single-sourced in ./strk20-activity so the
// dapp-initiated registration path and the pending-registration derivation in
// ./strk20-wallet-ops match on one value. Re-exported here for existing callers.
export { STRK20_REGISTRATION_SUMMARY } from "./strk20-activity";

const preparationStillMatches = async (
  preparation: Strk20WalletPreparation,
  context: ActivePrivacyContext,
): Promise<boolean> => {
  const config = context.accountContext.config;
  return (
    context.accountContext.account.id === preparation.context.accountId &&
    context.accountContext.account.networkId === preparation.context.networkId &&
    context.preferences.activeNetworkId === preparation.context.networkId &&
    config !== null &&
    sameFelt(config.poolAddress, preparation.poolAddress) &&
    context.token.id === preparation.token.id &&
    context.token.networkId === preparation.token.networkId &&
    sameFelt(context.token.address, preparation.token.address) &&
    context.token.decimals === preparation.token.decimals &&
    context.token.name === preparation.token.name &&
    context.token.symbol === preparation.token.symbol &&
    (await approvalPayloadMatchesContext(
      preparation.context,
      strk20WalletPreparationPayload(preparation),
    ))
  );
};

const counterpartyOf = (payee: string | undefined): { readonly counterparty?: string } =>
  payee === undefined ? {} : { counterparty: payee };

// The other party a privacy operation pays, or undefined when it stays within
// the account. Recorded as the activity counterparty, so a payee joins the
// paid-recipient trust set like any other wallet-submitted payment.
const otherParty = (
  preparation: Strk20WalletPreparation,
  context: ActivePrivacyContext,
): string | undefined =>
  preparation.kind === "register" ||
  sameFelt(preparation.recipient, context.accountContext.account.address)
    ? undefined
    : preparation.recipient;

// What the activity log records for a settled privacy operation. A shield or
// unshield crediting someone else names them, because "Unshield 5 STRK" in a
// history beside a payment to a friend reads as a move between the owner's own
// balances: the same ambiguity that once hid a misdirected send (Sherlock 201).
const activitySummary = (
  preparation: Strk20WalletPreparation,
  context: ActivePrivacyContext,
): string => {
  if (preparation.kind === "register") {
    return STRK20_REGISTRATION_SUMMARY;
  }
  if (preparation.kind === "shadow-sweep") {
    // Generic on purpose: activity is plain browser storage and CSV export,
    // and the scope's site, label, and nonce stay in the encrypted vault.
    return SHADOW_SWEEP_ACTIVITY;
  }
  const value = `${preparation.amount} ${preparation.token.symbol}`;
  if (preparation.kind === "transfer") {
    return `Send ${value} privately`;
  }
  const verb = preparation.kind === "withdraw" ? "Unshield" : "Shield";
  const payee = otherParty(preparation, context);
  return payee === undefined ? `${verb} ${value}` : `${verb} ${value} to ${payee}`;
};

// A third-party private credit can only be encoded for a recipient whose
// viewing-key registration is still active. The review already checks this,
// but registration is chain state and may change while the user reviews. Keep
// this final check immediately before the proof/sign/broadcast boundary.
const assertRecipientRegistration = async (
  service: ReturnType<typeof strk20ServiceForRuntime>,
  recipient: string,
  context: ActivePrivacyContext,
): Promise<void> => {
  if (sameFelt(recipient, context.accountContext.account.address)) {
    return;
  }
  const registration = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    subject: recipient,
    token: context.token.address,
  });
  if (registration !== "registered") {
    throw new WalletError("The recipient has not activated private balances");
  }
};

const assertCurrentRecipientPolicy = async (
  deps: Strk20WalletOpsDeps,
  preparation: Exclude<Strk20WalletPreparation, { readonly kind: "register" }>,
  context: ActivePrivacyContext,
): Promise<void> => {
  // Fresh preferences (a contact saved since review counts), with the same
  // own-account and paid-recipient trust inputs the context was built with.
  const refusal = refusePoisonedStrk20Actions(
    context.accountContext.account,
    await withTrustedRecipients(
      deps,
      await deps.preferencesStore.read(),
      context.preferences.ownAccounts,
    ),
    preparation.actions,
  );
  if (refusal) {
    throw new WalletError(refusal.error);
  }
};

// Transfers and withdrawals share their submission guard: both spend shielded
// balance through the relay, so both re-check registration and the balance at
// submit time rather than trusting the reviewed preparation.
const submitPreparedPrivateBatch = async (
  deps: Strk20WalletOpsDeps,
  service: ReturnType<typeof strk20ServiceForRuntime>,
  preparation: Extract<Strk20WalletPreparation, { readonly kind: "transfer" | "withdraw" }>,
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
  const [privateBalance] = await readStrk20Balances(service, {
    ...context.accountContext,
    tokens: [context.token.address],
  });
  if (BigInt(privateBalance?.balance ?? "0x0") < BigInt(preparation.amountRaw)) {
    throw new WalletError(privacyShortfall(preparation.token.symbol, "private"));
  }
  return submitStrk20Actions(service, {
    ...context.accountContext,
    actions: preparation.actions,
    beforeProof: () =>
      runNestedGatewayAnalyticsService(service, async (nestedService) => {
        if (preparation.kind === "transfer") {
          await assertRecipientRegistration(nestedService, preparation.recipient, context);
        }
        await assertCurrentRecipientPolicy(deps, preparation, context);
      }),
    plan: preparation.plan,
  });
};

const submitPreparedDeposit = async (
  deps: Strk20WalletOpsDeps,
  service: ReturnType<typeof strk20ServiceForRuntime>,
  preparation: Extract<Strk20WalletPreparation, { readonly kind: "deposit" }>,
  context: ActivePrivacyContext,
): Promise<Strk20SubmissionResult> => {
  if (preparation.plan.mode !== "account") {
    throw new WalletError("Shielding route changed");
  }
  context.accountContext.onPhase?.({ phase: "checking the public balance" });
  await assertPublicPoolSpendAffordable(
    deps,
    context,
    preparation.plan.poolFeeFri,
    preparation.amountRaw,
  );
  context.accountContext.onPhase?.({ phase: "checking registration" });
  const registration = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    token: context.token.address,
  });
  if (registration !== "registered") {
    throw new WalletError("Private registration is no longer active");
  }
  await assertRecipientRegistration(service, preparation.recipient, context);
  await assertCurrentRecipientPolicy(deps, preparation, context);
  const result = await service.submitPrepared({
    ...context.accountContext,
    calls: preparation.calls,
    proof: preparation.proof,
    reviewedFee: preparation.networkFee,
  });
  return { allowanceGrants: preparation.allowanceGrants, ...result };
};

const submitPreparedRegistration = async (
  deps: Strk20WalletOpsDeps,
  service: ReturnType<typeof strk20ServiceForRuntime>,
  preparation: Extract<Strk20WalletPreparation, { readonly kind: "register" }>,
  context: ActivePrivacyContext,
): Promise<Strk20SubmissionResult> => {
  context.accountContext.onPhase?.({ phase: "checking registration" });
  const registration = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    token: context.token.address,
  });
  if (registration === "registered") {
    throw new WalletError("Private balances are already active");
  }
  context.accountContext.onPhase?.({ phase: "checking the public balance" });
  await assertPublicPoolSpendAffordable(deps, context, preparation.poolFeeFri);
  const result = await service.submitPrepared({
    ...context.accountContext,
    calls: preparation.calls,
    proof: preparation.proof,
    reviewedFee: preparation.networkFee,
  });
  return { allowanceGrants: preparation.allowanceGrants, ...result };
};

const submitPreparation = (
  deps: Strk20WalletOpsDeps,
  service: ReturnType<typeof strk20ServiceForRuntime>,
  preparation: Strk20WalletPreparation,
  context: ActivePrivacyContext,
): Promise<Strk20SubmissionResult> => {
  if (preparation.kind === "deposit") {
    return submitPreparedDeposit(deps, service, preparation, context);
  }
  if (preparation.kind === "transfer" || preparation.kind === "withdraw") {
    return submitPreparedPrivateBatch(deps, service, preparation, context);
  }
  if (preparation.kind === "shadow-sweep") {
    return submitShadowSweep(service, preparation, context);
  }
  return submitPreparedRegistration(deps, service, preparation, context);
};

// The detached half of an execution: submit, then file the grants and the
// activity line. Runs once per claim; its response is what every later poll
// returns.
const executionWork = async (
  deps: Strk20WalletOpsDeps,
  preparation: Strk20WalletPreparation,
  resolved: ActivePrivacyContext,
  report: Strk20PhaseSink,
): Promise<RuntimeResponse> => {
  const context = reportingPrivacyContext(resolved, report);
  let result: Strk20SubmissionResult;
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    result = await submitPreparation(deps, service, preparation, context);
  } catch (error) {
    // A lost relay or RPC reply may still land: say so instead of "failed",
    // so the panel does not report it as not sent (audit #173).
    if (error instanceof IndeterminateRpcWriteError) {
      return submissionUnknownResponse(errorText(error, "Private transaction failed"));
    }
    // A curated prerequisite (the pool-fee balance check, a deploy-first
    // refusal) is raised before anything is signed, so its kind travels with
    // it and the panel reads it as not sent rather than as unknown (#679).
    if (error instanceof PrivacyBlockerError) {
      return { error: errorText(error, "Private transaction failed"), privacyBlocker: error.kind };
    }
    return { error: errorText(error, "Private transaction failed") };
  }
  // The hash exists from here on, so the reply carries it whatever the
  // bookkeeping does (errors audit F1).
  await afterBroadcast(async () => {
    // Entering the pool approves it to pull the deposit and its fee from the
    // account's PUBLIC balance, so those grants are tracked exactly like any
    // other approval this wallet submits — see `Strk20SubmissionResult`. Filed
    // BEFORE the activity line so a failing activity write cannot lose the
    // record of a grant that is already on chain.
    await recordApproveAllowances({
      assets: verificationContext(context.accountContext.account, context.preferences),
      calls: result.allowanceGrants ?? [],
      owner: allowanceOwner(context.accountContext.account),
      store: deps.allowanceStore,
      transactionHash: result.transactionHash,
    });
    await recordSubmittedActivity(deps.activity, {
      accountId: context.accountContext.account.id,
      ...(preparation.kind === "register" || preparation.kind === "shadow-sweep"
        ? {}
        : { amount: preparation.amount }),
      ...counterpartyOf(otherParty(preparation, context)),
      hash: result.transactionHash,
      kind: "invoke",
      networkId: context.accountContext.account.networkId,
      summary: activitySummary(preparation, context),
      ...(preparation.kind === "register" || preparation.kind === "shadow-sweep"
        ? {}
        : activityToken(preparation.token)),
    });
  });
  return { ok: true, transactionHash: result.transactionHash };
};

/**
 * Executes a reviewed preparation: refusals on the request, the submission as
 * a tracked job whose poll settles on the broadcast hash.
 */
export const executePreparation = async (
  deps: Strk20WalletOpsDeps,
  preparationId: string,
): Promise<Strk20WalletExecuteResponse | { readonly error: string }> => {
  const preparation = deps.strk20Preparations.claim(preparationId);
  if (!preparation) {
    return { error: "Privacy preparation not found" };
  }
  // User-initiated: the user confirmed a reviewed preparation.
  const context = await resolvePrivacyContext(deps, {
    active: await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    tokenId: preparation.token.id,
  });
  if ("error" in context) {
    return { error: context.error };
  }
  if (!(await preparationStillMatches(preparation, context))) {
    return { error: "Privacy preparation changed" };
  }
  // Re-applied after review, exactly as the dapp-facing invoke re-applies it
  // after consent: the contact this recipient mimics may have been saved while
  // the confirmation was on screen, and this is the last point before the batch
  // is proved and relayed. A registration names no recipient.
  const refusal =
    preparation.kind === "register"
      ? null
      : refusePoisonedStrk20Actions(
          context.accountContext.account,
          context.preferences,
          preparation.actions,
        );
  if (refusal) {
    return refusal;
  }
  return deps.strk20Jobs.start("execute", (report) =>
    executionWork(deps, preparation, context, report),
  );
};
