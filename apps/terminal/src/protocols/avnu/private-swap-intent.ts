/** Checks the AVNU SDK's serialized private executor call before wallet handoff. */
import { AVNU_MULTI_ROUTE_SWAP } from "@bramble/wallet-model/avnu-route";
import { isStarkFieldElement, sameFelt, uint256Felts } from "@bramble/wallet-model/networks";
import { hash } from "starknet";
import { PRIVATE_SWAP_SLIPPAGE_BPS } from "../../../shared/privacy";
import { AVNU_ADDRESSES } from "../constants";
import { checkedAvnuExchangeCall } from "./avnu-intent";

/**
 * Accepts exactly approve + multi_route_swap in the pinned SDK Cairo-1 layout.
 * Throws for hidden calls, malformed spans, or a route that contradicts review.
 * The external executor contract remains an explicit trust assumption.
 */
export const checkPrivateSwapCalldata = (
  calldata: readonly string[],
  input: { readonly sellToken: string; readonly sellAmount: string; readonly buyToken: string },
  buyAmount: string,
  executor: string,
): string => {
  const felts = calldata.slice(0, -1);
  const route = felts.slice(11);
  if (
    !felts.every(isStarkFieldElement) ||
    BigInt(felts[1] ?? "0") !== 2n ||
    !sameFelt(felts[2] ?? "", input.sellToken) ||
    !sameFelt(felts[3] ?? "", hash.getSelectorFromName("approve")) ||
    BigInt(felts[4] ?? "0") !== 3n ||
    !sameFelt(felts[5] ?? "", AVNU_ADDRESSES.exchange) ||
    uint256Felts(felts[6], felts[7]) !== BigInt(input.sellAmount) ||
    !sameFelt(felts[8] ?? "", AVNU_ADDRESSES.exchange) ||
    !sameFelt(felts[9] ?? "", hash.getSelectorFromName(AVNU_MULTI_ROUTE_SWAP)) ||
    BigInt(felts[10] ?? "0") !== BigInt(route.length)
  )
    throw new Error("Private swap service returned unexpected executor calls.");
  const minimum = (BigInt(buyAmount) * (10_000n - BigInt(PRIVATE_SWAP_SLIPPAGE_BPS))) / 10_000n;
  return checkedAvnuExchangeCall(
    {
      calldata: route,
      contractAddress: AVNU_ADDRESSES.exchange,
      entrypoint: AVNU_MULTI_ROUTE_SWAP,
    },
    { ...input, buyAmount, minBuyAmount: minimum.toString() },
    executor,
  ).minBuyAmount;
};
