/**
 * Read-side checks for ownership changes on contracts Create deploys. Signing
 * stays in the connected wallet; this module only reads the class and owner
 * at an address on a network Create is turned on for, and confirms the owner
 * after a change settles.
 */
import { sameFelt } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { createBoundedProvider, withRpcFallback } from "../protocols/support/provider";
import { createNetworkFor, createNetworkNames, type CreateRuntimeDeps } from "./create-runtime";
import { type ContractOwnership, standardForClass } from "./token-ownership";

// Starknet JSON-RPC `CONTRACT_NOT_FOUND`.
const CONTRACT_NOT_FOUND = 20;
// SNIP-6 account interface id, as SRC5 `supports_interface` takes it.
const SRC6_INTERFACE_ID = "0x2ceccef7f994940b3962a6c67e0ba4fcd37df7d131417c604f91e03caecc1cd";

const networkOrThrow = (chainId: string | null) => {
  const network = createNetworkFor(chainId);
  if (network === null) throw new Error(`Ownership changes work on ${createNetworkNames()} only.`);
  return network;
};

const rpcErrorCode = (error: unknown): unknown =>
  (error as { readonly baseError?: { readonly code?: unknown } } | null)?.baseError?.code;

const isContractNotFound = (error: unknown): boolean => rpcErrorCode(error) === CONTRACT_NOT_FOUND;

// A node's answer about the contract (missing entry point, failed call), not
// a transport fault.
const isRpcError = (error: unknown): boolean => typeof rpcErrorCode(error) === "number";

const readOwner = (provider: RpcProvider, contract: string): Promise<string> =>
  provider.callContract({ calldata: [], contractAddress: contract, entrypoint: "owner" }).then((result) => {
    const owner = result[0];
    if (result.length !== 1 || owner === undefined) throw new Error("The contract returned an unexpected owner.");
    return `0x${BigInt(owner).toString(16)}`;
  });

/**
 * Reads a contract's class and owner. Throws a user-facing sentence when the
 * network is off for Create, nothing is deployed there, or the address runs
 * anything but a pinned preset, so the screen never offers an ownership call
 * to a contract it does not know.
 */
export const readContractOwnership = async (
  chainId: string | null,
  contract: string,
  deps: CreateRuntimeDeps = {},
): Promise<ContractOwnership> => {
  const network = networkOrThrow(chainId);
  const makeProvider = deps.makeProvider ?? createBoundedProvider;
  const classHash = await withRpcFallback(
    network.rpcUrls,
    (provider) => provider.getClassHashAt(contract),
    makeProvider,
  ).catch((error: unknown) => {
    throw isContractNotFound(error) ? new Error("No contract is deployed at this address.") : error;
  });
  const standard = standardForClass(classHash);
  if (standard === null) throw new Error("This contract doesn't run an OpenZeppelin preset that Create deploys.");
  const owner = await withRpcFallback(network.rpcUrls, (provider) => readOwner(provider, contract), makeProvider);
  return { contract, owner, standard };
};

/**
 * Refuses a new owner that is not a deployed Starknet account. Ownership given
 * to an empty address (a typo, almost always) or to a contract that can't send
 * transactions, such as another token, can never be used or moved again. An
 * account answers SRC5 `supports_interface` with true for the SRC6 account
 * interface; anything else, including a contract without SRC5, is refused.
 */
export const assertOwnerIsAccount = async (
  chainId: string | null,
  address: string,
  deps: CreateRuntimeDeps = {},
): Promise<void> => {
  const network = networkOrThrow(chainId);
  const answer = await withRpcFallback(
    network.rpcUrls,
    (provider) =>
      provider.callContract({
        calldata: [SRC6_INTERFACE_ID],
        contractAddress: address,
        entrypoint: "supports_interface",
      }),
    deps.makeProvider ?? createBoundedProvider,
  ).catch((error: unknown) => {
    if (isContractNotFound(error)) throw new Error("No account is deployed at the new owner address.");
    if (isRpcError(error)) return [] as string[];
    throw error;
  });
  if (answer.length !== 1 || !sameFelt(answer[0], "0x1")) {
    throw new Error("The new owner address isn't a Starknet account.");
  }
};

/**
 * Waits for an ownership transaction, then re-reads the owner. Throws when the
 * transaction reverted or the owner is not the expected one, so the screen
 * reports a change only once the chain shows it.
 */
export const confirmOwnershipChange = async (
  chainId: string | null,
  transactionHash: string,
  contract: string,
  expectedOwner: string,
  deps: CreateRuntimeDeps = {},
): Promise<void> => {
  const network = networkOrThrow(chainId);
  const makeProvider = deps.makeProvider ?? createBoundedProvider;
  await makeProvider(network.rpcUrls[0]).waitForTransaction(transactionHash, { retryInterval: 2_000 });
  const owner = await withRpcFallback(network.rpcUrls, (provider) => readOwner(provider, contract), makeProvider);
  if (!sameFelt(owner, expectedOwner)) {
    throw new Error("The contract doesn't show the expected owner after this transaction.");
  }
};
