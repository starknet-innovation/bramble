/**
 * Extension-owned value-moving operations: recipient registration lookup and the
 * three one-time preparations that move balance between a public and a private
 * side — deposit, private transfer, and withdrawal. Relayed routes go through
 * the paymaster only; a deposit is public by construction and pays from the
 * account. The side panel receives review metadata (summaries, relay fee), never
 * the executable batch. These messages are privileged and never enter the dapp
 * bridge.
 */

import { canonicalFelt, isNonZeroStarkFieldElement, sameFelt } from "../starknet/networks";
import { parseTokenAmount } from "../starknet/rpc";
import { isStrk20Felt } from "../starknet/strk20/schemas";
import {
  quoteStrk20Actions,
  readStrk20Balances,
  readStrk20RegistrationStatus,
  summarizeStrk20Plan,
} from "../starknet/strk20/service";
import { createApprovalContext } from "./approval-context";
import type { RuntimeResponse } from "./runtime-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";
import {
  type ActivePrivacyContext,
  assertPublicPoolSpendAffordable,
  errorText,
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";
import {
  readStrk20DepositPreparationInput,
  readStrk20RecipientStatusInput,
  readStrk20TransferPreparationInput,
  readStrk20WithdrawPreparationInput,
} from "./strk20-wallet-inputs";
import { strk20WalletPreparationPayload } from "./strk20-wallet-preparations";

const recipientStatus = async (
  deps: Strk20WalletOpsDeps,
  input: { readonly address: string; readonly tokenId: string },
): Promise<RuntimeResponse> => {
  const recipient = canonicalFelt(input.address);
  if (recipient === null || !isNonZeroStarkFieldElement(recipient)) {
    return { error: "Enter a valid Starknet address" };
  }
  const context = await resolvePrivacyContext(deps, input.tokenId);
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
  const recipient = canonicalFelt(input.recipient);
  if (recipient === null || !isNonZeroStarkFieldElement(recipient)) {
    return { error: "Enter a valid Starknet address" };
  }
  const context = await resolvePrivacyContext(deps, input.tokenId);
  if ("error" in context) {
    return { error: context.error };
  }
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
  const recipient = canonicalFelt(input.recipient);
  if (recipient === null || !isNonZeroStarkFieldElement(recipient)) {
    return { error: "Enter a valid Starknet address" };
  }
  const context = await resolvePrivacyContext(deps, input.tokenId);
  if ("error" in context) {
    return { error: context.error };
  }
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
  const recipient = canonicalFelt(input.recipient);
  if (recipient === null || !isNonZeroStarkFieldElement(recipient)) {
    return { error: "Enter a valid Starknet address" };
  }
  const context = await resolvePrivacyContext(deps, input.tokenId);
  if ("error" in context) {
    return { error: context.error };
  }
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
    const unsigned = {
      actions,
      amount: input.amount,
      amountRaw: `0x${amountRaw.toString(16)}`,
      kind: "deposit" as const,
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
