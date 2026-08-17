/**
 * Starknet provider plumbing shared by wallet RPC operations: the Krusty
 * signer adapter, endpoint failover, and RPC error classification.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { readBoundedText } from "@mc-wallet/core/http-json";
import { isRecord } from "@mc-wallet/core/json";
import {
  isNonZeroStarkFieldElement,
  STARKNET_RPC_SPEC_VERSION,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { RpcProvider, type RpcProviderOptions } from "starknet";

export {
  type AccountHashSigner,
  type AccountSignerOptions,
  type ArgentMultisigAccountDescriptor,
  argentQueryAccount,
  krustyAccount,
  type StarkHashSigner,
  type StarknetAccountDescriptor,
} from "./account-signer";

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
 * Marker for a JSON-RPC exchange that failed at the transport rather than at
 * the node's application layer: a body past {@link RPC_BODY_LIMIT_BYTES}, a
 * body that stalled past the request's deadline, or one that could not be read
 * at all.
 *
 * It exists because {@link isTransportRpcError} classifies by exclusion — a
 * {@link WalletError} means "the wallet decided this", anything else means "the
 * endpoint failed us" — and the response-budget failures the wallet's own
 * transport raises are `WalletError`s that mean the opposite. Today starknet.js
 * rewraps whatever `baseFetch` throws into a plain `Error` before any wallet
 * code sees it, so those failures happen to classify correctly; that is a
 * property of a dependency, not of this wallet. Marking them explicitly makes
 * read failover and accepted-write ambiguity hold on the wallet's own terms.
 *
 * The message is one of the transport's own curated constants; no endpoint body
 * or request material is retained on the instance.
 */
export class RpcTransportError extends WalletError {
  public constructor(message: string) {
    super(message);
    this.name = "RpcTransportError";
  }
}

/**
 * A refusal the endpoint produced BEFORE the node could have seen the request —
 * a rate limit or gateway rejection answered in place of a JSON-RPC result.
 *
 * It extends {@link RpcTransportError} so a read still fails over to the next
 * configured endpoint, but the broadcast guard treats it as DETERMINATE: the
 * transaction was never submitted, so there is no ambiguity to preserve and a
 * retry is safe. That distinction is load-bearing. Classified as ambiguity, a
 * rate-limited submit leaves a durable operation claim with no transaction hash,
 * and because a deploy's hash is only ever recovered from local evidence, the
 * counterfactual address can never be deployed again.
 */
export class RpcRefusedError extends RpcTransportError {
  public constructor(message: string) {
    super(message);
    this.name = "RpcRefusedError";
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
// because the wallet — never the remote node — chooses the transport.
//
// An oversized or stalled body throws a `WalletError` from the shared bounded
// reader, and a `WalletError` is exactly what `isTransportRpcError` treats as
// "the wallet refused this for a reason of its own". It is re-marked as an
// `RpcTransportError` here, at the one place that knows the failure came from
// the endpoint, so read failover and accepted-write ambiguity do not depend on
// the class starknet.js happens to rewrap a `baseFetch` rejection into. The
// message is carried across unchanged (each is one of the reader's own curated
// constants); anything that is not a `WalletError` is already classified as
// transport and is left exactly as thrown, so no raw transport text is
// promoted into a displayable wallet message.
// Longest body still considered a possible refusal note. A gateway saying "no"
// answers in tens of bytes; bounding the check keeps a multi-megabyte Sierra
// class from being parsed twice on every read.
const REFUSAL_BODY_LIMIT_BYTES = 1024;

// Recognizes an answer the ENDPOINT produced instead of the node: an HTTP 429,
// or a body whose `error` is a bare string. A JSON-RPC error is always an object
// carrying a numeric `code` (that is what `isTransportRpcError` keys on), so a
// string there is a gateway speaking for itself. Observed shape from the
// wallet's own mainnet endpoint under load: HTTP 200 with `{"error":
// "rate_limited"}`, which is why status alone is not enough.
const endpointRefusal = (text: string, status: number): boolean => {
  if (status === 429) {
    return true;
  }
  if (text.length > REFUSAL_BODY_LIMIT_BYTES) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && typeof parsed["error"] === "string";
  } catch {
    return false;
  }
};

const boundedRpcResponse = async (response: Response, deadline: AbortSignal): Promise<Response> => {
  if (!response.body) {
    return response;
  }
  const text = await readBoundedText(response, RPC_BODY_LIMIT_BYTES, deadline).catch(
    (error: unknown): never => {
      throw error instanceof WalletError ? new RpcTransportError(error.message) : error;
    },
  );
  if (endpointRefusal(text, response.status)) {
    throw new RpcRefusedError(RPC_REFUSED_MESSAGE);
  }
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

/**
 * Curated line for an endpoint that turned a request away before the node could
 * have seen it. Determinate on purpose: it invites the retry that
 * {@link INDETERMINATE_RPC_WRITE_MESSAGE} must not.
 */
export const RPC_REFUSED_MESSAGE =
  "The RPC endpoint refused this request (rate limit or gateway rejection). Nothing was submitted - wait a moment and try again.";

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
    throw writeFailure(error);
  }
};
