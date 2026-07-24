/**
 * Starknet RPC provider plumbing used by the on-chain protocol quote reads:
 * endpoint failover and RPC error classification.
 *
 * Adapted for the standalone terminal web app: the extension's in-wallet Krusty
 * signer adapter (krustyAccount / KrustyStarknetSigner) is intentionally NOT
 * ported here — the terminal never signs locally. It builds `Call[]` and hands
 * them to the connected MC Wallet provider (`requestTransaction({ calls, ... })`), so the
 * only provider plumbing the protocol layer needs is read-side RPC failover.
 */
import { RpcProvider } from "starknet";
import { WalletError } from "./errors";
import { isRecord } from "./json";

/**
 * Checks whether an RPC failure means the queried contract is not deployed.
 */
export const isContractNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (/contract not found/i.test(error.message)) {
    return true;
  }
  const baseError = (error as { readonly baseError?: unknown }).baseError;
  return isRecord(baseError) && baseError.code === 20;
};

/**
 * Checks whether an RPC failure is transport-level (node unreachable or
 * malfunctioning) rather than a semantic contract or execution error.
 */
export const isTransportRpcError = (error: unknown): boolean => {
  if (error instanceof WalletError) {
    return false;
  }
  const baseError = (error as { readonly baseError?: unknown } | null | undefined)?.baseError;
  return !(isRecord(baseError) && typeof baseError.code === "number");
};

/**
 * Runs an operation against each configured RPC endpoint until one succeeds.
 * Only transport-level failures fail over; semantic RPC errors propagate so
 * contract state is never misread as node downtime.
 */
export const withRpcFallback = async <T>(
  rpcUrls: readonly string[],
  run: (provider: RpcProvider) => Promise<T>,
  makeProvider: (nodeUrl: string) => RpcProvider = (nodeUrl) => new RpcProvider({ nodeUrl }),
): Promise<T> => {
  let lastError: unknown = new WalletError("No RPC endpoints configured");
  for (const nodeUrl of rpcUrls) {
    try {
      return await run(makeProvider(nodeUrl));
    } catch (error) {
      if (!isTransportRpcError(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
};
