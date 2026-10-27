/**
 * JSON-RPC transport for the gasless paymaster routes. It shares the private
 * client's deadline and response-size bound, and does not share that client's
 * rule that every 5xx is a lost broadcast. A `503` whose body is
 * `screening_unavailable` means screening stopped before the relay was asked.
 *
 * Trust boundary: the URL is the wallet's own route, never a dapp field.
 * Responses are untrusted. An execute whose answer cannot be read throws
 * `IndeterminateRpcWriteError`. A stated `{"error":"<code>"}` does not.
 */

import { UNTRUSTED_REQUEST_INIT } from "@bramble/core/http-json";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@bramble/starknet/provider";
import { type GaslessGatewayCode, GaslessRefusal, isGaslessGatewayCode } from "./gasless-errors";
import {
  PAYMASTER_TIMEOUT_MS,
  type PaymasterHttp,
  readBoundedPaymasterResponse,
} from "./paymaster-rpc";

/**
 * JSON-RPC id this poster sends and requires back. A mismatched id is an
 * answer the client cannot attribute.
 */
export const GASLESS_RPC_ID = 1;

/**
 * How many times an execute or a quote is repeated after
 * `screening_unavailable`. The gateway has not forwarded those attempts.
 */
export const GASLESS_SCREENING_RETRIES = 2;

const CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const gatewayCode = (body: unknown): GaslessGatewayCode | null => {
  if (!isRecord(body) || typeof body["error"] !== "string" || !CODE_PATTERN.test(body["error"])) {
    return null;
  }
  if (!hasOnlyKnownKeys(body, ["error"])) {
    return null;
  }
  return isGaslessGatewayCode(body["error"]) ? body["error"] : "unrecognised";
};

const relayCode = (error: unknown): GaslessGatewayCode => {
  if (!isRecord(error) || typeof error["data"] !== "string" || !CODE_PATTERN.test(error["data"])) {
    return "unrecognised";
  }
  return isGaslessGatewayCode(error["data"]) ? error["data"] : "unrecognised";
};

const lost = (): IndeterminateRpcWriteError =>
  new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);

/**
 * One classified gasless response. `retry` is only `screening_unavailable`.
 * `lost` is an execute whose answer could not be read.
 */
type Classified =
  | { readonly kind: "lost" }
  | { readonly kind: "refused"; readonly code: GaslessGatewayCode }
  | { readonly kind: "result"; readonly result: unknown }
  | { readonly kind: "retry" };

const statusClass = (
  status: number,
  code: GaslessGatewayCode | null,
  executes: boolean,
): Classified | null => {
  if (status >= 500) {
    if (code === "screening_unavailable") {
      return { kind: "retry" };
    }
    return executes ? { kind: "lost" } : { kind: "refused", code: code ?? "unrecognised" };
  }
  if (code !== null) {
    return { kind: "refused", code };
  }
  if (status >= 400) {
    return { kind: "refused", code: "unrecognised" };
  }
  return null;
};

const resultClass = (body: unknown, executes: boolean): Classified => {
  if (
    !isRecord(body) ||
    !hasOnlyKnownKeys(body, ["error", "id", "jsonrpc", "result"]) ||
    body["jsonrpc"] !== "2.0" ||
    body["id"] !== GASLESS_RPC_ID
  ) {
    return executes ? { kind: "lost" } : { kind: "refused", code: "unrecognised" };
  }
  if (body["error"] !== undefined) {
    return { kind: "refused", code: relayCode(body["error"]) };
  }
  if (!Object.hasOwn(body, "result")) {
    return executes ? { kind: "lost" } : { kind: "refused", code: "unrecognised" };
  }
  return { kind: "result", result: body["result"] };
};

const classify = (status: number, body: unknown, executes: boolean): Classified =>
  statusClass(status, gatewayCode(body), executes) ?? resultClass(body, executes);

const throwClassified = (classified: Exclude<Classified, { readonly kind: "result" }>): never => {
  if (classified.kind === "lost") {
    throw lost();
  }
  if (classified.kind === "retry") {
    throw new GaslessRefusal("screening_unavailable", true);
  }
  throw new GaslessRefusal(classified.code);
};

const sendGasless = async (
  http: PaymasterHttp,
  url: string,
  method: string,
  params: unknown,
  executes: boolean,
): Promise<Response | Classified> => {
  try {
    return await http(url, {
      ...UNTRUSTED_REQUEST_INIT,
      body: JSON.stringify({ id: GASLESS_RPC_ID, jsonrpc: "2.0", method, params }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(PAYMASTER_TIMEOUT_MS),
    });
  } catch {
    return executes ? { kind: "lost" } : { kind: "refused", code: "unrecognised" };
  }
};

const responseBody = async (response: Response): Promise<unknown> => {
  try {
    const text = await readBoundedPaymasterResponse(response);
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

const exchange = async (
  http: PaymasterHttp,
  url: string,
  method: string,
  params: unknown,
  executes: boolean,
): Promise<Classified> => {
  const sent = await sendGasless(http, url, method, params, executes);
  if (!(sent instanceof Response)) {
    return sent;
  }
  const body = await responseBody(sent);
  if (body === undefined && sent.ok) {
    return executes ? { kind: "lost" } : { kind: "refused", code: "unrecognised" };
  }
  return classify(sent.status, body, executes);
};

/**
 * Posts one gasless JSON-RPC call and returns its `result`.
 *
 * Quote failures throw {@link GaslessRefusal}. An execute whose body is
 * `screening_unavailable` is retried `GASLESS_SCREENING_RETRIES` times and
 * then throws that same refusal, still retryable, because nothing was
 * submitted. Any other lost execute answer throws
 * `IndeterminateRpcWriteError`.
 */
export const postGasless = async (
  http: PaymasterHttp,
  url: string,
  method: string,
  params: unknown,
  options: {
    readonly executes: boolean;
    readonly sleep?: (ms: number) => Promise<void>;
  },
): Promise<unknown> => {
  const sleep = options.sleep ?? pause;
  let attempt = 0;
  for (;;) {
    const classified = await exchange(http, url, method, params, options.executes);
    if (classified.kind === "retry" && attempt < GASLESS_SCREENING_RETRIES) {
      attempt += 1;
      await sleep(250 * attempt);
      continue;
    }
    if (classified.kind === "result") {
      return classified.result;
    }
    throwClassified(classified);
  }
};
