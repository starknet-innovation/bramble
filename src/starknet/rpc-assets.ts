/**
 * Starknet RPC helpers for ERC20 allowance approvals and ERC721 ownership.
 * Split from ./rpc.ts to keep each module within the size budget.
 */
import { type Call, CallData, type Calldata, cairo, type RpcProvider } from "starknet";
import { WalletError } from "../shared/errors";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "./networks";
import { isTransportRpcError, withRpcFallback } from "./provider";

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

/**
 * Inputs for reading the on-chain owner of an ERC721 token.
 */
export type NftOwnerInput = {
  readonly contractAddress: string;
  readonly rpcUrls: readonly string[];
  readonly tokenId: string;
};

// Reads one ERC721 owner entrypoint and returns canonical hex when it answers
// with a field element, or null when the entrypoint reverts semantically (the
// wrong casing for this collection, or a malformed answer) so the caller can try
// the next casing. A transport-level fault is rethrown so withRpcFallback can
// fail over to the next endpoint rather than masking an outage as "unreadable".
const tryOwnerEntrypoint = async (
  provider: RpcProvider,
  entrypoint: string,
  contractAddress: string,
  calldata: Calldata,
): Promise<string | null> => {
  try {
    const response = await provider.callContract(
      { calldata, contractAddress, entrypoint },
      "latest",
    );
    const owner = response[0];
    if (typeof owner === "string" && isStarkFieldElement(owner)) {
      return `0x${BigInt(owner).toString(16)}`;
    }
    return null;
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw error;
    }
    return null;
  }
};

/**
 * Reads the on-chain owner of an ERC721 token as canonical hex, trying the
 * snake_case `owner_of` and camelCase `ownerOf` entrypoints so both the
 * OpenZeppelin preset and legacy collections resolve.
 */
export const getNftOwner = async ({
  contractAddress,
  rpcUrls,
  tokenId,
}: NftOwnerInput): Promise<string> => {
  if (!isNonZeroStarkFieldElement(contractAddress)) {
    throw new WalletError("Invalid NFT contract address");
  }
  const calldata = CallData.compile([cairo.uint256(BigInt(tokenId))]);
  return withRpcFallback(rpcUrls, async (provider) => {
    for (const entrypoint of ["owner_of", "ownerOf"]) {
      const owner = await tryOwnerEntrypoint(provider, entrypoint, contractAddress, calldata);
      if (owner !== null) {
        return owner;
      }
    }
    throw new WalletError("Could not read NFT owner");
  });
};
