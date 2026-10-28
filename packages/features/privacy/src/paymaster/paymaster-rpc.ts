/**
 * JSON-RPC transport for the privacy paymaster, split from `./paymaster` so
 * the plan and submission logic there stays on one screen.
 *
 * Trust boundary: the relay URL is wallet-configured, never dapp-supplied, and
 * everything it answers is untrusted. Responses are size-bounded and
 * shape-checked before any field is read. Failure behaviour is deliberately
 * asymmetric: a quote never broadcasts, so its failures are determinate
 * `WalletError`s with a sanitized reason; a broadcast whose answer was lost
 * (any transport failure, a 5xx status, oversized, unparseable) throws an
 * {@link IndeterminateRpcWriteError} because the relay may already have
 * forwarded the transaction, and callers must hold their state closed rather
 * than retry over a possibly-live write.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@bramble/starknet/provider";
import {
  PAYMASTER_TIMEOUT_MS,
  type PaymasterHttp,
  readBoundedPaymasterResponse,
} from "@bramble/transactions/paymaster-http";
import {
  Strk20FeeTokenUnsupportedError,
  sanitizeStrk20Detail,
  TOKEN_NOT_SUPPORTED_CODE,
} from "../sdk/official-sdk-errors";
import { STRK20_SUBMISSION_UNAVAILABLE } from "../service";
/**
 * The one relay method that puts a transaction on the wire, mirroring
 * `BROADCAST_RPC_METHODS` in `@bramble/starknet/rpc-transport`: only a broadcast-capable call can
 * leave a write in flight, so only it may mint the ambiguity marker.
 */
export const BROADCAST_PAYMASTER_METHOD = "paymaster_executeTransaction";

// The one piece of a JSON-RPC error worth showing is the reason, and the relay
// nests it: an execution rejection arrives as `data.execution_error`, not as a
// plain string. Reading only string `data` reduced every such rejection to a
// bare "TRANSACTION_EXECUTION_ERROR" with the actual cause thrown away.
const reportedDetails = (data: unknown): readonly string[] => {
  if (typeof data === "string") {
    return [data];
  }
  if (!isRecord(data)) {
    return [];
  }
  return Object.values(data).filter((value): value is string => typeof value === "string");
};

const relayReportedError = (method: string, reported: unknown): WalletError => {
  // An execute error may echo the submitted proof. Proof values are allowed to
  // be short, so no pattern sanitizer can distinguish them reliably from a
  // useful reason. Keep that post-proof boundary generic; quote failures carry
  // no proof and may retain a bounded, sanitized diagnostic.
  if (method === BROADCAST_PAYMASTER_METHOD) {
    return new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  const detail = sanitizeStrk20Detail(
    isRecord(reported)
      ? [reported["message"], ...reportedDetails(reported["data"])].join(": ")
      : String(reported),
  );
  const message =
    detail === ""
      ? STRK20_SUBMISSION_UNAVAILABLE
      : `${STRK20_SUBMISSION_UNAVAILABLE}: the private relay rejected the request (${detail})`;
  // Only a quote reaches here, so recovering by re-quoting is always safe: no
  // proof has been built and nothing is in flight.
  return isRecord(reported) && reported["code"] === TOKEN_NOT_SUPPORTED_CODE
    ? new Strk20FeeTokenUnsupportedError(message)
    : new WalletError(message);
};

// A relay answer the wallet could not read is not the same thing as a relay
// refusal. Once `paymaster_executeTransaction` has left the wallet, the relay
// may already have forwarded the transaction while its reply was truncated,
// oversized, unparseable, or cut off in transport — so that case
// carries the same ambiguity marker `runRpcBroadcast` mints on the JSON-RPC
// lane, and every layer above (the maturity scope in particular) holds its
// state closed instead of releasing it for a retry over a possibly-live write.
//
// A 5xx status is a lost answer too. The wallet's HTTP peer is usually the
// STRK20 gateway, not the relay, and the gateway answers 502 or 504 when its
// own upstream deadline expires or the relay's reply breaks off, which says
// nothing about whether the relay forwarded the transaction (Sherlock 159).
//
// Quote calls never broadcast, so their failures stay determinate; so does a
// refusal the relay states for itself, as a JSON-RPC error object or a 4xx
// status, since a client error means the request was refused. This closes the lossy-channel case, not a
// relay that lies about having rejected a transaction it forwarded — no
// classification at this boundary can, and the relay URL is wallet-configured
// rather than dapp-supplied for exactly that reason.
const lostAnswer = (method: string): WalletError =>
  method === BROADCAST_PAYMASTER_METHOD
    ? new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE)
    : new WalletError(STRK20_SUBMISSION_UNAVAILABLE);

// Once a broadcast's request has been handed to the transport, no rejection
// from it proves the relay never received the request: a connection reset or
// an empty reply surfaces as the same `TypeError` as a DNS failure, and this
// client's own deadline (`TimeoutError`) ends an exchange that already started.
// The JSON-RPC lane reads every transport failure on a broadcast the same way
// (`runRpcBroadcast` in `@bramble/starknet/provider`), so the relay lane does
// too. A quote never broadcasts, so its transport failures stay determinate.
/**
 * Posts one JSON-RPC request to the relay and returns its `result`. Throws a
 * determinate `WalletError` for a stated refusal or a failed quote, and an
 * `IndeterminateRpcWriteError` when a broadcast's answer could not be read.
 */
export const rpc = async (
  http: PaymasterHttp,
  url: string,
  method: string,
  params: unknown,
): Promise<unknown> => {
  let response: Response;
  try {
    response = await http(url, {
      body: JSON.stringify({ id: "bramble-strk20", jsonrpc: "2.0", method, params }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(PAYMASTER_TIMEOUT_MS),
    });
  } catch {
    throw lostAnswer(method);
  }
  if (!response.ok) {
    throw response.status >= 500
      ? lostAnswer(method)
      : new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  let body: unknown;
  try {
    const text = await readBoundedPaymasterResponse(response);
    if (text === null) {
      throw new Error("invalid response");
    }
    body = JSON.parse(text);
  } catch {
    throw lostAnswer(method);
  }
  if (
    !isRecord(body) ||
    !hasOnlyKnownKeys(body, ["error", "id", "jsonrpc", "result"]) ||
    body["jsonrpc"] !== "2.0" ||
    body["id"] !== "bramble-strk20"
  ) {
    throw lostAnswer(method);
  }
  const reported = body["error"];
  if (reported !== undefined) {
    throw relayReportedError(method, reported);
  }
  if (!Object.hasOwn(body, "result")) {
    throw lostAnswer(method);
  }
  return body["result"];
};
