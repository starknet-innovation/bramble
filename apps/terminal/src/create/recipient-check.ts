/**
 * Pre-flight read for an ERC-1155 create. The pinned OpenZeppelin Cairo v3.0.0
 * `ERC1155Upgradeable` preset mints its initial supply in the constructor with
 * `batch_mint_with_acceptance_check`, so the deploy reverts (and the fee is
 * still paid) unless the recipient accepts ERC-1155. This module asks the
 * recipient the same SRC5 questions the preset's `_check_on_ERC1155_received`
 * and `_check_on_ERC1155_batch_received` ask, before the wallet sees the call.
 */
import { sameFelt } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { createBoundedProvider, withRpcFallback } from "../protocols/support/provider";
import { createNetworkFor, createNetworkNames, type CreateRuntimeDeps } from "./create-runtime";

// Starknet JSON-RPC `CONTRACT_NOT_FOUND`.
const CONTRACT_NOT_FOUND = 20;
// `ENTRYPOINT_NOT_FOUND` and `CONTRACT_ERROR`: the node's answer that the call
// itself failed, as the preset's own call would on chain.
const CALL_FAILED = new Set([21, 40]);
// `IERC1155_RECEIVER_ID` in openzeppelin_interfaces v3.0.0 (token/erc1155.cairo).
const ERC1155_RECEIVER_INTERFACE_ID = "0x15e8665b5af20040c3af1670509df02eb916375cdf7d8cbaf7bd553a257515e";
// `ISRC6_ID` in openzeppelin_interfaces v3.0.0 (account/accounts.cairo).
const SRC6_INTERFACE_ID = "0x2ceccef7f994940b3962a6c67e0ba4fcd37df7d131417c604f91e03caecc1cd";

const NOT_DEPLOYED = "No contract is deployed at the recipient address.";
const CANNOT_RECEIVE = "The recipient can't receive ERC-1155 tokens.";
const UNREADABLE = "Couldn't check the recipient. Try again.";

const rpcErrorCode = (error: unknown): unknown =>
  (error as { readonly baseError?: { readonly code?: unknown } } | null)?.baseError?.code;

/**
 * One SRC5 answer: a well-formed true or false, or "failed" when the call
 * reverted or did not return one boolean (on chain, either aborts the mint).
 */
type Answer = "yes" | "no" | "failed";

const supportsInterface = async (
  rpcUrls: readonly string[],
  recipient: string,
  interfaceId: string,
  makeProvider: (nodeUrl: string) => RpcProvider,
): Promise<Answer> => {
  const result = await withRpcFallback(
    rpcUrls,
    (provider) =>
      provider.callContract({ calldata: [interfaceId], contractAddress: recipient, entrypoint: "supports_interface" }),
    makeProvider,
  ).catch((error: unknown): null => {
    const code = rpcErrorCode(error);
    if (code === CONTRACT_NOT_FOUND) throw new Error(NOT_DEPLOYED);
    if (typeof code === "number" && CALL_FAILED.has(code)) return null;
    // A transport fault or any other node error is never a verdict.
    throw new Error(UNREADABLE);
  });
  if (result === null || result.length !== 1) return "failed";
  if (sameFelt(result[0], "0x1")) return "yes";
  return sameFelt(result[0], "0x0") ? "no" : "failed";
};

/**
 * Refuses an ERC-1155 create whose recipient the preset's mint would reject.
 * The recipient passes when it reports the ERC-1155 receiver interface (the
 * preset then calls its receiver hook, which this read can't run) or, after a
 * clean false there, the SRC6 account interface. An empty address, a
 * contract without SRC5, a failed or malformed answer, or any other contract is
 * refused. It fails closed: if the network can't be read, it throws and the
 * create never reaches the wallet.
 */
export const assertErc1155Recipient = async (
  chainId: string | null,
  recipient: string,
  deps: CreateRuntimeDeps = {},
): Promise<void> => {
  const network = createNetworkFor(chainId);
  if (network === null) throw new Error(`Create works on ${createNetworkNames()} only.`);
  const makeProvider = deps.makeProvider ?? createBoundedProvider;
  // The preset asks SRC6 only after a clean false from the receiver question.
  const receiver = await supportsInterface(network.rpcUrls, recipient, ERC1155_RECEIVER_INTERFACE_ID, makeProvider);
  if (receiver === "yes") return;
  if (receiver === "failed") throw new Error(CANNOT_RECEIVE);
  const account = await supportsInterface(network.rpcUrls, recipient, SRC6_INTERFACE_ID, makeProvider);
  if (account !== "yes") throw new Error(CANNOT_RECEIVE);
};
