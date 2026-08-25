/**
 * Starknet provider plumbing shared by wallet RPC operations: the Krusty
 * signer adapter, endpoint failover, and RPC error classification.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { isRecord } from "@mc-wallet/core/json";
import {
  isNonZeroStarkFieldElement,
  STARKNET_RPC_SPEC_VERSION,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { RpcProvider, type RpcProviderOptions } from "starknet";
import { RpcRefusedError, RpcTransportError, timedRpcFetch } from "./rpc-transport";

export {
  type AccountHashSigner,
  type AccountSignerOptions,
  type ArgentMultisigAccountDescriptor,
  argentQueryAccount,
  krustyAccount,
  type StarkHashSigner,
  type StarknetAccountDescriptor,
} from "./account-signer";
export {
  isBlockNotFoundError,
  isContractNotFoundError,
  isTransactionNotFoundError,
} from "./rpc-not-found";
export {
  RPC_BODY_LIMIT_BYTES,
  RPC_REFUSED_MESSAGE,
  RPC_REQUEST_TIMEOUT_MS,
  RpcRefusedError,
  RpcTransportError,
  timedRpcFetch,
} from "./rpc-transport";

/**
 * Thrown when no endpoint reports the expected chain. The UI maps this exact
 * string, so read it here rather than copying the wording.
 */
export const WRONG_CHAIN_MESSAGE = "RPC endpoint returned the wrong Starknet chain";

type RpcProviderFactory = (options: RpcProviderOptions) => RpcProvider;

const createStarknetProvider: RpcProviderFactory = (options) => new RpcProvider(options);
const RPC_ENDPOINT_COOLDOWN_MS = 30_000;
const endpointCooldowns = new Map<string, number>();

/**
 * Safe marker for a write whose transport failed after submission began. The
 * message is curated for display; no RPC error, request body, or proof material
 * is retained on the instance.
 */
export class IndeterminateRpcWriteError extends WalletError {
  public constructor(message: string) {
    super(message);
    this.name = "IndeterminateRpcWriteError";
  }
}

/**
 * Curated line shown when a write left the wallet and its outcome could not be
 * established. Exported so every submission lane — the JSON-RPC one below and
 * the STRK20 private relay, which reaches its node through its own HTTP client
 * — mints the same sentence rather than three approximations of it.
 */
export const INDETERMINATE_RPC_WRITE_MESSAGE =
  "Transaction submission status is unknown. Check activity and on-chain state before retrying.";

/**
 * Accepts a required hash from a successful broadcast result. A malformed
 * HTTP-200 result is still ambiguous: the node may have accepted the write, so
 * callers must not report a determinate failure that invites a blind retry.
 */
export const acceptedRpcWriteHash = (value: unknown): string => {
  if (typeof value !== "string" || !isNonZeroStarkFieldElement(value)) {
    throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
  }
  return value;
};

/**
 * Accepts a broadcast hash only when it matches the exact hash handed to the
 * signer. A missing capture or node mismatch is post-broadcast ambiguity, so
 * callers must not invite an automatic retry.
 */
export const matchingAcceptedRpcWriteHash = (value: unknown, signedHash: unknown): string => {
  const accepted = acceptedRpcWriteHash(value);
  if (
    typeof signedHash !== "string" ||
    !isNonZeroStarkFieldElement(signedHash) ||
    !sameFelt(accepted, signedHash)
  ) {
    throw new IndeterminateRpcWriteError(
      "RPC accepted a different transaction hash. Check on-chain state before retrying.",
    );
  }
  return accepted;
};

/**
 * Builds an RPC provider pinned to {@link STARKNET_RPC_SPEC_VERSION}.
 *
 * Every provider in the wallet is created here so the spec version is decided
 * in one place rather than inherited from starknet.js's mutable global default
 * — a dependency bump must not silently move the wire format the wallet signs
 * and broadcasts against. Note what this does and does not buy: pinning fixes
 * how the wallet *encodes* requests, and it makes starknet.js skip its lazy
 * `starknet_specVersion` probe, so a node serving a different spec is not
 * detected here. The pin's counterpart is the `v0_10` segment in the bundled
 * gateway URLs; both must move together. The optional factory is a test seam;
 * it always receives the same pinned configuration as the production constructor.
 *
 * Every provider also gets {@link timedRpcFetch} by default, so no wallet RPC
 * call can park behind starknet.js's unbounded transport. A caller that needs a
 * tighter deadline passes its own `baseFetch` and overrides it.
 */
export const createRpcProvider = (
  nodeUrl: string,
  options: Omit<RpcProviderOptions, "nodeUrl" | "specVersion"> = {},
  makeProvider: RpcProviderFactory = createStarknetProvider,
): RpcProvider =>
  makeProvider({
    baseFetch: timedRpcFetch(),
    ...options,
    nodeUrl,
    specVersion: STARKNET_RPC_SPEC_VERSION,
  });

/**
 * Checks whether an RPC failure is transport-level (node unreachable or
 * malfunctioning) rather than a semantic contract or execution error.
 *
 * {@link RpcTransportError} is the wallet's own positive statement that an
 * endpoint failed, and it is checked first because every other rule here is a
 * negative one: a `WalletError` is otherwise a decision the wallet made about
 * an answer it did read (`Invalid token balance response`, `Invalid transaction
 * hash`, the whole STRK20 validation surface), and failing those over to the
 * next endpoint would turn one node's semantic refusal into a fan-out across
 * every configured endpoint. Anything else is treated as transport unless it
 * carries a numeric JSON-RPC `baseError.code`, which only a node that answered
 * can produce.
 */
export const isTransportRpcError = (error: unknown): boolean => {
  if (error instanceof RpcTransportError) {
    return true;
  }
  if (error instanceof WalletError) {
    return false;
  }
  const baseError = (error as { readonly baseError?: unknown } | null | undefined)?.baseError;
  return !(isRecord(baseError) && typeof baseError["code"] === "number");
};

const BROADCAST_RPC_METHODS = new Set([
  "starknet_addDeclareTransaction",
  "starknet_addDeployAccountTransaction",
  "starknet_addInvokeTransaction",
]);
const PREPARATION_UNAVAILABLE =
  "Transaction could not be prepared. Check your connection or RPC endpoint.";

const runRpcBroadcast = async <T>(broadcast: () => Promise<T>): Promise<T> => {
  try {
    return await broadcast();
  } catch (error) {
    // Checked before the transport rule: a refusal is transport-shaped (so reads
    // still fail over) but is NOT post-submission ambiguity. Reporting it as
    // ambiguous permanently burns a counterfactual deploy address, because the
    // operation claim is kept with no hash that could ever resolve it.
    if (error instanceof RpcRefusedError) {
      throw new WalletError(error.message);
    }
    if (isTransportRpcError(error)) {
      throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
    }
    throw error;
  }
};

const memberFor = (target: object, receiver: object, property: string | symbol): unknown => {
  const value: unknown = Reflect.get(target, property, target);
  if (typeof value !== "function") {
    return value;
  }
  return (...args: readonly unknown[]): unknown => Reflect.apply(value, receiver, args);
};

// RpcChannel's add-transaction methods build and normalize a signed transaction
// before calling fetchEndpoint. Bind channel methods through the proxy so that
// only those exact JSON-RPC fetches receive the ambiguity marker; a local build
// or decompression failure remains safely pre-broadcast.
const guardRpcChannel = (rawChannel: object): object => {
  let guardedChannel: object;
  guardedChannel = new Proxy(rawChannel, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") {
        return value;
      }
      if (property === "fetchEndpoint") {
        return (...args: readonly unknown[]) => {
          const fetch = (): Promise<unknown> => Promise.resolve(Reflect.apply(value, target, args));
          return typeof args[0] === "string" && BROADCAST_RPC_METHODS.has(args[0])
            ? runRpcBroadcast(fetch)
            : fetch();
        };
      }
      return (...args: readonly unknown[]) => Reflect.apply(value, guardedChannel, args);
    },
  });
  return guardedChannel;
};

const guardRpcBroadcasts = (provider: RpcProvider): RpcProvider => {
  const rawChannel: unknown = Reflect.get(provider, "channel", provider);
  const channel =
    typeof rawChannel === "object" && rawChannel !== null ? guardRpcChannel(rawChannel) : null;
  let guardedProvider: RpcProvider;
  guardedProvider = new Proxy(provider, {
    get: (target, property): unknown => {
      if (property === "channel" && channel !== null) {
        return channel;
      }
      return memberFor(target, guardedProvider, property);
    },
  });
  return guardedProvider;
};

/**
 * Runs an operation against each configured RPC endpoint until one succeeds.
 * Only transport-level failures fail over; semantic RPC errors propagate so
 * contract state is never misread as node downtime.
 */
export const withRpcFallback = async <T>(
  rpcUrls: readonly string[],
  run: (provider: RpcProvider) => Promise<T>,
  makeProvider: (nodeUrl: string) => RpcProvider = createRpcProvider,
  now: () => number = Date.now,
): Promise<T> => {
  let lastError: unknown = new WalletError("No RPC endpoints configured");
  const currentTime = now();
  for (const [nodeUrl, retryAt] of endpointCooldowns) {
    if (retryAt <= currentTime) endpointCooldowns.delete(nodeUrl);
  }
  const ready = rpcUrls.filter((nodeUrl) => !endpointCooldowns.has(nodeUrl));
  const candidates =
    ready.length > 0
      ? ready
      : [...rpcUrls]
          .sort(
            (left, right) =>
              (endpointCooldowns.get(left) ?? currentTime) -
              (endpointCooldowns.get(right) ?? currentTime),
          )
          .slice(0, 1);
  for (const nodeUrl of candidates) {
    try {
      const result = await run(makeProvider(nodeUrl));
      endpointCooldowns.delete(nodeUrl);
      return result;
    } catch (error) {
      if (!isTransportRpcError(error)) {
        endpointCooldowns.delete(nodeUrl);
        throw error;
      }
      endpointCooldowns.set(nodeUrl, currentTime + RPC_ENDPOINT_COOLDOWN_MS);
      lastError = error;
    }
  }
  throw lastError;
};

// Maps a failed write to what the caller should see. The order is the whole
// point: post-submission ambiguity is preserved first and never downgraded; a
// determinate endpoint refusal then keeps its own actionable line instead of
// collapsing into the generic preparation failure; only an otherwise-transport
// failure becomes that generic error.
const writeFailure = (error: unknown): unknown => {
  if (error instanceof IndeterminateRpcWriteError) {
    return error;
  }
  if (error instanceof RpcRefusedError) {
    return new WalletError(error.message);
  }
  return isTransportRpcError(error) ? new WalletError(PREPARATION_UNAVAILABLE) : error;
};

/**
 * Selects a chain-matching endpoint with read-only probes, then runs a
 * state-changing operation exactly once. Only the three add-transaction JSON-
 * RPC fetches preserve response-loss ambiguity without retaining the raw error;
 * earlier transport failures become a safe preparation error. Neither case is
 * retried against a fallback endpoint.
 */
export const withRpcWrite = async <T>(
  rpcUrls: readonly string[],
  expectedChainId: string,
  run: (provider: RpcProvider) => Promise<T>,
  makeProvider: (nodeUrl: string) => RpcProvider = createRpcProvider,
): Promise<T> => {
  let selected: RpcProvider | null = null;
  let lastError: unknown = new WalletError("No RPC endpoints configured");
  // Kept out of `lastError` so a later unreachable endpoint cannot bury it: a
  // wrong chain is the only outcome here the user can act on.
  let chainMismatch: WalletError | null = null;
  for (const nodeUrl of rpcUrls) {
    try {
      const provider = makeProvider(nodeUrl);
      const chainId = await provider.getChainId();
      if (!sameFelt(chainId, expectedChainId)) {
        chainMismatch = new WalletError(WRONG_CHAIN_MESSAGE);
        continue;
      }
      selected = provider;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!selected) {
    throw chainMismatch ?? lastError;
  }
  try {
    return await run(guardRpcBroadcasts(selected));
  } catch (error) {
    throw writeFailure(error);
  }
};
