/**
 * Read-side Starknet operations for NFT Studio. Signing stays in the connected
 * wallet; this module only fetches the bundled class and reads transaction or
 * ownership state from the wallet's active network.
 */
import { cairo, CallData, RpcProvider } from "starknet";
import {
  STARKNET_NETWORKS,
  type StarknetNetwork,
} from "../protocols/support/networks";
import {
  PUNK_CLASS_HASH,
  PUNK_CONTRACT_ARTIFACT,
  readPunkContractClass,
} from "./punk-contract";

const networkForChainId = (chainId: string | null): StarknetNetwork => {
  const normalized = chainId?.toUpperCase() ?? "";
  const network = Object.values(STARKNET_NETWORKS).find(
    (candidate) =>
      candidate.id === normalized ||
      candidate.chainId.toLowerCase() === (chainId?.toLowerCase() ?? ""),
  );
  if (network === undefined || network.id === "SN_DEVNET") {
    throw new Error("NFT Studio currently supports Starknet Mainnet and Sepolia.");
  }
  return network;
};

const providerForChain = (chainId: string | null): RpcProvider =>
  new RpcProvider({ nodeUrl: networkForChainId(chainId).rpcUrls[0] });

const isClassMissing = (cause: unknown): boolean => {
  if (cause instanceof Error && /class hash not found/i.test(cause.message)) {
    return true;
  }
  const baseError = (cause as { readonly baseError?: unknown } | null)?.baseError;
  return (
    typeof baseError === "object" &&
    baseError !== null &&
    "code" in baseError &&
    (baseError as { readonly code?: unknown }).code === 28
  );
};

/** Fetches and hash-checks the Sierra class bundled in Vite public assets. */
export const loadPunkContractClass = async (): Promise<
  ReturnType<typeof readPunkContractClass>
> => {
  const response = await fetch(PUNK_CONTRACT_ARTIFACT, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Could not load the Punk contract artifact (${response.status}).`);
  }
  return readPunkContractClass(await response.json());
};

/** Returns true only when the pinned class is already declared on this chain. */
export const isPunkClassDeclared = async (chainId: string | null): Promise<boolean> => {
  try {
    await providerForChain(chainId).getClassByHash(PUNK_CLASS_HASH);
    return true;
  } catch (cause) {
    if (isClassMissing(cause)) {
      return false;
    }
    throw cause;
  }
};

/** Waits for a submitted declaration, deployment, mint, or transfer to settle. */
export const waitForPunkTransaction = async (
  chainId: string | null,
  transactionHash: string,
): Promise<void> => {
  await providerForChain(chainId).waitForTransaction(transactionHash, {
    retryInterval: 2_000,
  });
};

/** Reads the current ERC721 owner, rejecting missing or malformed results. */
export const readPunkOwner = async (
  chainId: string | null,
  contractAddress: string,
  id: number,
): Promise<string> => {
  const response = await providerForChain(chainId).callContract({
    calldata: CallData.compile([cairo.uint256(id)]),
    contractAddress,
    entrypoint: "owner_of",
  });
  const owner = response[0];
  if (typeof owner !== "string") {
    throw new Error(`Punk #${id} is not minted by this collection.`);
  }
  return owner;
};

/** Human-readable network copy used by the studio and transaction links. */
export const punkNetworkName = (chainId: string | null): string =>
  networkForChainId(chainId).name;

/** Starkscan transaction link for the wallet's active network. */
export const punkTransactionUrl = (chainId: string | null, hash: string): string =>
  `https://${networkForChainId(chainId).id === "SN_SEPOLIA" ? "sepolia." : ""}starkscan.co/tx/${hash}`;

/** Starkscan contract link for the wallet's active network. */
export const punkContractUrl = (chainId: string | null, address: string): string =>
  `https://${networkForChainId(chainId).id === "SN_SEPOLIA" ? "sepolia." : ""}starkscan.co/contract/${address}`;
