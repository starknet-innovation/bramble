/**
 * JSON-RPC transport for the privacy paymaster, split from `./paymaster` so
 * the plan and submission logic there stays on one screen.
 *
 * Trust boundary: the relay URL is wallet-configured, never dapp-supplied, and
 * everything it answers is untrusted. Responses are size-bounded and
 * shape-checked before any field is read. Failure behaviour is deliberately
 * asymmetric: a quote never broadcasts, so its failures are determinate
 * `WalletError`s with a sanitized reason; a broadcast whose answer was lost
 * (a 5xx status, oversized, unparseable, ended by this client's deadline) throws an
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
  Strk20FeeTokenUnsupportedError,
  sanitizeStrk20Detail,
  TOKEN_NOT_SUPPORTED_CODE,
} from "../sdk/official-sdk-errors";
import { STRK20_SUBMISSION_UNAVAILABLE } from "../service";

/** The injected transport both paymaster entry points accept. */
export type PaymasterHttp = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/**
 * This client's deadline on one relay request. It must end before the STRK20
 * gateway's own paymaster deadline (`PAYMASTER_UPSTREAM_TIMEOUT_MS` in
 * `apps/terminal/api/_lib/upstream-deadlines.ts`, pinned by a conformance test): when
 * the gateway gives up first, the wallet learns of a lost answer only as an
 * HTTP status, and when this client gives up first it learns of it as its own
 * deadline expiry. Both are read as a lost answer, but the order keeps the
 * deadline the wallet controls the one that normally fires (Sherlock 159).
 */
export const PAYMASTER_TIMEOUT_MS = 20_000;
const MAX_PAYMASTER_RESPONSE_BYTES = 1024 * 1024;
/**
 * The one relay method that puts a transaction on the wire, mirroring
 * `BROADCAST_RPC_METHODS` in `../provider`: only a broadcast-capable call can
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

const readBoundedResponse = async (response: Response): Promise<string | null> => {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > MAX_PAYMASTER_RESPONSE_BYTES)
  ) {
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > MAX_PAYMASTER_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

// A relay answer the wallet could not read is not the same thing as a relay
// refusal. Once `paymaster_executeTransaction` has left the wallet, the relay
// may already have forwarded the transaction while its reply was truncated,
// oversized, unparseable, or ended by this client's own deadline — so that case
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

// An expired request deadline is the one send-side failure that is ambiguous:
// the request was written and this client stopped waiting for the answer. Every
// other rejection here (DNS, refused connection, a refused redirect) means no
// exchange took place. `AbortSignal.timeout` surfaces as this exact
// `DOMException`, and the transport is wallet-chosen, never remote-controlled.
const isDeadlineExpiry = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "TimeoutError";

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
  } catch (error) {
    throw isDeadlineExpiry(error)
      ? lostAnswer(method)
      : new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  if (!response.ok) {
    throw response.status >= 500
      ? lostAnswer(method)
      : new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  let body: unknown;
  try {
    const text = await readBoundedResponse(response);
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
