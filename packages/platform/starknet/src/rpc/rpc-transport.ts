/** Bounded Starknet JSON-RPC HTTP transport and local reliability instrumentation. */

import { WalletError } from "@bramble/core/errors";
import { readBoundedText } from "@bramble/core/http-json";
import { isRecord } from "@bramble/core/json";
import type { RpcProviderOptions } from "starknet";
import { type RpcOutcome, recordRpcDiagnostic, rpcEndpointClass } from "./rpc-diagnostics";

/**
 * Marker for an endpoint transport failure. The curated message retains no
 * endpoint body or request material.
 */
export class RpcTransportError extends WalletError {
  public constructor(message: string) {
    super(message);
    this.name = "RpcTransportError";
  }
}

/**
 * Marker for a rate limit or gateway refusal produced before a node could have
 * accepted the request. Reads may fail over; broadcasts may be retried by the user.
 */
export class RpcRefusedError extends RpcTransportError {
  public constructor(
    message: string,
    public readonly retryAfter: string | null = null,
  ) {
    super(message);
    this.name = "RpcRefusedError";
  }
}

/** Wall-clock budget for one Starknet JSON-RPC request. */
export const RPC_REQUEST_TIMEOUT_MS = 15_000;

/** Maximum accepted JSON-RPC response body, including large Sierra classes. */
export const RPC_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

/** Curated retry guidance for an endpoint refusal known not to be submitted. */
export const RPC_REFUSED_MESSAGE =
  "The RPC endpoint refused this request (rate limit or gateway rejection). Nothing was submitted - wait a moment and try again.";

/**
 * The three JSON-RPC methods that put a transaction on the wire. A failure on
 * one of them may have happened after a node accepted the transaction, so the
 * transport and the write guard in `./provider` both key off this one list.
 */
export const BROADCAST_RPC_METHODS: ReadonlySet<string> = new Set([
  "starknet_addDeclareTransaction",
  "starknet_addDeployAccountTransaction",
  "starknet_addInvokeTransaction",
]);

const REFUSAL_BODY_LIMIT_BYTES = 1024;
const RPC_RATE_LIMIT_CODE = -32_005;

// Reads the JSON-RPC method from the request body starknet.js sends. Anything
// unreadable is not a known broadcast and keeps the read classification.
const isBroadcastRequest = (init: RequestInit | undefined): boolean => {
  const body = init?.body;
  if (typeof body !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      isRecord(parsed) &&
      typeof parsed["method"] === "string" &&
      BROADCAST_RPC_METHODS.has(parsed["method"])
    );
  } catch {
    return false;
  }
};

// A read may treat any small gateway-shaped `error` string as a refusal and
// fail over. A broadcast may not: a proxy 502/504 with `{"error": "..."}` can
// follow a node that already accepted the transaction, and calling that
// "nothing was submitted" invites a resend under a new nonce. For a broadcast,
// only the node's own rate-limit code (or HTTP 429, handled before the body is
// read) proves the request was turned away; everything else stays ambiguous.
const endpointRefusal = (text: string, broadcast: boolean): boolean => {
  if (text.length > REFUSAL_BODY_LIMIT_BYTES) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return false;
    const error = parsed["error"];
    if (isRecord(error) && error["code"] === RPC_RATE_LIMIT_CODE) return true;
    return !broadcast && typeof error === "string";
  } catch {
    return false;
  }
};

const boundedRpcResponse = async (
  response: Response,
  deadline: AbortSignal,
  broadcast: boolean,
): Promise<Response> => {
  if (response.status === 429) {
    void response.body?.cancel().catch(() => undefined);
    throw new RpcRefusedError(RPC_REFUSED_MESSAGE, response.headers.get("retry-after"));
  }
  if (!response.body) return response;
  const text = await readBoundedText(response, RPC_BODY_LIMIT_BYTES, deadline).catch(
    (error: unknown): never => {
      throw error instanceof WalletError ? new RpcTransportError(error.message) : error;
    },
  );
  if (endpointRefusal(text, broadcast)) {
    throw new RpcRefusedError(RPC_REFUSED_MESSAGE, response.headers.get("retry-after"));
  }
  return new Response(text, {
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    status: response.status,
    statusText: response.statusText,
  });
};

const diagnosticOutcome = (error: unknown, deadline: AbortSignal): RpcOutcome =>
  error instanceof RpcRefusedError
    ? "rate-limited"
    : deadline.aborted || (error instanceof DOMException && error.name === "TimeoutError")
      ? "timeout"
      : "transport-error";

/**
 * Wraps fetch with a per-request deadline, response-size bound, endpoint-refusal
 * classification, and opt-in identifier-free reliability counters.
 */
export const timedRpcFetch =
  (
    timeoutMs: number = RPC_REQUEST_TIMEOUT_MS,
    baseFetch: NonNullable<RpcProviderOptions["baseFetch"]> = (input, init) => fetch(input, init),
    now: () => number = () => performance.now(),
  ): NonNullable<RpcProviderOptions["baseFetch"]> =>
  async (input, init) => {
    const startedAt = now();
    const endpoint = rpcEndpointClass(input);
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    try {
      const response = await boundedRpcResponse(
        await baseFetch(input, { ...init, signal }),
        deadline,
        isBroadcastRequest(init),
      );
      recordRpcDiagnostic(endpoint, "ok", now() - startedAt);
      return response;
    } catch (error) {
      recordRpcDiagnostic(endpoint, diagnosticOutcome(error, deadline), now() - startedAt);
      throw error;
    }
  };
