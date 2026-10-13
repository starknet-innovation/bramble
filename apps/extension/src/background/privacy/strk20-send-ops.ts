/**
 * Extension-owned value-moving operations: recipient registration lookup and the
 * three one-time preparations that move balance between a public and a private
 * side — deposit, private transfer, and withdrawal. Relayed routes go through
 * the paymaster only; a deposit is public by construction and pays from the
 * account. The side panel receives review metadata (summaries, relay fee), never
 * the executable batch. These messages are privileged and never enter the dapp
 * bridge.
 *
 * The relay quotes (transfer, withdrawal) answer on the request path; they are
 * a few round trips, not a proof. The deposit builds its proof at review and so
 * runs as a tracked job — see ./strk20-deposit-ops. The job-status poll every
 * tracked route shares is answered here too.
 */

import {
  quoteStrk20Actions,
  readStrk20Balances,
  readStrk20RegistrationStatus,
  summarizeStrk20Plan,
} from "@bramble/privacy/service";
import { parseTokenAmount } from "@bramble/starknet/rpc";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { isStrk20Felt } from "@bramble/wallet-protocol/strk20";
import { createApprovalContext } from "../approvals/approval-context";
import { observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";

import { strk20ServiceForRuntime } from "./strk20-account-context";
import { depositPreparation } from "./strk20-deposit-ops";
import { strk20FeeAssetFor } from "./strk20-fee-reference";
import { errorText, resolvePrivacyContext, type Strk20WalletOpsDeps } from "./strk20-op-context";
import { openPoolRoute } from "./strk20-pool-route";
import { handleStrk20ShadowOps } from "./strk20-shadow-ops";
import {
  readStrk20DepositPreparationInput,
  readStrk20PreparationStatusInput,
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
  // The Send form re-checks the recipient it already holds every time a repaint
  // rebinds it, so ambient price, balance or wallet-event changes re-issue this
  // probe with no user input. It reads only the pool's public registration
  // state, so it observes the unlock window and never extends it — otherwise a
  // panel left on Send would keep the wallet unlocked forever.
  const context = await resolvePrivacyContext(deps, {
    active: await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore),
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
  const opened = await openPoolRoute(deps, input);
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
        summarizeStrk20Plan(
          plan,
          strk20FeeAssetFor(context.accountContext.account.networkId, plan),
        ),
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
  const opened = await openPoolRoute(deps, input);
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
        summarizeStrk20Plan(
          plan,
          strk20FeeAssetFor(context.accountContext.account.networkId, plan),
        ),
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

type SendOp = (deps: Strk20WalletOpsDeps, message: unknown) => Promise<RuntimeResponse>;

// One row per message: its strict reader, the operation, and the refusal a
// malformed request gets. A Map rather than an object literal, so an untrusted
// type such as "constructor" can never resolve to something inherited.
const SEND_OPS: ReadonlyMap<string, SendOp> = new Map<string, SendOp>([
  [
    "wallet.strk20RecipientStatus",
    async (deps, message) => {
      const input = readStrk20RecipientStatusInput(message);
      return input ? recipientStatus(deps, input) : { error: "Invalid recipient check request" };
    },
  ],
  [
    "wallet.strk20PrepareDeposit",
    async (deps, message) => {
      const input = readStrk20DepositPreparationInput(message);
      return input ? depositPreparation(deps, input) : { error: "Invalid shield request" };
    },
  ],
  [
    "wallet.strk20PreparationStatus",
    async (deps, message) => {
      const input = readStrk20PreparationStatusInput(message);
      return input
        ? deps.strk20Jobs.status(input.jobId)
        : { error: "Invalid preparation status request" };
    },
  ],
  [
    "wallet.strk20PrepareTransfer",
    async (deps, message) => {
      const input = readStrk20TransferPreparationInput(message);
      return input ? transferPreparation(deps, input) : { error: "Invalid private send request" };
    },
  ],
  [
    "wallet.strk20PrepareWithdraw",
    async (deps, message) => {
      const input = readStrk20WithdrawPreparationInput(message);
      return input ? withdrawPreparation(deps, input) : { error: "Invalid unshield request" };
    },
  ],
]);

/**
 * Handles privileged private-send messages and returns null for other types.
 */
export const handleStrk20SendOps = async (
  deps: Strk20WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const op = SEND_OPS.get(messageType);
  return op ? op(deps, message) : handleStrk20ShadowOps(deps, messageType, message);
};
