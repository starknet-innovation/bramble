/**
 * One reusable bounded network boundary for the trade terminal. Every terminal
 * HTTP request and Starknet RPC read goes through here so a stalled or oversized
 * third-party response cannot wedge a cached request or grow a tab without
 * bound.
 *
 * Guarantees:
 *  - the caller's `AbortSignal` is composed with an internal deadline, so a
 *    request that never produces headers is aborted even after every caller
 *    detaches;
 *  - the response body is capped by a byte counter as it streams, with a
 *    `Content-Length` precheck as a fast path, so an oversized body is rejected
 *    before it is parsed or stored;
 *  - abort reasons distinguish a local timeout from a caller cancellation;
 *  - a `ReadableStream`-based `Response` keeps working with `response.json()`,
 *    `response.text()` and the RPC provider's own reader.
 *
 * The boundary never inspects credentials and never changes request bytes; it
 * only bounds lifecycle and size.
 */

/** Internal deadline applied to a normal JSON API request. */
export const BOUNDED_FETCH_DEFAULT_DEADLINE_MS = 20_000;

/** Internal deadline applied to a Starknet RPC request (reads can be slower). */
export const BOUNDED_FETCH_RPC_DEADLINE_MS = 60_000;

/** Maximum decoded response body for a JSON API request. */
const BOUNDED_FETCH_MAX_BYTES = 4 * 1024 * 1024;

/** Maximum decoded response body for a Starknet RPC request. */
export const BOUNDED_FETCH_RPC_MAX_BYTES = 32 * 1024 * 1024;

/** Maximum error-body prefix retained for diagnostics. */
export const BOUNDED_ERROR_BODY_CHARS = 300;

/**
 * Request options accepted by {@link boundedFetch}. The two extra keys are
 * consumed by the boundary and never forwarded to the underlying `fetch`.
 */
export type BoundedRequestInit = RequestInit & {
  /** Internal deadline in milliseconds before the request is aborted. */
  readonly deadlineMs?: number;
  /** Maximum decoded response bytes before the body stream errors. */
  readonly maxBytes?: number;
};

/**
 * Thrown when a response body exceeds the configured byte cap. A distinct type
 * keeps a local bound from being mistaken for a server response.
 */
export class ResponseTooLargeError extends Error {
  constructor(url: string, maxBytes: number) {
    super(`Response from ${url} exceeded the ${maxBytes} byte limit`);
    this.name = "ResponseTooLargeError";
  }
}

/**
 * Reason used when the internal deadline aborts a request, distinguishable from
 * a caller cancellation.
 */
const requestTimeoutReason = (): DOMException =>
  new DOMException("Request timed out", "TimeoutError");

const callerAbortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("Aborted", "AbortError");

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
};

// Composes the caller signal with an internal deadline. The returned `dispose`
// clears the timer and the listener and is called once the request has fully
// settled, including after the body is consumed.
const composeSignals = (
  callerSignal: AbortSignal | null | undefined,
  deadlineMs: number,
): { readonly signal: AbortSignal; readonly dispose: () => void } => {
  const controller = new AbortController();
  if (callerSignal?.aborted === true) {
    controller.abort(callerAbortReason(callerSignal));
    return { dispose: () => undefined, signal: controller.signal };
  }
  const onAbort = (): void => controller.abort(callerAbortReason(callerSignal as AbortSignal));
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(requestTimeoutReason()), deadlineMs);
  return {
    dispose: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onAbort);
    },
    signal: controller.signal,
  };
};

// Wraps a response body in a stream that errors once more than `maxBytes` have
// been counted, and releases the request lifecycle on completion or cancel.
const cappedBody = (
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  url: string,
  dispose: () => void,
): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      dispose();
      await reader.cancel(reason).catch(() => undefined);
    },
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        dispose();
        throw error;
      }
      if (result.done === true) {
        dispose();
        controller.close();
        return;
      }
      total += result.value.byteLength;
      controller.enqueue(result.value);
      if (total > maxBytes) {
        dispose();
        await reader.cancel().catch(() => undefined);
        controller.error(new ResponseTooLargeError(url, maxBytes));
      }
    },
  });
};

/**
 * Fetches a request bounded by an internal deadline and a response-byte cap.
 * The returned response is safe to read with `json()` or `text()`: its body
 * errors with {@link ResponseTooLargeError} if it grows past the cap.
 */
export const boundedFetch = async (
  input: RequestInfo | URL,
  init?: BoundedRequestInit,
): Promise<Response> => {
  const {
    deadlineMs = BOUNDED_FETCH_DEFAULT_DEADLINE_MS,
    maxBytes = BOUNDED_FETCH_MAX_BYTES,
    signal: callerSignal,
    ...rest
  } = init ?? {};
  const url = requestUrl(input);
  const { signal, dispose } = composeSignals(callerSignal, deadlineMs);
  let response: Response;
  try {
    response = await fetch(input, { ...rest, signal });
  } catch (error) {
    dispose();
    throw error;
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    dispose();
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(url, maxBytes);
  }
  if (response.body === null) {
    dispose();
    return response;
  }
  return new Response(cappedBody(response.body, maxBytes, url, dispose), {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};

/**
 * Reads at most `maxChars` characters of an error body and releases the
 * connection, so a large error payload is never stored in full.
 */
export const readBoundedErrorBody = async (
  response: Response,
  maxChars: number = BOUNDED_ERROR_BODY_CHARS,
): Promise<string> => {
  const body = response.body;
  if (body === null) {
    return "";
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < maxChars) {
      const { done, value } = await reader.read();
      if (done === true) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // A capped or aborted error body is expected to surface here; the prefix
    // collected so far is still the useful diagnostic.
  }
  await reader.cancel().catch(() => undefined);
  return text.slice(0, maxChars);
};
