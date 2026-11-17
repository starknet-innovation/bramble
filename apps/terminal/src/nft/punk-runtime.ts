/**
 * Read-side Starknet operations for NFT Studio. Signing stays in the connected
 * wallet; this module only fetches the bundled class and reads transaction or
 * ownership state from the wallet's active network.
 */
import type { RpcProvider } from "starknet";
import { STARKNET_NETWORKS, type StarknetNetwork } from "../protocols/support/networks";
import { createBoundedProvider } from "../protocols/support/provider";

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
  createBoundedProvider(networkForChainId(chainId).rpcUrls[0]);

/** Waits for a submitted declaration, deployment, mint, or transfer to settle. */
export const waitForPunkTransaction = async (
  chainId: string | null,
  transactionHash: string,
): Promise<void> => {
  await providerForChain(chainId).waitForTransaction(transactionHash, {
    retryInterval: 2_000,
  });
};

/** Human-readable network copy used by the studio and transaction links. */
export const punkNetworkName = (chainId: string | null): string => networkForChainId(chainId).name;

/** Starkscan transaction link for the wallet's active network. */
export const punkTransactionUrl = (chainId: string | null, hash: string): string =>
  `https://${networkForChainId(chainId).id === "SN_SEPOLIA" ? "sepolia." : ""}starkscan.co/tx/${hash}`;

/** Starkscan contract link for the wallet's active network. */
export const punkContractUrl = (chainId: string | null, address: string): string =>
  `https://${networkForChainId(chainId).id === "SN_SEPOLIA" ? "sepolia." : ""}starkscan.co/contract/${address}`;
