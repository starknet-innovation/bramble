/**
 * Read-side checks after a Create deploy. Signing stays in the connected
 * wallet; this module only waits for the transaction and re-reads the class
 * deployed at the predicted address on the wallet's active network.
 */
import type { RpcProvider } from "starknet";
import { TOKEN_CREATE_NETWORKS } from "../protocols/constants";
import { STARKNET_NETWORKS } from "../protocols/support/networks";
import { createBoundedProvider, withRpcFallback } from "../protocols/support/provider";
import { TOKEN_CREATE_CHAIN_IDS } from "./token-presets";

const sameFelt = (left: string, right: string): boolean => {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
};

type CreateNetwork = (typeof STARKNET_NETWORKS)["SN_MAIN"];

/**
 * Returns the network for a chain the pinned presets were verified on and
 * Create is turned on for, or null for any other chain (including a local
 * devnet, or Mainnet while it is off), so Create refuses it.
 */
export const createNetworkFor = (
  chainId: string | null,
  enabled: readonly string[] = TOKEN_CREATE_NETWORKS,
): CreateNetwork | null => {
  const normalized = chainId?.toLowerCase() ?? "";
  const network = Object.values(STARKNET_NETWORKS).find(
    (candidate) => candidate.chainId === normalized || candidate.id.toLowerCase() === normalized,
  );
  return network !== undefined && TOKEN_CREATE_CHAIN_IDS.includes(network.chainId) && enabled.includes(network.id)
    ? network
    : null;
};

/** "Starknet Sepolia", or "Starknet Mainnet or Starknet Sepolia" once both are on. */
export const createNetworkNames = (enabled: readonly string[] = TOKEN_CREATE_NETWORKS): string =>
  Object.values(STARKNET_NETWORKS)
    .filter((network) => TOKEN_CREATE_CHAIN_IDS.includes(network.chainId) && enabled.includes(network.id))
    .map((network) => network.name)
    .join(" or ");

/** Injectable reads, so the runtime is testable without a live node. */
export type CreateRuntimeDeps = {
  readonly makeProvider?: (nodeUrl: string) => RpcProvider;
};

/**
 * Waits for the deploy transaction, then confirms the predicted address runs
 * the pinned class. Throws when the transaction reverted or the address holds
 * anything else, so the screen never reports a create that did not happen.
 */
export const confirmTokenDeployment = async (
  chainId: string | null,
  transactionHash: string,
  address: string,
  classHash: string,
  deps: CreateRuntimeDeps = {},
): Promise<void> => {
  const network = createNetworkFor(chainId);
  if (network === null) throw new Error(`Create works on ${createNetworkNames()} only.`);
  const makeProvider = deps.makeProvider ?? createBoundedProvider;
  await makeProvider(network.rpcUrls[0]).waitForTransaction(transactionHash, { retryInterval: 2_000 });
  const deployed = await withRpcFallback(
    network.rpcUrls,
    (provider) => provider.getClassHashAt(address),
    makeProvider,
  );
  if (!sameFelt(deployed, classHash)) {
    throw new Error("The new contract doesn't run the expected OpenZeppelin class.");
  }
};
