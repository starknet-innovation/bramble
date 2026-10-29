/**
 * JSON-RPC transport for the sponsored-deploy relay (#431). It shares the
 * paymaster deadline and response bound (`@bramble/transactions/paymaster-http`)
 * and the gasless lane's rule for a broadcast: an answer is a refusal only when
 * it proves the relay stopped, never because it failed to prove otherwise.
 *
 * Trust boundary: the relay URL is wallet-configured, never dapp-supplied, and
 * everything it answers is untrusted. A broadcast is a determinate refusal only
 * for a well-formed JSON-RPC 2.0 envelope carrying this request's id and a
 * valid `error` object (an integer `code` and a string `message`) and no `result`, on a
 * 2xx or 4xx status. Every other broadcast answer — a transport failure, the
 * deadline, an unreadable or oversized body, a 5xx, a non-2xx without that
 * clean error, a malformed error (null, a string, no code or message), an error beside a
 * result — is a lost answer: the relay may already have forwarded the deploy.
 * A quote never broadcasts, so its failures are always determinate. It is a
 * refusal only for that same clean JSON-RPC error: a bare 4xx (the gateway
 * switched off, `404 sponsored_deploy_disabled`, or a plain rate limit) is not
 * the sponsor refusing this account, so it reads as unavailable.
 */

import { UNTRUSTED_REQUEST_INIT } from "@bramble/core/http-json";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  PAYMASTER_TIMEOUT_MS,
  type PaymasterHttp,
  readBoundedPaymasterResponse,
} from "@bramble/transactions/paymaster-http";

/** JSON-RPC id this client sends and requires back. */
const SPONSORED_DEPLOY_RPC_ID = "bramble-strk20";

/**
 * One classified relay answer: its `result`, a refusal the relay stated for
 * itself, or (`lost`) an answer that does not say whether anything was sent.
 */
export type SponsoredRelayAnswer =
  | { readonly kind: "lost" }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "result"; readonly result: unknown };

const LOST: SponsoredRelayAnswer = { kind: "lost" };

// A JSON-RPC error object the relay stated for itself: an integer code and a
// string message, as JSON-RPC 2.0 requires. `null`, a string, or an object
// missing either is not one.
const isRpcError = (value: unknown): value is { readonly message: string } =>
  isRecord(value) &&
  typeof value["code"] === "number" &&
  Number.isInteger(value["code"]) &&
  typeof value["message"] === "string";

/**
 * Classifies one HTTP answer to a relay call. Quote and broadcast share one
 * rule: only a clean JSON-RPC error is a refusal.
 */
const classifySponsoredRelayAnswer = (status: number, body: unknown): SponsoredRelayAnswer => {
  if (status >= 500) return LOST;
  if (
    !isRecord(body) ||
    !hasOnlyKnownKeys(body, ["error", "id", "jsonrpc", "result"]) ||
    body["jsonrpc"] !== "2.0" ||
    body["id"] !== SPONSORED_DEPLOY_RPC_ID
  ) {
    return LOST;
  }
  const hasResult = Object.hasOwn(body, "result");
  if (Object.hasOwn(body, "error")) {
    const error = body["error"];
    return isRpcError(error) && !hasResult ? { kind: "refused", message: error.message } : LOST;
  }
  return status < 300 && hasResult ? { kind: "result", result: body["result"] } : LOST;
};

const readBody = async (response: Response): Promise<unknown> => {
  try {
    const text = await readBoundedPaymasterResponse(response);
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Posts one JSON-RPC call to the sponsored-deploy relay and classifies the
 * answer. Never throws: a transport failure or the deadline is `lost`. The
 * caller decides what `lost` means — status unknown for a broadcast, an
 * unavailable sponsor for a quote.
 */
export const postSponsoredRelay = async (
  http: PaymasterHttp,
  url: string,
  method: string,
  params: unknown,
): Promise<SponsoredRelayAnswer> => {
  let response: Response;
  try {
    response = await http(url, {
      ...UNTRUSTED_REQUEST_INIT,
      body: JSON.stringify({ id: SPONSORED_DEPLOY_RPC_ID, jsonrpc: "2.0", method, params }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(PAYMASTER_TIMEOUT_MS),
    });
  } catch {
    return LOST;
  }
  return classifySponsoredRelayAnswer(response.status, await readBody(response));
};
