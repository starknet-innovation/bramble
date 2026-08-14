/**
 * Starknet RPC helper for ERC20 allowance approvals.
 * Split from ./rpc.ts to keep each module within the size budget.
 */
import { type Call, CallData, cairo } from "starknet";
import { WalletError } from "./errors";
import { isNonZeroStarkFieldElement } from "./networks";

/**
 * Builds an ERC20 `approve(spender, amount)` call without signing or
 * broadcasting it. A zero amount revokes a previously granted allowance.
 */
export const buildErc20ApproveCall = (
  tokenAddress: string,
  spender: string,
  amountRaw: bigint,
): Call => {
  if (!isNonZeroStarkFieldElement(tokenAddress) || !isNonZeroStarkFieldElement(spender)) {
    throw new WalletError("Invalid approval address");
  }
  return {
    calldata: CallData.compile([spender, cairo.uint256(amountRaw)]),
    contractAddress: tokenAddress,
    entrypoint: "approve",
  };
};
