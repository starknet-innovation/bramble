/**
 * Extension-owned STRK20 registration, private-balance, and shielding flows.
 * These messages are privileged by default and never enter the dapp bridge.
 * Review payloads are frozen in a one-time store before any proof or authorization
 * is produced.
 */

import { sameFelt } from "../starknet/networks";
import { formatTokenAmount, parseTokenAmount } from "../starknet/rpc";
import { isStrk20Felt } from "../starknet/strk20/schemas";
import {
  quoteStrk20Actions,
  readStrk20Balances,
  readStrk20RegistrationStatus,
  registerStrk20Account,
  submitStrk20Actions,
  summarizeStrk20Plan,
} from "../starknet/strk20/service";
import { approvalPayloadMatchesContext, createApprovalContext } from "./approval-context";
import { readTypeOnlyInput } from "./message-inputs";
import type { RuntimeResponse } from "./runtime-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";
import {
  type ActivePrivacyContext,
  errorText,
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";
import { handleStrk20SendOps } from "./strk20-send-ops";
import {
  readStrk20DepositPreparationInput,
  readStrk20WalletExecuteInput,
} from "./strk20-wallet-inputs";
import {
  type Strk20WalletPreparation,
  strk20WalletPreparationPayload,
} from "./strk20-wallet-preparations";

/**
 * Re-exported deps type so existing wiring keeps one import site.
 */
export type { Strk20WalletOpsDeps } from "./strk20-op-context";

const publicBalance = async (
  deps: Strk20WalletOpsDeps,
  context: ActivePrivacyContext,
): Promise<bigint> => {
  const [balance] = await deps.runtimeRpc.getTokenBalances({
    accountAddress: context.accountContext.account.address,
    rpcUrls: context.accountContext.rpcUrls,
    tokens: [context.token],
  });
  return balance ? BigInt(balance.balance) : 0n;
};

const stateResponse = async (deps: Strk20WalletOpsDeps): Promise<RuntimeResponse> => {
  const context = await resolvePrivacyContext(deps);
  if ("error" in context) {
    return { error: context.error };
  }
  try {
    const registration = await readStrk20RegistrationStatus(
      strk20ServiceForRuntime(deps.runtimeRpc),
      { ...context.accountContext, token: context.token.address },
    );
    const balances =
      registration === "registered"
        ? await readStrk20Balances(strk20ServiceForRuntime(deps.runtimeRpc), {
            ...context.accountContext,
            tokens: context.preferences.tokens
              .filter((token) => token.networkId === context.accountContext.account.networkId)
              .map((token) => token.address),
          })
        : [];
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    // Best effort: the fee is a display aid, so an unreadable fee leaves the
    // field absent rather than failing the whole balance read.
    const poolFeeFri = await service
      .poolFee?.(context.accountContext)
      .catch(() => undefined)
      .then((value) => (typeof value === "string" ? value : undefined));
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
        ...(poolFeeFri === undefined ? {} : { poolFeeFri }),
        registration,
      },
    };
  } catch (error) {
    return { error: errorText(error, "Private balances unavailable") };
  }
};

const registrationPreparation = async (deps: Strk20WalletOpsDeps): Promise<RuntimeResponse> => {
  const context = await resolvePrivacyContext(deps);
  if ("error" in context) {
    return { error: context.error };
  }
  try {
    const status = await readStrk20RegistrationStatus(strk20ServiceForRuntime(deps.runtimeRpc), {
      ...context.accountContext,
      token: context.token.address,
    });
    if (status === "registered") {
      return { error: "Private balances are already active" };
    }
    const config = context.accountContext.config;
    if (!config) {
      return { error: "Private balances are not configured for this network" };
    }
    const unsigned = {
      kind: "register" as const,
      poolAddress: config.poolAddress,
      summaries: [
        "Register this account with the privacy pool",
        "Registration is public and links this wallet address to its viewing key",
        "Approves and pays the pool's STRK action fee from this account",
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

const depositPreparation = async (
  deps: Strk20WalletOpsDeps,
  input: { readonly amount: string; readonly tokenId: string },
): Promise<RuntimeResponse> => {
  const context = await resolvePrivacyContext(deps, input.tokenId);
  if ("error" in context) {
    return { error: context.error };
  }
  try {
    const status = await readStrk20RegistrationStatus(strk20ServiceForRuntime(deps.runtimeRpc), {
      ...context.accountContext,
      token: context.token.address,
    });
    if (status !== "registered") {
      return { error: "Activate private balances before shielding an asset" };
    }
    const amountRaw = parseTokenAmount(input.amount, context.token.decimals);
    if (amountRaw <= 0n) {
      return { error: "Enter an amount to shield" };
    }
    if (!isStrk20Felt(`0x${amountRaw.toString(16)}`)) {
      return { error: "Amount is outside the Starknet field range" };
    }
    if (amountRaw > (await publicBalance(deps, context))) {
      return { error: `Not enough ${context.token.symbol}` };
    }
    const actions = [
      {
        amount: `0x${amountRaw.toString(16)}`,
        token: context.token.address,
        type: "deposit" as const,
      },
    ];
    const plan = await quoteStrk20Actions(strk20ServiceForRuntime(deps.runtimeRpc), {
      ...context.accountContext,
      actions,
    });
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
      summaries: [
        `Shield ${input.amount} ${context.token.symbol}`,
        summarizeStrk20Plan(plan),
        "The deposit is public; the resulting balance can be spent privately",
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

const executePreparation = async (
  deps: Strk20WalletOpsDeps,
  preparationId: string,
): Promise<RuntimeResponse> => {
  const preparation = deps.strk20Preparations.claim(preparationId);
  if (!preparation) {
    return { error: "Privacy preparation not found" };
  }
  const context = await resolvePrivacyContext(deps, preparation.token.id);
  if ("error" in context) {
    return { error: context.error };
  }
  if (!(await preparationStillMatches(preparation, context))) {
    return { error: "Privacy preparation changed" };
  }
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    const result = await submitPreparation(deps, service, preparation, context);
    await deps.activity.record({
      accountId: context.accountContext.account.id,
      ...(preparation.kind === "register" ? {} : { amount: preparation.amount }),
      hash: result.transactionHash,
      kind: "invoke",
      networkId: context.accountContext.account.networkId,
      summary:
        preparation.kind === "register"
          ? "Activate private balances"
          : preparation.kind === "transfer"
            ? `Send ${preparation.amount} ${preparation.token.symbol} privately`
            : preparation.kind === "withdraw"
              ? `Unshield ${preparation.amount} ${preparation.token.symbol}`
              : `Shield ${preparation.amount} ${preparation.token.symbol}`,
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
): Promise<{ readonly transactionHash: string }> => {
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
  return registerStrk20Account(service, context.accountContext);
};

// Transfers and withdrawals share their submission guard: both spend shielded
// balance through the relay, so both re-check registration and the balance at
// submit time rather than trusting the reviewed preparation.
const submitPreparedPrivateBatch = async (
  service: ReturnType<typeof strk20ServiceForRuntime>,
  preparation: Extract<Strk20WalletPreparation, { readonly kind: "transfer" | "withdraw" }>,
  context: ActivePrivacyContext,
): Promise<{ readonly transactionHash: string }> => {
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
    plan: preparation.plan,
  });
};

const submitPreparedDeposit = async (
  deps: Strk20WalletOpsDeps,
  service: ReturnType<typeof strk20ServiceForRuntime>,
  preparation: Extract<Strk20WalletPreparation, { readonly kind: "deposit" }>,
  context: ActivePrivacyContext,
): Promise<{ readonly transactionHash: string }> => {
  if ((await publicBalance(deps, context)) < BigInt(preparation.amountRaw)) {
    throw new Error(`Not enough ${preparation.token.symbol}`);
  }
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
  if (messageType === "wallet.strk20PrepareDeposit") {
    const input = readStrk20DepositPreparationInput(message);
    return input ? depositPreparation(deps, input) : { error: "Invalid shield request" };
  }
  if (messageType === "wallet.strk20Execute") {
    const input = readStrk20WalletExecuteInput(message);
    return input
      ? executePreparation(deps, input.preparationId)
      : { error: "Invalid privacy execution request" };
  }
  return handleStrk20SendOps(deps, messageType, message);
};
