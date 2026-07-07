/**
 * Pure ERC721 helpers: build the transfer call used to send a watched NFT. The
 * on-chain owner read lives in ./rpc because it needs network access.
 */
import { type Call, CallData, cairo } from "starknet";
import { WalletError } from "../shared/errors";
import { isNonZeroStarkFieldElement } from "./networks";

/**
 * Builds an ERC721 `transfer_from(from, to, token_id)` call without signing or
 * broadcasting it. Uses the snake_case entrypoint of the OpenZeppelin ERC721
 * preset; `safe_transfer_from` and camelCase variants are a documented
 * follow-up. `token_id` is encoded as a u256, so id 0 is allowed.
 */
export const buildErc721TransferCall = (
  contract: string,
  from: string,
  to: string,
  tokenIdRaw: bigint,
): Call => {
  if (
    !isNonZeroStarkFieldElement(contract) ||
    !isNonZeroStarkFieldElement(from) ||
    !isNonZeroStarkFieldElement(to)
  ) {
    throw new WalletError("Invalid NFT transfer address");
  }
  return {
    calldata: CallData.compile([from, to, cairo.uint256(tokenIdRaw)]),
    contractAddress: contract,
    entrypoint: "transfer_from",
  };
};
