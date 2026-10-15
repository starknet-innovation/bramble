/**
 * Starknet RPC provider plumbing used by the on-chain protocol quote reads:
 * endpoint failover and RPC error classification.
 *
 * Adapted for the standalone terminal web app: the extension's in-wallet Krusty
 * signer adapter (krustyAccount / KrustyStarknetSigner) is intentionally NOT
 * ported here — the terminal never signs locally. It builds `Call[]` and hands
 * them to the connected Bramble provider (`requestTransaction({ calls, ... })`), so the
 * only provider plumbing the protocol layer needs is read-side RPC failover.
 */
import { RpcProvider } from "starknet";
import {
  BOUNDED_FETCH_RPC_DEADLINE_MS,
  BOUNDED_FETCH_RPC_MAX_BYTES,
  boundedFetch,
} from "./bounded-network";
import { WalletError } from "./errors";
import { isRecord } from "./json";

/**
 * Bounded `baseFetch` for Starknet RPC providers: every JSON-RPC POST carries an
 * internal deadline and a response-byte cap. A timeout or size rejection has no
 * numeric `baseError.code`, so `withRpcFallback` treats it as a transport
 * failure and fails over; semantic RPC errors still propagate unchanged.
 */
const boundedRpcBaseFetch: typeof fetch = (input, init) =>
  boundedFetch(input, {
    ...init,
    deadlineMs: BOUNDED_FETCH_RPC_DEADLINE_MS,
    maxBytes: BOUNDED_FETCH_RPC_MAX_BYTES,
  });

/** Builds an `RpcProvider` whose reads go through the bounded boundary. */
export const createBoundedProvider = (nodeUrl: string): RpcProvider =>
  new RpcProvider({ baseFetch: boundedRpcBaseFetch, nodeUrl });

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
  makeProvider: (nodeUrl: string) => RpcProvider = createBoundedProvider,
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
