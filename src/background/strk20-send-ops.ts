/**
 * Extension-owned private-send operations: recipient registration lookup and
 * one-time shielded-transfer preparation. Transfers move private balance to
 * the recipient's private balance through the paymaster relay only; the side
 * panel receives review metadata (summaries, relay fee), never the executable
 * batch. These messages are privileged and never enter the dapp bridge.
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
import { errorText, resolvePrivacyContext, type Strk20WalletOpsDeps } from "./strk20-op-context";
import {
  readStrk20RecipientStatusInput,
  readStrk20TransferPreparationInput,
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
  if (messageType === "wallet.strk20PrepareTransfer") {
    const input = readStrk20TransferPreparationInput(message);
    return input ? transferPreparation(deps, input) : { error: "Invalid private send request" };
  }
  return null;
};
