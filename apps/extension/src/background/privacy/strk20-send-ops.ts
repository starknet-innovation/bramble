/**
 * Extension-owned value-moving operations: recipient registration lookup and the
 * three one-time preparations that move balance between a public and a private
 * side — deposit, private transfer, and withdrawal. Relayed routes go through
 * the paymaster only; a deposit is public by construction and pays from the
 * account. The side panel receives review metadata (summaries, relay fee), never
 * the executable batch. These messages are privileged and never enter the dapp
 * bridge.
 */

import { type LedgerStrk20Intents, STRK20_SIGN_INTENTS } from "@mc-wallet/ledger-protocol/intent";
import {
  prepareStrk20AccountActions,
  quoteStrk20Actions,
  readStrk20Balances,
  readStrk20RegistrationStatus,
  summarizeStrk20Plan,
} from "@mc-wallet/privacy/service";
import { parseTokenAmount } from "@mc-wallet/starknet/rpc";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { isStrk20Felt } from "@mc-wallet/wallet-protocol/strk20";
import { createApprovalContext } from "../approvals/approval-context";
import { activeAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";

import { strk20ServiceForRuntime } from "./strk20-account-context";
import {
  type ActivePrivacyContext,
  assertPublicPoolSpendAffordable,
  errorText,
  estimatePublicStrk20Fee,
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";
import { refusePoisonedStrk20Recipients } from "./strk20-recipient-policy";
import {
  readStrk20DepositPreparationInput,
  readStrk20RecipientStatusInput,
  readStrk20TransferPreparationInput,
  readStrk20WithdrawPreparationInput,
} from "./strk20-wallet-inputs";
import { strk20WalletPreparationPayload } from "./strk20-wallet-preparations";

// The shared recipient policy, applied to the three pool routes before anything
// is prepared. It is the same function the dapp-facing prepare and invoke routes
// apply, so the two halves of the privacy product line cannot drift apart.
// Refusing at preparation means a poisoned recipient never reaches a reviewed,
// digested preparation the user could confirm — so a preparation that exists is
// one whose recipient passed.
const refusePoisonedPoolRecipient = (
  context: ActivePrivacyContext,
  recipient: string,
): { readonly error: string } | null =>
  refusePoisonedStrk20Recipients(context.accountContext.account, context.preferences, [
    { recipient, token: context.token.address },
  ]);

/**
 * One entry gate for the three pool routes: parse the destination felt, resolve
 * the active privacy context for the chosen token, then apply the shared
 * recipient policy — in that order, so no route can be prepared for an address
 * the wallet refuses to pay. Returns the resolved context and canonical
 * recipient, or the error response the caller returns unchanged.
 */
// `intents` is a parameter, not a default: the shield lane and the private-transfer
// lane authorize different things on the device screen, and this helper is the one
// place both pass through.
const openPoolRoute = async (
  deps: Strk20WalletOpsDeps,
  intents: LedgerStrk20Intents,
  input: { readonly recipient: string; readonly tokenId: string },
): Promise<
  | { readonly context: ActivePrivacyContext; readonly recipient: string }
  | { readonly error: string }
> => {
  const recipient = canonicalFelt(input.recipient);
  if (recipient === null || !isNonZeroStarkFieldElement(recipient)) {
    return { error: "Enter a valid Starknet address" };
  }
  // User-initiated: the user composed a send and asked for a preparation.
  const context = await resolvePrivacyContext(deps, {
    active: await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    intents,
    tokenId: input.tokenId,
  });
  if ("error" in context) {
    return { error: context.error };
  }
  return refusePoisonedPoolRecipient(context, recipient) ?? { context, recipient };
};

const recipientStatus = async (
  deps: Strk20WalletOpsDeps,
  input: { readonly address: string; readonly tokenId: string },
): Promise<RuntimeResponse> => {
  const recipient = canonicalFelt(input.address);
  if (recipient === null || !isNonZeroStarkFieldElement(recipient)) {
    return { error: "Enter a valid Starknet address" };
  }
  // User-initiated: this probe is debounced behind the recipient the user is
  // typing, so it only ever runs because the user acted.
  const context = await resolvePrivacyContext(deps, {
    active: await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    intents: STRK20_SIGN_INTENTS.transfer,
    tokenId: input.tokenId,
  });
  if ("error" in context) {
    return { error: context.error };
  }
  try {
    const registration = await readStrk20RegistrationStatus(
      strk20ServiceForRuntime(deps.runtimeRpc),
      { ...context.accountContext, subject: recipient, token: context.token.address },
    );
    return { ok: true, strk20RecipientRegistration: registration };
  } catch (error) {
    return { error: errorText(error, "Recipient check unavailable") };
  }
};

const transferPreparation = async (
  deps: Strk20WalletOpsDeps,
  input: { readonly amount: string; readonly recipient: string; readonly tokenId: string },
): Promise<RuntimeResponse> => {
  const opened = await openPoolRoute(deps, STRK20_SIGN_INTENTS.transfer, input);
  if ("error" in opened) {
    return opened;
  }
  const { context, recipient } = opened;
  if (sameFelt(recipient, context.accountContext.account.address)) {
    return { error: "Private sends to the sending account are not supported" };
  }
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    const senderStatus = await readStrk20RegistrationStatus(service, {
      ...context.accountContext,
      token: context.token.address,
    });
    if (senderStatus !== "registered") {
      return { error: "Activate private balances before sending privately" };
    }
    const recipientRegistration = await readStrk20RegistrationStatus(service, {
      ...context.accountContext,
      subject: recipient,
      token: context.token.address,
    });
    if (recipientRegistration !== "registered") {
      return { error: "The recipient has not activated private balances" };
    }
    const amountRaw = parseTokenAmount(input.amount, context.token.decimals);
    if (amountRaw <= 0n) {
      return { error: "Enter an amount to send" };
    }
    if (!isStrk20Felt(`0x${amountRaw.toString(16)}`)) {
      return { error: "Amount is outside the Starknet field range" };
    }
    const [privateBalance] = await readStrk20Balances(service, {
      ...context.accountContext,
      tokens: [context.token.address],
    });
    if (amountRaw > BigInt(privateBalance?.balance ?? "0x0")) {
      return { error: `Not enough private ${context.token.symbol}` };
    }
    const actions = [
      {
        amount: `0x${amountRaw.toString(16)}`,
        recipient,
        token: context.token.address,
        type: "transfer" as const,
      },
    ];
    const plan = await quoteStrk20Actions(service, { ...context.accountContext, actions });
    const config = context.accountContext.config;
    if (!config) {
      return { error: "Private balances are not configured for this network" };
    }
    const unsigned = {
      actions,
      amount: input.amount,
      amountRaw: `0x${amountRaw.toString(16)}`,
      kind: "transfer" as const,
      plan,
      poolAddress: config.poolAddress,
      recipient,
      summaries: [
        `Send ${input.amount} ${context.token.symbol} privately to ${recipient}`,
        summarizeStrk20Plan(plan),
        "The transfer moves shielded balance; the amount and recipient stay off-chain",
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
    return { error: errorText(error, "Private send preparation failed") };
  }
};

const withdrawPreparation = async (
  deps: Strk20WalletOpsDeps,
  input: { readonly amount: string; readonly recipient: string; readonly tokenId: string },
): Promise<RuntimeResponse> => {
  const opened = await openPoolRoute(deps, STRK20_SIGN_INTENTS.transfer, input);
  if ("error" in opened) {
    return opened;
  }
  const { context, recipient } = opened;
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    const registration = await readStrk20RegistrationStatus(service, {
      ...context.accountContext,
      token: context.token.address,
    });
    if (registration !== "registered") {
      return { error: "Activate private balances before unshielding" };
    }
    const amountRaw = parseTokenAmount(input.amount, context.token.decimals);
    if (amountRaw <= 0n) {
      return { error: "Enter an amount to unshield" };
    }
    if (!isStrk20Felt(`0x${amountRaw.toString(16)}`)) {
      return { error: "Amount is outside the Starknet field range" };
    }
    const [privateBalance] = await readStrk20Balances(service, {
      ...context.accountContext,
      tokens: [context.token.address],
    });
    if (amountRaw > BigInt(privateBalance?.balance ?? "0x0")) {
      return { error: `Not enough private ${context.token.symbol}` };
    }
    const actions = [
      {
        amount: `0x${amountRaw.toString(16)}`,
        recipient,
        token: context.token.address,
        type: "withdraw" as const,
      },
    ];
    const plan = await quoteStrk20Actions(service, { ...context.accountContext, actions });
    const config = context.accountContext.config;
    if (!config) {
      return { error: "Private balances are not configured for this network" };
    }
    const own = sameFelt(recipient, context.accountContext.account.address);
    const unsigned = {
      actions,
      amount: input.amount,
      amountRaw: `0x${amountRaw.toString(16)}`,
      kind: "withdraw" as const,
      plan,
      poolAddress: config.poolAddress,
      recipient,
      summaries: [
        `Unshield ${input.amount} ${context.token.symbol} to ${own ? "this account" : recipient}`,
        summarizeStrk20Plan(plan),
        "The withdrawal is public: the amount and destination become visible on-chain",
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
    return { error: errorText(error, "Unshielding preparation failed") };
  }
};

// Both parties a deposit touches must be in the pool: the depositor to own the
// batch, and the credited account because the note lands in a channel derived
// from its registered viewing key. Re-checked here rather than trusted from the
// side panel's gate, because this message is untrusted like any other. A
// self-credit needs only the one check.
const depositRegistrationError = async (
  service: ReturnType<typeof strk20ServiceForRuntime>,
  context: ActivePrivacyContext,
  recipient: string,
): Promise<string | null> => {
  const status = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    token: context.token.address,
  });
  if (status !== "registered") {
    return "Activate private balances before shielding an asset";
  }
  if (sameFelt(recipient, context.accountContext.account.address)) {
    return null;
  }
  const recipientStatus = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    subject: recipient,
    token: context.token.address,
  });
  return recipientStatus === "registered"
    ? null
    : "The recipient has not activated private balances";
};

const depositPreparation = async (
  deps: Strk20WalletOpsDeps,
  input: { readonly amount: string; readonly recipient: string; readonly tokenId: string },
): Promise<RuntimeResponse> => {
  const opened = await openPoolRoute(deps, STRK20_SIGN_INTENTS.shield, input);
  if ("error" in opened) {
    return opened;
  }
  const { context, recipient } = opened;
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    const registrationError = await depositRegistrationError(service, context, recipient);
    if (registrationError !== null) {
      return { error: registrationError };
    }
    const toSelf = sameFelt(recipient, context.accountContext.account.address);
    const amountRaw = parseTokenAmount(input.amount, context.token.decimals);
    if (amountRaw <= 0n) {
      return { error: "Enter an amount to shield" };
    }
    if (!isStrk20Felt(`0x${amountRaw.toString(16)}`)) {
      return { error: "Amount is outside the Starknet field range" };
    }
    const actions = [
      {
        amount: `0x${amountRaw.toString(16)}`,
        // A self-credit is the batch's implicit surplus, so it names no
        // recipient and stays the batch the pool already receives for a shield.
        ...(toSelf ? {} : { recipient }),
        token: context.token.address,
        type: "deposit" as const,
      },
    ];
    const plan = await quoteStrk20Actions(service, { ...context.accountContext, actions });
    if (plan.mode !== "account") {
      return { error: "Shielding route unavailable" };
    }
    await assertPublicPoolSpendAffordable(
      deps,
      context,
      plan.poolFeeFri,
      `0x${amountRaw.toString(16)}`,
    );
    const config = context.accountContext.config;
    if (!config) {
      return { error: "Private balances are not configured for this network" };
    }
    const prepared = await prepareStrk20AccountActions(service, {
      ...context.accountContext,
      actions,
      beforeProof: async () => {
        const currentRegistrationError = await depositRegistrationError(
          service,
          context,
          recipient,
        );
        if (currentRegistrationError !== null) {
          throw new Error(currentRegistrationError);
        }
      },
      poolFeeFri: plan.poolFeeFri,
    });
    const networkFee = await estimatePublicStrk20Fee(deps, context, prepared.calls, prepared.proof);
    const unsigned = {
      ...prepared,
      actions,
      amount: input.amount,
      amountRaw: `0x${amountRaw.toString(16)}`,
      kind: "deposit" as const,
      networkFee,
      plan,
      poolAddress: config.poolAddress,
      recipient,
      summaries: [
        toSelf
          ? `Shield ${input.amount} ${context.token.symbol}`
          : `Shield ${input.amount} ${context.token.symbol} into ${recipient}'s private balance`,
        summarizeStrk20Plan(plan),
        toSelf
          ? "The deposit is public; the resulting balance can be spent privately"
          : "The deposit is public: your address and the amount are on chain, and only the recipient stays hidden",
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
    return { error: errorText(error, "Shielding preparation failed") };
  }
};

/**
 * Handles privileged private-send messages and returns null for other types.
 */
export const handleStrk20SendOps = async (
  deps: Strk20WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.strk20RecipientStatus") {
    const input = readStrk20RecipientStatusInput(message);
    return input ? recipientStatus(deps, input) : { error: "Invalid recipient check request" };
  }
  if (messageType === "wallet.strk20PrepareDeposit") {
    const input = readStrk20DepositPreparationInput(message);
    return input ? depositPreparation(deps, input) : { error: "Invalid shield request" };
  }
  if (messageType === "wallet.strk20PrepareTransfer") {
    const input = readStrk20TransferPreparationInput(message);
    return input ? transferPreparation(deps, input) : { error: "Invalid private send request" };
  }
  if (messageType === "wallet.strk20PrepareWithdraw") {
    const input = readStrk20WithdrawPreparationInput(message);
    return input ? withdrawPreparation(deps, input) : { error: "Invalid unshield request" };
  }
  return null;
};
