/** Pure validation between untrusted AVNU calldata and the public swap review. */
import { avnuRouteIntentError, decodeAvnuRoute } from "@bramble/wallet-model/avnu-route";
import { isNonZeroStarkFieldElement, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { WalletError } from "../support/errors";
import type { SwapQuote } from "../types";
import { type AvnuExchangeCall, parseAmount, parseBuildResponse } from "./avnu-swap";

/**
 * Revalidates a stored call and binds every reviewed field to decoded calldata.
 * Throws on malformed values, mismatched intent, or unrequested fees. Returns
 * a copied call and its enforced minimum; it never signs or contacts a wallet.
 */
export const checkedAvnuExchangeCall = (
  exchangeCall: AvnuExchangeCall,
  quote: Pick<SwapQuote, "sellToken" | "buyToken" | "sellAmount" | "buyAmount" | "minBuyAmount">,
  takerAddress: string,
): { readonly call: AvnuExchangeCall; readonly minBuyAmount: string } => {
  const sellAmount = parseAmount(quote.sellAmount);
  const buyAmount = parseAmount(quote.buyAmount);
  const minBuyAmount = parseAmount(quote.minBuyAmount);
  if (
    !isNonZeroStarkFieldElement(quote.sellToken) ||
    !isNonZeroStarkFieldElement(quote.buyToken) ||
    !isNonZeroStarkFieldElement(takerAddress) ||
    sellAmount === null ||
    sellAmount === "0" ||
    buyAmount === null ||
    buyAmount === "0" ||
    minBuyAmount === null ||
    minBuyAmount === "0" ||
    BigInt(minBuyAmount) > BigInt(buyAmount)
  ) {
    throw new WalletError("Invalid AVNU swap intent");
  }
  const call = parseBuildResponse({
    chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
    calls: [exchangeCall],
  });
  const decoded = decodeAvnuRoute(call.entrypoint, call.calldata);
  if (decoded === null) throw new WalletError("Invalid AVNU route calldata");
  const error = avnuRouteIntentError(decoded, {
    beneficiary: takerAddress,
    buyToken: quote.buyToken,
    minBuyAmount: BigInt(minBuyAmount),
    sellAmount: BigInt(sellAmount),
    sellToken: quote.sellToken,
  });
  if (error !== null) throw new WalletError(error);
  if (decoded.buyAmount !== BigInt(buyAmount) || decoded.minBuyAmount > decoded.buyAmount) {
    throw new WalletError("AVNU build changed the quoted output");
  }
  if (decoded.integratorFeeBps !== 0n) {
    throw new WalletError("AVNU build charged an unrequested fee");
  }
  return { call, minBuyAmount: decoded.minBuyAmount.toString() };
};
