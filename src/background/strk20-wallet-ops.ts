/**
 * Extension-owned STRK20 registration and private-balance state, plus the shared
 * submission path every wallet-owned privacy preparation is executed through.
 * These messages are privileged by default and never enter the dapp bridge.
 * Review payloads are frozen in a one-time store before any proof or authorization
 * is produced.
 */

import { WalletError } from "../shared/errors";
import { sameFelt } from "../starknet/networks";
import { formatTokenAmount } from "../starknet/rpc";
import {
  readStrk20Balances,
  readStrk20RegistrationStatus,
  registerStrk20Account,
  type Strk20SubmissionResult,
  submitStrk20Actions,
} from "../starknet/strk20/service";
import { systemClock } from "../storage/activity-store";
import { allowanceOwner, recordApproveAllowances } from "./allowance-recording";
import { approvalPayloadMatchesContext, createApprovalContext } from "./approval-context";
import { readTypeOnlyInput } from "./message-inputs";
import { activeAccountContext, observedAccountContext } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";
import {
  type ActivePrivacyContext,
  assertPublicPoolSpendAffordable,
  errorText,
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";
import { refusePoisonedStrk20Actions } from "./strk20-recipient-policy";
import { handleStrk20SendOps } from "./strk20-send-ops";
import { readStrk20WalletExecuteInput } from "./strk20-wallet-inputs";
import {
  type Strk20WalletPreparation,
  strk20WalletPreparationPayload,
} from "./strk20-wallet-preparations";

/**
 * Re-exported deps type so existing wiring keeps one import site.
 */
export type { Strk20WalletOpsDeps } from "./strk20-op-context";

/**
 * Activity summary recorded for a pool registration. Exported because the
 * pending-registration derivation below matches on it: that entry is the only
 * durable local record that a registration was broadcast, so the string is
 * load-bearing in two places and must never be duplicated as a literal.
 */
export const STRK20_REGISTRATION_SUMMARY = "Activate private balances";

/**
 * How long a broadcast registration is trusted over the privacy indexer. The
 * indexer reflects a registration seconds to minutes after Starknet accepts it;
 * past this window a still-invisible registration reads as absent again, so an
 * attempt that truly never landed leaves the user able to retry rather than
 * locked out of the flow forever.
 */
const REGISTRATION_PENDING_WINDOW_MS = 30 * 60_000;

// A registration the privacy indexer cannot see yet. Derived from the activity
// log rather than stored separately: the registration is already recorded there
// with its hash, and background reconciliation already advances that entry, so a
// rejected or reverted attempt drops out of this check on its own.
const hasPendingRegistration = async (
  deps: Strk20WalletOpsDeps,
  context: ActivePrivacyContext,
): Promise<boolean> => {
  const now = (deps.now ?? systemClock)();
  const entries = await deps.activity.list();
  return entries.some(
    (entry) =>
      entry.summary === STRK20_REGISTRATION_SUMMARY &&
      entry.accountId === context.accountContext.account.id &&
      entry.networkId === context.accountContext.account.networkId &&
      entry.status !== "rejected" &&
      entry.status !== "reverted" &&
      now - entry.submittedAt < REGISTRATION_PENDING_WINDOW_MS,
  );
};

const stateResponse = async (deps: Strk20WalletOpsDeps): Promise<RuntimeResponse> => {
  // The privacy screen re-reads this disclosure on every hydration and, while a
  // registration is settling, on a three-second poll. It is pure observation of
  // state the user did not ask for again, so it must not extend the unlock
  // window — otherwise one open panel keeps the wallet unlocked forever.
  const context = await resolvePrivacyContext(deps, {
    active: await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore),
  });
  if ("error" in context) {
    return { error: context.error };
  }
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    const status = await readStrk20RegistrationStatus(service, {
      ...context.accountContext,
      token: context.token.address,
    });
    // An accepted-but-unindexed registration reads as `pending` rather than
    // `unregistered`, so no surface offers to register a second time while the
    // first one is still settling.
    const registration =
      status === "registered"
        ? "registered"
        : (await hasPendingRegistration(deps, context))
          ? "pending"
          : "unregistered";
    const balances =
      registration === "registered"
        ? await readStrk20Balances(strk20ServiceForRuntime(deps.runtimeRpc), {
            ...context.accountContext,
            tokens: context.preferences.tokens
              .filter((token) => token.networkId === context.accountContext.account.networkId)
              .map((token) => token.address),
          })
        : [];
    // The fee is a hard input to every pool route. Returning a successful state
    // without it leaves Send in an endless "Checking" state, so an unavailable
    // reader or a failed read rejects this request and reaches the UI's retry.
    if (!service.poolFee) {
      throw new Error("Private pool fee is unavailable. Retry the balance check.");
    }
    const poolFeeFri = await service.poolFee(context.accountContext);
    return {
      ok: true,
      strk20State: {
        accountId: context.accountContext.account.id,
        balances: balances.map((entry) => {
          const token = context.preferences.tokens.find(
            (candidate) =>
              candidate.networkId === context.accountContext.account.networkId &&
              sameFelt(candidate.address, entry.token),
          );
          return {
            balance: entry.balance,
            formatted: token ? formatTokenAmount(BigInt(entry.balance), token.decimals) : "0",
            symbol: token?.symbol ?? "Token",
            token: entry.token,
            tokenId: token?.id ?? "",
          };
        }),
        networkId: context.accountContext.account.networkId,
        poolFeeFri,
        relayConfigured: context.accountContext.config?.paymaster !== undefined,
        registration,
      },
    };
  } catch (error) {
    return { error: errorText(error, "Private balances unavailable") };
  }
};

const registrationPreparation = async (deps: Strk20WalletOpsDeps): Promise<RuntimeResponse> => {
  // User-initiated: the user pressed "activate private balances".
  const context = await resolvePrivacyContext(deps, {
    active: await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore),
  });
  if ("error" in context) {
    return { error: context.error };
  }
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    const status = await readStrk20RegistrationStatus(service, {
      ...context.accountContext,
      token: context.token.address,
    });
    if (status === "registered") {
      return { error: "Private balances are already active" };
    }
    // The status read above is blind for as long as the indexer lags, which is
    // exactly the window in which a user is most likely to try again. Refuse to
    // prepare a duplicate on the local record instead.
    if (await hasPendingRegistration(deps, context)) {
      return { error: "A registration is already on its way for this account" };
    }
    const config = context.accountContext.config;
    if (!config) {
      return { error: "Private balances are not configured for this network" };
    }
    if (!service.poolFee) {
      return { error: "Private pool fee is unavailable. Retry the registration." };
    }
    const poolFeeFri = await service.poolFee(context.accountContext);
    await assertPublicPoolSpendAffordable(deps, context, poolFeeFri);
    const unsigned = {
      kind: "register" as const,
      poolAddress: config.poolAddress,
      poolFeeFri,
      summaries: [
        "Register this account with the privacy pool",
        "Registration is public and links this wallet address to its viewing key",
        `Approve and pay the reviewed ${poolFeeFri} STRK fri pool fee from this account`,
      ],
      token: context.token,
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
  } catch (error) {
    return { error: errorText(error, "Privacy registration preparation failed") };
  }
};

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

// What the activity log records for a settled privacy operation. A deposit
// crediting someone else names them, because "Shield 5 STRK" in a history beside
// a payment to a friend is the same ambiguity that once hid a misdirected send.
const activitySummary = (
  preparation: Strk20WalletPreparation,
  context: ActivePrivacyContext,
): string => {
  if (preparation.kind === "register") {
    return STRK20_REGISTRATION_SUMMARY;
  }
  const value = `${preparation.amount} ${preparation.token.symbol}`;
  if (preparation.kind === "transfer") {
    return `Send ${value} privately`;
  }
  if (preparation.kind === "withdraw") {
    return `Unshield ${value}`;
  }
  return sameFelt(preparation.recipient, context.accountContext.account.address)
    ? `Shield ${value}`
    : `Shield ${value} to ${preparation.recipient}`;
};

const executePreparation = async (
  deps: Strk20WalletOpsDeps,
  preparationId: string,
): Promise<RuntimeResponse> => {
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
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    const result = await submitPreparation(deps, service, preparation, context);
    // Entering the pool approves it to pull the deposit and its fee from the
    // account's PUBLIC balance, so those grants are tracked exactly like any
    // other approval this wallet submits — see `Strk20SubmissionResult`. Filed
    // BEFORE the activity line so a failing activity write cannot lose the
    // record of a grant that is already on chain.
    await recordApproveAllowances(
      deps.allowanceStore,
      result.allowanceGrants ?? [],
      allowanceOwner(context.accountContext.account),
    );
    await deps.activity.record({
      accountId: context.accountContext.account.id,
      ...(preparation.kind === "register" ? {} : { amount: preparation.amount }),
      hash: result.transactionHash,
      kind: "invoke",
      networkId: context.accountContext.account.networkId,
      summary: activitySummary(preparation, context),
      ...(preparation.kind === "register" ? {} : { token: preparation.token.symbol }),
    });
    return { ok: true, transactionHash: result.transactionHash };
  } catch (error) {
    return { error: errorText(error, "Private transaction failed") };
  }
};

const submitPreparation = async (
  deps: Strk20WalletOpsDeps,
  service: ReturnType<typeof strk20ServiceForRuntime>,
  preparation: Strk20WalletPreparation,
  context: ActivePrivacyContext,
): Promise<Strk20SubmissionResult> => {
  if (preparation.kind === "deposit") {
    return submitPreparedDeposit(deps, service, preparation, context);
  }
  if (preparation.kind === "transfer" || preparation.kind === "withdraw") {
    return submitPreparedPrivateBatch(service, preparation, context);
  }
  const registration = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    token: context.token.address,
  });
  if (registration === "registered") {
    throw new Error("Private balances are already active");
  }
  await assertPublicPoolSpendAffordable(deps, context, preparation.poolFeeFri);
  return registerStrk20Account(service, {
    ...context.accountContext,
    poolFeeFri: preparation.poolFeeFri,
  });
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

// Transfers and withdrawals share their submission guard: both spend shielded
// balance through the relay, so both re-check registration and the balance at
// submit time rather than trusting the reviewed preparation.
const submitPreparedPrivateBatch = async (
  service: ReturnType<typeof strk20ServiceForRuntime>,
  preparation: Extract<Strk20WalletPreparation, { readonly kind: "transfer" | "withdraw" }>,
  context: ActivePrivacyContext,
): Promise<Strk20SubmissionResult> => {
  const registration = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    token: context.token.address,
  });
  if (registration !== "registered") {
    throw new Error("Private registration is no longer active");
  }
  const [privateBalance] = await readStrk20Balances(service, {
    ...context.accountContext,
    tokens: [context.token.address],
  });
  if (BigInt(privateBalance?.balance ?? "0x0") < BigInt(preparation.amountRaw)) {
    throw new Error(`Not enough private ${preparation.token.symbol}`);
  }
  return submitStrk20Actions(service, {
    ...context.accountContext,
    actions: preparation.actions,
    ...(preparation.kind === "transfer"
      ? {
          beforeProof: () => assertRecipientRegistration(service, preparation.recipient, context),
        }
      : {}),
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
    throw new Error("Shielding route changed");
  }
  await assertPublicPoolSpendAffordable(
    deps,
    context,
    preparation.plan.poolFeeFri,
    preparation.amountRaw,
  );
  const registration = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    token: context.token.address,
  });
  if (registration !== "registered") {
    throw new Error("Private registration is no longer active");
  }
  return submitStrk20Actions(service, {
    ...context.accountContext,
    actions: preparation.actions,
    beforeProof: () => assertRecipientRegistration(service, preparation.recipient, context),
    plan: preparation.plan,
  });
};

/**
 * Handles privileged wallet privacy messages and returns null for other types.
 */
export const handleStrk20WalletOps = async (
  deps: Strk20WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.strk20State") {
    return readTypeOnlyInput(message, messageType)
      ? stateResponse(deps)
      : { error: "Invalid private balance request" };
  }
  if (messageType === "wallet.strk20PrepareRegistration") {
    return readTypeOnlyInput(message, messageType)
      ? registrationPreparation(deps)
      : { error: "Invalid privacy registration request" };
  }
  if (messageType === "wallet.strk20Execute") {
    const input = readStrk20WalletExecuteInput(message);
    return input
      ? executePreparation(deps, input.preparationId)
      : { error: "Invalid privacy execution request" };
  }
  return handleStrk20SendOps(deps, messageType, message);
};
