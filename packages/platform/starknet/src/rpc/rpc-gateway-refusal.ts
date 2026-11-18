/**
 * The wallet gateway's own refusals of a broadcast, written before it forwards
 * anything to a node.
 *
 * Trust boundary: the response is untrusted. Only an exact `{"error":"<code>"}`
 * body, with a short lowercase code, counts as the gateway speaking; a
 * JSON-RPC envelope, prose, or any extra key does not. On top of that, only the
 * wallet gateway's own endpoint and only the code-and-status pairs it documents
 * as written before forwarding are read as "not sent"; a custom endpoint, a
 * proxy, or an undocumented code stays outcome-unknown, because any of those
 * can answer after a node already holds the transaction. The displayed message
 * is curated per code and never carries the body.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";

/**
 * Screening refusals the gateway writes before forwarding, on both the plain
 * RPC and the gasless routes. The gasless client builds its own code list on
 * this one so both lanes name the gateway's codes the same way.
 */
export const GATEWAY_SCREENING_CODES = [
  "address_not_allowed",
  "invalid_screening_transaction",
  "screening_denied",
  "screening_pending",
  "screening_unavailable",
] as const;

/** The shape of a gateway code: short, lowercase, digits and underscores. */
export const GATEWAY_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

// A gateway code body is well under this; anything longer is not one.
const GATEWAY_BODY_LIMIT_BYTES = 256;

/**
 * The refusals the gateway writes before it asks a node, each with the one
 * status it uses for that code (issue 910). An allowlist, like the gasless
 * lane's pre-forward codes: anything else, including a documented code on an
 * unexpected status, is not proof that nothing was sent.
 */
const PRE_FORWARD_REFUSALS: ReadonlyMap<string, number> = new Map([
  ["transaction_rejected", 400],
  ["invalid_screening_transaction", 400],
  ["address_not_allowed", 403],
  ["screening_denied", 403],
  // Screening holds: the only 503s that stop before the node is asked. Any
  // other 5xx can follow a node that already accepted the transaction.
  ["screening_pending", 503],
  ["screening_unavailable", 503],
]);

/**
 * Reads the gateway's own `{"error":"<code>"}` body. Returns null for anything
 * else, including a code outside `[a-z0-9_]{1,64}` or an object with any other
 * key, so a node or proxy message is never read as a gateway code.
 */
export const gatewayErrorCode = (body: unknown): string | null =>
  isRecord(body) &&
  typeof body["error"] === "string" &&
  GATEWAY_CODE_PATTERN.test(body["error"]) &&
  hasOnlyKnownKeys(body, ["error"])
    ? body["error"]
    : null;

const messageFor = (code: string): string => {
  switch (code) {
    case "transaction_rejected":
      return "The network rejected this transaction. Nothing was submitted — review it again.";
    case "address_not_allowed":
      return "This account can't send through this RPC endpoint. Nothing was submitted.";
    case "screening_denied":
      return "This account can't send through this RPC endpoint for 24 hours. Nothing was submitted.";
    case "screening_pending":
      return "This account's check is still pending. Nothing was submitted — try again shortly.";
    case "screening_unavailable":
      return "This account could not be checked. Nothing was submitted — try again.";
    case "invalid_screening_transaction":
    default:
      return "The RPC endpoint refused this transaction. Nothing was submitted.";
  }
};

/**
 * A broadcast the gateway refused before forwarding it, so no node holds it.
 * It is a determinate failure, not a transport error: the endpoint is healthy,
 * so it is neither failed over nor put on cooldown, and a caller must not
 * record the signed hash as pending. `code` is the gateway's code, kept for
 * callers and tests; only the curated message is shown.
 */
export class RpcGatewayRefusalError extends WalletError {
  public constructor(public readonly code: string) {
    super(messageFor(code));
    this.name = "RpcGatewayRefusalError";
  }
}

const parsedBody = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Classifies a broadcast response as a gateway refusal. Only the wallet
 * gateway's own endpoint qualifies, and only a documented pre-forward code on
 * the status the gateway uses for it. Everything else (a custom or foundation
 * node, an unknown code, a documented code on another status, any other 5xx)
 * returns null and keeps the transport's outcome-unknown rule.
 */
export const gatewayBroadcastRefusal = (
  fromWalletGateway: boolean,
  status: number,
  text: string,
): RpcGatewayRefusalError | null => {
  if (!fromWalletGateway) return null;
  if (!((status >= 400 && status < 500) || status === 503)) return null;
  if (new TextEncoder().encode(text).length > GATEWAY_BODY_LIMIT_BYTES) return null;
  const code = gatewayErrorCode(parsedBody(text));
  if (code === null || PRE_FORWARD_REFUSALS.get(code) !== status) return null;
  return new RpcGatewayRefusalError(code);
};
