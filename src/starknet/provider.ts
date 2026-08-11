/**
 * Starknet provider plumbing shared by wallet RPC operations: the Krusty
 * signer adapter, endpoint failover, and RPC error classification.
 */
import { Account, RpcProvider, type RpcProviderOptions, type Signature, Signer } from "starknet";
import type { StarkSignature } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { readBoundedText } from "../shared/http-json";
import { isRecord } from "../shared/json";
import type { AccountRef } from "../storage/vault-schema";
import { isStarkFieldElement, STARKNET_RPC_SPEC_VERSION, sameFelt } from "./networks";

type RpcProviderFactory = (options: RpcProviderOptions) => RpcProvider;

const createStarknetProvider: RpcProviderFactory = (options) => new RpcProvider(options);

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
 * Wall-clock budget for a single Starknet JSON-RPC request. Each request gets
 * its own budget, so a multi-request operation is bounded by its step count and
 * never by one endpoint's willingness to keep a socket open.
 */
export const RPC_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Byte budget for one Starknet JSON-RPC response body.
 *
 * The RPC endpoint is the wallet's largest untrusted boundary and a dapp can
 * propose one through `wallet_addStarknetChain`, so a deadline alone is not a
 * bound: at any real link speed starknet.js's `response.json()` will buffer
 * hundreds of megabytes into the service worker before the clock runs out. This
 * is deliberately generous — the biggest legitimate answer is a Sierra class
 * from `starknet_getClass`, a few megabytes — because a body past it is hostile
 * or broken, never merely large. It lives here rather than in
 * `shared/http-json`'s `HTTP_BODY_LIMITS` because those are per-boundary
 * budgets for JSON reads the wallet performs itself; this one bounds a body
 * that starknet.js reads, and the enforcement point is the transport.
 */
export const RPC_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

// Re-presents an RPC response with its body already read under the byte budget
// and the request's own deadline, so starknet.js's `.json()` can only ever see
// bytes the wallet agreed to hold. A transport that exposes no body stream is
// passed through untouched: only in-process test doubles are wired that way,
// because the wallet — never the remote node — chooses the transport. An
// oversized or stalled body throws, which `withRpcFallback` and `withRpcWrite`
// already classify as a transport failure.
const boundedRpcResponse = async (response: Response, deadline: AbortSignal): Promise<Response> => {
  if (!response.body) {
    return response;
  }
  const text = await readBoundedText(response, RPC_BODY_LIMIT_BYTES, deadline);
  return new Response(text, {
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    status: response.status,
    statusText: response.statusText,
  });
};

/**
 * Wraps a fetch transport so every JSON-RPC request it carries aborts after
 * `timeoutMs`.
 *
 * Without this a hung or slow-loris endpoint parks the operation forever:
 * reads never resolve, and a submit path holds its worker state (and any parked
 * signing request) open with it. An abort surfaces as a transport error, which
 * is exactly what {@link withRpcFallback} needs to move to the next configured
 * endpoint and what {@link withRpcWrite} needs to fail a preparation step
 * closed.
 *
 * The deadline is composed with any caller-supplied `signal` rather than
 * deferring to it, so a caller can only ever make a request abort *sooner*:
 * passing a plain `AbortController` signal cannot silently remove the deadline
 * from every RPC request in the wallet. `baseFetch` is the test seam and
 * defaults to the global fetch.
 *
 * Note what this costs on the write path. The deadline also covers
 * `starknet_addInvokeTransaction` and its siblings, so a broadcast the node
 * accepted but answered slowly is aborted here and classified by
 * {@link withRpcWrite} as an {@link IndeterminateRpcWriteError}: the wallet's
 * own timer becomes a source of submission ambiguity that a purely
 * node-governed transport did not have. That is the safe direction — the
 * transaction is never replayed against another endpoint — but it is a real
 * trade, and {@link RPC_REQUEST_TIMEOUT_MS} is the (maintainer-owned) number
 * that decides how often it happens.
 */
export const timedRpcFetch =
  (
    timeoutMs: number = RPC_REQUEST_TIMEOUT_MS,
    baseFetch: NonNullable<RpcProviderOptions["baseFetch"]> = (input, init) => fetch(input, init),
  ): NonNullable<RpcProviderOptions["baseFetch"]> =>
  async (input, init) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    return boundedRpcResponse(await baseFetch(input, { ...init, signal }), deadline);
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
 * Function that signs a Stark transaction hash through the vault service.
 */
export type StarkHashSigner = (messageHash: string) => Promise<StarkSignature>;

class KrustyStarknetSigner extends Signer {
  public constructor(
    private readonly publicKey: string,
    private readonly starkSignHash: StarkHashSigner,
  ) {
    super("0x1");
  }

  public override async getPubKey(): Promise<string> {
    return this.publicKey;
  }

  protected override async signRaw(messageHash: string): Promise<Signature> {
    const hash = messageHash.startsWith("0x")
      ? messageHash
      : `0x${BigInt(messageHash).toString(16)}`;
    if (!isStarkFieldElement(hash)) {
      throw new WalletError("Invalid transaction hash");
    }
    const signed = await this.starkSignHash(hash);
    return [signed.r, signed.s];
  }
}

/**
 * Builds a starknet.js account backed by the Krusty signer.
 */
export const krustyAccount = (
  provider: RpcProvider,
  account: AccountRef,
  signHash: StarkHashSigner,
): Account =>
  new Account({
    address: account.address,
    cairoVersion: "1",
    provider,
    signer: new KrustyStarknetSigner(account.publicKeyX, signHash),
  });

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
  return isRecord(baseError) && baseError["code"] === 20;
};

/**
 * Checks whether an RPC failure means the node has no record of the queried
 * transaction hash (`TXN_HASH_NOT_FOUND`, JSON-RPC error 29).
 *
 * This is a semantic answer, not a transport failure: the node replied and said
 * it does not know the hash. Callers must still treat a single not-found as
 * noise — a hash can legitimately be unknown to one node moments after
 * broadcast, and a pre-confirmed transaction can disappear when its block
 * proposal fails to commit. Use {@link isTransportRpcError} to keep "we could
 * not ask" apart from "the node says it is gone".
 */
export const isTransactionNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (/transaction hash not found/i.test(error.message)) {
    return true;
  }
  const baseError = (error as { readonly baseError?: unknown }).baseError;
  return isRecord(baseError) && baseError["code"] === 29;
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
    if (isTransportRpcError(error)) {
      throw new IndeterminateRpcWriteError(
        "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
      );
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
  for (const nodeUrl of rpcUrls) {
    try {
      const provider = makeProvider(nodeUrl);
      const chainId = await provider.getChainId();
      if (!sameFelt(chainId, expectedChainId)) {
        lastError = new WalletError("RPC endpoint returned the wrong Starknet chain");
        continue;
      }
      selected = provider;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!selected) {
    throw lastError;
  }
  try {
    return await run(guardRpcBroadcasts(selected));
  } catch (error) {
    if (error instanceof IndeterminateRpcWriteError) {
      throw error;
    }
    if (isTransportRpcError(error)) {
      throw new WalletError(PREPARATION_UNAVAILABLE);
    }
    throw error;
  }
};
