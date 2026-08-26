/**
 * Starknet provider plumbing shared by wallet RPC operations: the Krusty
 * signer adapter, endpoint failover, and RPC error classification.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { parseRetryAfterMilliseconds } from "@mc-wallet/core/http-json";
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
  type AggregateHashSigner,
  type ArgentMultisigAccountDescriptor,
  argentQueryAccount,
  krustyAccount,
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
const MAX_RPC_ENDPOINT_COOLDOWN_MS = 5 * 60_000;
const endpointCooldowns = new Map<string, number>();

const clearObservedCooldown = (nodeUrl: string, observed: number | undefined): void => {
  if (endpointCooldowns.get(nodeUrl) === observed) endpointCooldowns.delete(nodeUrl);
};

const availableRpcUrls = (rpcUrls: readonly string[], currentTime: number): readonly string[] => {
  for (const [nodeUrl, retryAt] of endpointCooldowns) {
    if (retryAt <= currentTime) endpointCooldowns.delete(nodeUrl);
  }
  return [...new Set(rpcUrls)].filter((nodeUrl) => !endpointCooldowns.has(nodeUrl));
};

const coolDownRpcUrl = (
  nodeUrl: string,
  now: () => number,
  wallClock: () => number,
  error: unknown,
): void => {
  const currentTime = now();
  const refused = error instanceof RpcRefusedError;
  const requestedDelay = refused
    ? parseRetryAfterMilliseconds(error.retryAfter, wallClock())
    : null;
  const stored = endpointCooldowns.get(nodeUrl);
  const existing = stored && stored > currentTime ? stored : undefined;
  const retryAt =
    currentTime +
    Math.min(requestedDelay ?? RPC_ENDPOINT_COOLDOWN_MS, MAX_RPC_ENDPOINT_COOLDOWN_MS);
  endpointCooldowns.set(nodeUrl, Math.max(existing ?? 0, retryAt));
};

/**
 * Clears process-local endpoint health between isolated tests. Production code
 * must retain cooldowns so independent resource lanes do not hammer one failed
 * endpoint.
 */
export const resetRpcEndpointCooldownsForTests = (): void => endpointCooldowns.clear();

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
    // Keep the typed refusal until `withRpcWrite` records its cooldown, then
    // `writeFailure` turns it into the same determinate display error. It must
    // never become post-submission ambiguity: that would permanently burn a
    // counterfactual deploy address with no hash that could resolve the claim.
    if (error instanceof RpcRefusedError) {
      throw error;
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
  now: () => number = () => performance.now(),
  wallClock: () => number = Date.now,
): Promise<T> => {
  const available = availableRpcUrls(rpcUrls, now());
  let lastError: unknown =
    rpcUrls.length === 0
      ? new WalletError("No RPC endpoints configured")
      : new RpcTransportError("RPC endpoints are temporarily unavailable");
  for (const nodeUrl of available) {
    const observedCooldown = endpointCooldowns.get(nodeUrl);
    try {
      const result = await run(makeProvider(nodeUrl));
      clearObservedCooldown(nodeUrl, observedCooldown);
      return result;
    } catch (error) {
      if (!isTransportRpcError(error)) {
        clearObservedCooldown(nodeUrl, observedCooldown);
        throw error;
      }
      coolDownRpcUrl(nodeUrl, now, wallClock, error);
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

const selectWriteProvider = async (
  rpcUrls: readonly string[],
  expectedChainId: string,
  makeProvider: (nodeUrl: string) => RpcProvider,
  now: () => number,
  wallClock: () => number,
): Promise<{ readonly provider: RpcProvider; readonly url: string }> => {
  const available = availableRpcUrls(rpcUrls, now());
  let lastError: unknown =
    rpcUrls.length === 0
      ? new WalletError("No RPC endpoints configured")
      : new RpcTransportError("RPC endpoints are temporarily unavailable");
  let chainMismatch: WalletError | null = null;
  for (const nodeUrl of available) {
    const observedCooldown = endpointCooldowns.get(nodeUrl);
    try {
      const provider = makeProvider(nodeUrl);
      const chainId = await provider.getChainId();
      clearObservedCooldown(nodeUrl, observedCooldown);
      if (sameFelt(chainId, expectedChainId)) return { provider, url: nodeUrl };
      chainMismatch = new WalletError(WRONG_CHAIN_MESSAGE);
    } catch (error) {
      if (isTransportRpcError(error)) coolDownRpcUrl(nodeUrl, now, wallClock, error);
      else clearObservedCooldown(nodeUrl, observedCooldown);
      lastError = error;
    }
  }
  throw chainMismatch ?? lastError;
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
  now: () => number = () => performance.now(),
  wallClock: () => number = Date.now,
): Promise<T> => {
  const selected = await selectWriteProvider(
    rpcUrls,
    expectedChainId,
    makeProvider,
    now,
    wallClock,
  );
  try {
    return await run(guardRpcBroadcasts(selected.provider));
  } catch (error) {
    if (error instanceof IndeterminateRpcWriteError || isTransportRpcError(error)) {
      coolDownRpcUrl(selected.url, now, wallClock, error);
    }
    throw writeFailure(error);
  }
};
