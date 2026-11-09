/**
 * Pure ERC721/ERC1155 helpers that build watched-NFT transfer calls. On-chain
 * ownership reads live in ./rpc because they need network access.
 */

import { WalletError } from "@bramble/core/errors";
import { isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import { type Call, CallData, cairo } from "starknet";

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

/**
 * Builds an ERC1155 `safe_transfer_from(from, to, token_id, amount, data)` call
 * without signing or broadcasting it. The wallet sends one edition at a time
 * and supplies an empty data span.
 */
export const buildErc1155TransferCall = (
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
    calldata: CallData.compile([from, to, cairo.uint256(tokenIdRaw), cairo.uint256(1n), []]),
    contractAddress: contract,
    entrypoint: "safe_transfer_from",
  };
};
