/**
 * In-wallet swap operations over the AVNU aggregator, dispatched from the
 * background message handler. Both messages are privileged (extension pages
 * only, deny-by-default in ./senders.ts) and follow the wallet's execution
 * contract: token addresses come from the user's TRACKED registry (never from
 * the UI message), AVNU responses are validated at the @mc-wallet/transactions/avnu.ts
 * boundary, built calls pass a policy check here (an approve may only touch
 * the sell token) plus the shared call verifier, and signing happens only
 * through the session-gated Krusty signer. Failure behaviour: any validation,
 * quote, build, or policy failure returns an error response — nothing is
 * signed on a path that could not be fully checked.
 */

import { STARKNET_NETWORKS, sameFelt } from "@mc-wallet/wallet-model/networks";
import type { SwapService } from "@mc-wallet/transactions/avnu";
import { formatTokenAmount, parseTokenAmount } from "@mc-wallet/starknet/rpc";
import { verifyCalls } from "@mc-wallet/transactions/verify";
import type { TokenConfig } from "@mc-wallet/settings/preferences";
import { approvalPayloadMatchesContext, createApprovalContext } from "../approvals/approval-context";
import { readTypeOnlyInput } from "../routing/message-inputs";
import { activeAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { readSwapExecuteInput, readSwapPrepareInput, readSwapQuoteInput } from "./swap-inputs";
import { type SwapPreparationStore, swapPreparationPayload } from "./swap-preparations";
import { signerForContext, verificationContext, type WalletOpsDeps } from "../accounts/wallet-ops";

/**
 * Dependencies for the swap handler: the shared wallet-ops set plus the AVNU
 * swap service (injected fetch; unavailable default fails closed).
 */
export type SwapOpsDeps = WalletOpsDeps & {
  readonly swap: SwapService;
  readonly swapPreparations: SwapPreparationStore;
};

// Entrypoints that grant spend on a token. A built swap may only carry them
// against the sell token — any other target is rejected before verification.
const APPROVE_ENTRYPOINTS = new Set(["approve", "increaseAllowance", "increase_allowance"]);

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.length > 0 ? error.message : fallback;

const swapPair = async (
  deps: SwapOpsDeps,
  input: { readonly buyTokenId: string; readonly sellTokenId: string },
) => {
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error } as const;
  }
  const preferences = await deps.preferencesStore.read();
  const tokenById = (id: string): TokenConfig | undefined =>
    preferences.tokens.find((token) => token.id === id && token.networkId === context.networkId);
  const sellToken = tokenById(input.sellTokenId);
  const buyToken = tokenById(input.buyTokenId);
  if (!sellToken || !buyToken) {
    return { error: "token unavailable on this network" } as const;
  }
  if (sameFelt(sellToken.address, buyToken.address)) {
    return { error: "pick two different tokens" } as const;
  }
  return { ...context, buyToken, preferences, sellToken } as const;
};

const sellAmountHex = (amount: string, decimals: number): string | null => {
  try {
    const wei = parseTokenAmount(amount, decimals);
    return wei > 0n ? `0x${wei.toString(16)}` : null;
  } catch {
    return null;
  }
};

const swapTokensResponse = async (deps: SwapOpsDeps): Promise<RuntimeResponse> => {
  const preferences = await deps.preferencesStore.read();
  try {
    return { ok: true, swapTokens: await deps.swap.listTokens(preferences.activeNetworkId) };
  } catch (error) {
    return { error: errorText(error, "token list unavailable") };
  }
};

const swapQuoteResponse = async (
  deps: SwapOpsDeps,
  input: NonNullable<ReturnType<typeof readSwapQuoteInput>>,
): Promise<RuntimeResponse> => {
  const context = await swapPair(deps, input);
  if ("error" in context) {
    return { error: context.error };
  }
  const { account, buyToken, networkId, sellToken } = context;
  const sellAmount = sellAmountHex(input.amount, sellToken.decimals);
  if (!sellAmount) {
    return { error: "enter an amount to swap" };
  }
  try {
    const quote = await deps.swap.getQuote({
      buyTokenAddress: buyToken.address,
      networkId,
      sellAmount,
      sellTokenAddress: sellToken.address,
      takerAddress: account.address,
    });
    return {
      ok: true,
      swapQuote: {
        buyAmount: formatTokenAmount(BigInt(quote.buyAmount), buyToken.decimals),
        buyAmountInUsd: quote.buyAmountInUsd,
        gasFeesInUsd: quote.gasFeesInUsd,
        quoteId: quote.quoteId,
        sellAmount: input.amount,
        sellAmountInUsd: quote.sellAmountInUsd,
      },
    };
  } catch (error) {
    return { error: errorText(error, "swap quote failed") };
  }
};

// The build-output policy gate: bounded call count and approvals only ever on
// the sell token. Returns the rejection, or null when the build is acceptable.
const approvalCallPolicyError = (
  call: {
    readonly calldata: readonly string[];
    readonly contractAddress: string;
    readonly entrypoint: string;
  },
  sellAmount: string,
  sellTokenAddress: string,
): string | null => {
  if (!APPROVE_ENTRYPOINTS.has(call.entrypoint)) {
    return null;
  }
  if (!sameFelt(call.contractAddress, sellTokenAddress)) {
    return "swap build touched an unexpected token approval";
  }
  const allowance = BigInt(call.calldata[1] ?? "0") + (BigInt(call.calldata[2] ?? "0") << 128n);
  if (
    call.calldata.length !== 3 ||
    BigInt(call.calldata[0] ?? "0") === 0n ||
    allowance !== BigInt(sellAmount)
  ) {
    return "swap build requested an unexpected token allowance";
  }
  return null;
};

const buildPolicyError = (
  built: readonly {
    readonly calldata: readonly string[];
    readonly contractAddress: string;
    readonly entrypoint: string;
  }[],
  sellAmount: string,
  sellTokenAddress: string,
): string | null => {
  if (built.length > 4) {
    return "swap build returned too many calls";
  }
  let approvals = 0;
  for (const call of built) {
    if (APPROVE_ENTRYPOINTS.has(call.entrypoint)) {
      approvals += 1;
    }
    const error = approvalCallPolicyError(call, sellAmount, sellTokenAddress);
    if (error) {
      return error;
    }
  }
  return approvals > 1 ? "swap build returned multiple token approvals" : null;
};

const swapPrepareResponse = async (
  deps: SwapOpsDeps,
  input: NonNullable<ReturnType<typeof readSwapPrepareInput>>,
): Promise<RuntimeResponse> => {
  const context = await swapPair(deps, input);
  if ("error" in context) {
    return { error: context.error };
  }
  const { account, buyToken, networkId, preferences, sellToken } = context;
  const sellAmount = sellAmountHex(input.amount, sellToken.decimals);
  if (!sellAmount) {
    return { error: "enter an amount to swap" };
  }
  try {
    const built = await deps.swap.buildCalls({
      networkId,
      quoteId: input.quoteId,
      slippage: input.slippage,
      takerAddress: account.address,
    });
    const policyError = buildPolicyError(built.calls, sellAmount, sellToken.address);
    if (policyError) {
      return { error: policyError };
    }
    const calls = built.calls.map((call) => ({
      calldata: [...call.calldata],
      contractAddress: call.contractAddress,
      entrypoint: call.entrypoint,
    }));
    const report = verifyCalls(calls, verificationContext(account, preferences));
    const unsigned = {
      amount: input.amount,
      buyAmount: input.buyAmount,
      buySymbol: buyToken.symbol,
      calls,
      flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
      sellSymbol: sellToken.symbol,
      summaries: report.calls.map((call) => call.summary),
    };
    const approvalContext = await createApprovalContext(account, swapPreparationPayload(unsigned));
    const swapPreparation = deps.swapPreparations.put({
      ...unsigned,
      context: approvalContext,
      id: approvalContext.payloadDigest,
    });
    return { ok: true, swapPreparation };
  } catch (error) {
    return { error: errorText(error, "swap preparation failed") };
  }
};

const swapExecuteResponse = async (
  deps: SwapOpsDeps,
  input: NonNullable<ReturnType<typeof readSwapExecuteInput>>,
): Promise<RuntimeResponse> => {
  const preparation = deps.swapPreparations.claim(input.preparationId);
  if (!preparation) {
    return { error: "swap preparation not found" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await deps.preferencesStore.read();
  if (
    context.account.id !== preparation.context.accountId ||
    context.networkId !== preparation.context.networkId ||
    preferences.activeNetworkId !== preparation.context.networkId ||
    STARKNET_NETWORKS[context.networkId].chainId !== preparation.context.chainId ||
    !(await approvalPayloadMatchesContext(preparation.context, swapPreparationPayload(preparation)))
  ) {
    return { error: "swap preparation changed" };
  }
  try {
    verifyCalls(preparation.calls, verificationContext(context.account, preferences));
    const result = await deps.runtimeRpc.submitInvokeTransaction({
      account: context.account,
      calls: preparation.calls,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
      signHash: signerForContext(deps, context, "swap-tokens"),
    });
    await deps.activity.record({
      accountId: context.account.id,
      amount: preparation.amount,
      hash: result.transactionHash,
      kind: "invoke",
      networkId: context.networkId,
      summary: `Swap ${preparation.amount} ${preparation.sellSymbol} for ~${preparation.buyAmount} ${preparation.buySymbol} via AVNU`,
      token: preparation.sellSymbol,
    });
    return { ok: true, transactionHash: result.transactionHash };
  } catch (error) {
    return { error: errorText(error, "swap failed") };
  }
};

/**
 * Handles swap messages; returns null for other message types.
 */
export const handleSwapOps = async (
  deps: SwapOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.swapTokens") {
    return readTypeOnlyInput(message, "wallet.swapTokens")
      ? swapTokensResponse(deps)
      : { error: "invalid swap tokens request" };
  }
  if (messageType === "wallet.swapQuote") {
    const input = readSwapQuoteInput(message);
    return input ? swapQuoteResponse(deps, input) : { error: "invalid swap quote request" };
  }
  if (messageType === "wallet.swapExecute") {
    const input = readSwapExecuteInput(message);
    return input ? swapExecuteResponse(deps, input) : { error: "invalid swap request" };
  }
  if (messageType === "wallet.swapPrepare") {
    const input = readSwapPrepareInput(message);
    return input ? swapPrepareResponse(deps, input) : { error: "invalid swap preparation request" };
  }
  return null;
};
