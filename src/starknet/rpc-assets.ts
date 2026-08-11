/**
 * Starknet RPC helpers for ERC20 allowance approvals and ERC721 ownership.
 * Split from ./rpc.ts to keep each module within the size budget.
 */
import {
  byteArray,
  type Call,
  CallData,
  type Calldata,
  cairo,
  num,
  type RpcProvider,
} from "starknet";
import { WalletError } from "../shared/errors";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
  uint256Felts,
} from "./networks";
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
    // Two deliberate departures from raw `CallData.compile` output, neither of
    // which changes a hashed or signed value (every hash is computed from the
    // numeric felt, not its spelling):
    //
    // 1. Spread to a plain array. `compile` tags its result with a
    //    non-enumerable `__compiled__` marker, and an approval payload carrying
    //    it fails the review digest ("Invalid approval payload") because the
    //    JSON normalizer rejects non-enumerable own properties.
    // 2. Render each felt as 0x-hex. `compile` emits decimal, and these calls
    //    are embedded verbatim in the paymaster's outside-execution typed data,
    //    where the relay parses every felt as hex — a 77-digit decimal read as
    //    hex is rejected as "hex string too big".
    calldata: [...CallData.compile([spender, cairo.uint256(amountRaw)])].map((felt) =>
      num.toHex(felt),
    ),
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

/**
 * Decodes a canonical two-limb Cairo uint256 response, returning null for a
 * wrong arity or for a limb that is not a felt inside the uint128 range. Arity
 * is the only rule this reader owns: the limb grammar and the join are the
 * shared `uint256Felts`, never a local `<< 128n` or limb bound, so this reader
 * and the calldata/event decoders cannot disagree about limb order, about the
 * range a limb may spend, or about how a missing limb is handled — it is null
 * here, never zero.
 */
export const decodeUint256Response = (response: readonly string[]): bigint | null =>
  response.length === 2 ? uint256Felts(response[0], response[1]) : null;

const tryBalanceEntrypoint = async (
  provider: RpcProvider,
  entrypoint: string,
  contractAddress: string,
  calldata: Calldata,
): Promise<bigint | null> => {
  try {
    return decodeUint256Response(
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
        balance: sameFelt(owner, accountAddress) ? "1" : "0",
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
