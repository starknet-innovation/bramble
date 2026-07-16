/**
 * In-wallet swap operations over the AVNU aggregator, dispatched from the
 * background message handler. Both messages are privileged (extension pages
 * only, deny-by-default in ./senders.ts) and follow the wallet's execution
 * contract: token addresses come from the user's TRACKED registry (never from
 * the UI message), AVNU responses are validated at the ../starknet/avnu.ts
 * boundary, built calls pass a policy check here (an approve may only touch
 * the sell token) plus the shared call verifier, and signing happens only
 * through the session-gated Krusty signer. Failure behaviour: any validation,
 * quote, build, or policy failure returns an error response — nothing is
 * signed on a path that could not be fully checked.
 */

import type { SwapService } from "../starknet/avnu";
import { STARKNET_NETWORKS, sameFelt } from "../starknet/networks";
import { formatTokenAmount, parseTokenAmount } from "../starknet/rpc";
import { verifyCalls } from "../starknet/verify";
import type { TokenConfig } from "../storage/preferences-store";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { readSwapExecuteInput, readSwapQuoteInput } from "./swap-inputs";
import { signerForContext, verificationContext, type WalletOpsDeps } from "./wallet-ops";

/**
 * Dependencies for the swap handler: the shared wallet-ops set plus the AVNU
 * swap service (injected fetch; unavailable default fails closed).
 */
export type SwapOpsDeps = WalletOpsDeps & { readonly swap: SwapService };

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

/**
 * Handles swap messages; returns null for other message types.
 */
export const handleSwapOps = async (
  deps: SwapOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.swapQuote") {
    const input = readSwapQuoteInput(message);
    if (!input) {
      return { error: "invalid swap quote request" };
    }
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
  }

  if (messageType === "wallet.swapExecute") {
    const input = readSwapExecuteInput(message);
    if (!input) {
      return { error: "invalid swap request" };
    }
    const context = await swapPair(deps, input);
    if ("error" in context) {
      return { error: context.error };
    }
    const { account, buyToken, networkId, preferences, sellToken } = context;
    try {
      const built = await deps.swap.buildCalls({
        networkId,
        quoteId: input.quoteId,
        slippage: input.slippage,
        takerAddress: account.address,
      });
      if (built.length > 4) {
        return { error: "swap build returned too many calls" };
      }
      for (const call of built) {
        if (
          APPROVE_ENTRYPOINTS.has(call.entrypoint) &&
          !sameFelt(call.contractAddress, sellToken.address)
        ) {
          return { error: "swap build touched an unexpected token approval" };
        }
      }
      const calls = built.map((call) => ({
        calldata: [...call.calldata],
        contractAddress: call.contractAddress,
        entrypoint: call.entrypoint,
      }));
      verifyCalls(calls, verificationContext(account, preferences));
      const result = await deps.runtimeRpc.submitInvokeTransaction({
        account,
        calls,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], preferences),
        signHash: signerForContext(deps, context),
      });
      await deps.activity.record({
        accountId: account.id,
        amount: input.amount,
        hash: result.transactionHash,
        kind: "invoke",
        networkId,
        summary: `Swap ${input.amount} ${sellToken.symbol} for ~${input.buyAmount} ${buyToken.symbol} via AVNU`,
        token: sellToken.symbol,
      });
      return { ok: true, transactionHash: result.transactionHash };
    } catch (error) {
      return { error: errorText(error, "swap failed") };
    }
  }

  return null;
};
