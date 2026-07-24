/**
 * Starknet RPC helpers for ERC20 allowance approvals and ERC721 ownership.
 * Split from ./rpc.ts to keep each module within the size budget.
 */
import { byteArray, type Call, CallData, type Calldata, cairo, type RpcProvider } from "starknet";
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

/**
 * Inputs for reading an ERC721 token metadata URI.
 */
export type NftTokenUriInput = NftOwnerInput;

/**
 * NFT transfer/ownership standard identified by its on-chain read surface.
 */
export type NftStandard = "ERC721" | "ERC1155";

/**
 * Inputs for proving an account's ERC721 or ERC1155 holding.
 */
export type NftOwnershipInput = NftOwnerInput & {
  readonly accountAddress: string;
};

/**
 * A normalized NFT holding. ERC721 balances are zero or one; ERC1155 balances
 * preserve the full on-chain quantity.
 */
export type NftOwnership = {
  readonly balance: string;
  readonly standard: NftStandard;
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

const UINT128_LIMIT = 1n << 128n;

const decodeUint256 = (response: readonly string[]): bigint | null => {
  try {
    const low = BigInt(response[0] ?? "");
    const high = BigInt(response[1] ?? "");
    return response.length === 2 &&
      low >= 0n &&
      low < UINT128_LIMIT &&
      high >= 0n &&
      high < UINT128_LIMIT
      ? low + (high << 128n)
      : null;
  } catch {
    return null;
  }
};

const tryBalanceEntrypoint = async (
  provider: RpcProvider,
  entrypoint: string,
  contractAddress: string,
  calldata: Calldata,
): Promise<bigint | null> => {
  try {
    return decodeUint256(
      await provider.callContract({ calldata, contractAddress, entrypoint }, "latest"),
    );
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw error;
    }
    return null;
  }
};

const readNftOwnership = async (
  provider: RpcProvider,
  contractAddress: string,
  accountAddress: string,
  tokenCalldata: Calldata,
  balanceCalldata: Calldata,
): Promise<NftOwnership | null> => {
  for (const entrypoint of ["owner_of", "ownerOf"]) {
    const owner = await tryOwnerEntrypoint(provider, entrypoint, contractAddress, tokenCalldata);
    if (owner !== null) {
      return {
        balance: BigInt(owner) === BigInt(accountAddress) ? "1" : "0",
        standard: "ERC721",
      };
    }
  }
  for (const entrypoint of ["balance_of", "balanceOf"]) {
    const balance = await tryBalanceEntrypoint(
      provider,
      entrypoint,
      contractAddress,
      balanceCalldata,
    );
    if (balance !== null) {
      return { balance: balance.toString(), standard: "ERC1155" };
    }
  }
  return null;
};

/**
 * Proves an account's holding across ERC721 and ERC1155 contracts.
 *
 * ERC721 is detected through `owner_of`/`ownerOf`; when neither exists, the
 * reader tries ERC1155 `balance_of`/`balanceOf`. All returned felts and uint256
 * limbs are shape-checked, and transport failures retain RPC failover.
 */
export const getNftOwnership = async ({
  accountAddress,
  contractAddress,
  rpcUrls,
  tokenId,
}: NftOwnershipInput): Promise<NftOwnership> => {
  if (!isNonZeroStarkFieldElement(contractAddress) || !isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid NFT ownership address");
  }
  const tokenCalldata = CallData.compile([cairo.uint256(BigInt(tokenId))]);
  const balanceCalldata = CallData.compile([accountAddress, cairo.uint256(BigInt(tokenId))]);
  return withRpcFallback(rpcUrls, async (provider) => {
    const ownership = await readNftOwnership(
      provider,
      contractAddress,
      accountAddress,
      tokenCalldata,
      balanceCalldata,
    );
    if (ownership === null) {
      throw new WalletError("Could not read NFT ownership");
    }
    return ownership;
  });
};

const MAX_NFT_URI_BYTES = 32_768;

// Decodes one Cairo ByteArray response without trusting its declared lengths.
// A malformed or over-large response returns null so the casing fallback can
// continue; transport faults still propagate to the RPC failover layer.
const decodeByteArray = (response: readonly string[]): string | null => {
  try {
    const wordCount = Number(BigInt(response[0] ?? ""));
    if (
      !Number.isSafeInteger(wordCount) ||
      wordCount < 0 ||
      wordCount > Math.ceil(MAX_NFT_URI_BYTES / 31) ||
      response.length !== wordCount + 3
    ) {
      return null;
    }
    const pendingLength = Number(BigInt(response[wordCount + 2] ?? ""));
    if (!Number.isSafeInteger(pendingLength) || pendingLength < 0 || pendingLength > 30) {
      return null;
    }
    const uri = byteArray.stringFromByteArray({
      data: response.slice(1, wordCount + 1),
      pending_word: response[wordCount + 1] ?? "0x0",
      pending_word_len: pendingLength,
    });
    return new TextEncoder().encode(uri).length <= MAX_NFT_URI_BYTES ? uri : null;
  } catch {
    return null;
  }
};

const tryTokenUriEntrypoint = async (
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
    return decodeByteArray(response);
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw error;
    }
    return null;
  }
};

/**
 * Reads an ERC721 metadata URI through both Starknet naming conventions.
 *
 * The returned Cairo ByteArray is length-bounded and shape-checked before it
 * crosses the RPC boundary. Missing, malformed, or unsupported metadata fails
 * closed with a stable error; no network content is fetched here.
 */
export const getNftTokenUri = async ({
  contractAddress,
  rpcUrls,
  tokenId,
}: NftTokenUriInput): Promise<string> => {
  if (!isNonZeroStarkFieldElement(contractAddress)) {
    throw new WalletError("Invalid NFT contract address");
  }
  const calldata = CallData.compile([cairo.uint256(BigInt(tokenId))]);
  return withRpcFallback(rpcUrls, async (provider) => {
    for (const entrypoint of ["token_uri", "tokenURI", "uri"]) {
      const uri = await tryTokenUriEntrypoint(provider, entrypoint, contractAddress, calldata);
      if (uri !== null && uri.length > 0) {
        return entrypoint === "uri"
          ? uri.replaceAll("{id}", BigInt(tokenId).toString(16).padStart(64, "0"))
          : uri;
      }
    }
    throw new WalletError("Could not read NFT metadata URI");
  });
};
