/**
 * Shared network primitives for the data layer: a typed, AbortController-aware
 * JSON fetch that throws on any non-2xx (carrying the status + response body),
 * and a shared Starknet RPC accessor that reuses the protocol layer's
 * `withRpcFallback` failover against the configured mainnet endpoints.
 *
 * Every `data/` hook fetches through these two helpers so error handling,
 * cancellation, and RPC failover are consistent across the app.
 */
import type { RpcProvider } from "starknet";
import {
  BOUNDED_ERROR_BODY_CHARS,
  type BoundedRequestInit,
  boundedFetch,
  readBoundedErrorBody,
} from "../../protocols/support/bounded-network";
import { withRpcFallback } from "../../protocols/support/provider";
import { RPC_DIRECT_URLS } from "./endpoints";

/**
 * Thrown when an HTTP request completes with a non-2xx status. Carries the
 * status code and (a truncated) response body so callers — notably the perps
 * region-lock detection — can branch on `status === 403`.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  /**
   * Parsed `Retry-After` value in milliseconds when the server sent one (429/503
   * responses often do). Null when absent/unparseable. The cache layer honors
   * this before falling back to exponential backoff.
   */
  readonly retryAfterMs: number | null;

  constructor(status: number, url: string, body: string, retryAfterMs: number | null = null) {
    const prefix = body.slice(0, BOUNDED_ERROR_BODY_CHARS);
    super(`Request to ${url} failed with ${status}: ${prefix}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = prefix;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Parses an HTTP `Retry-After` header (either delta-seconds or an HTTP date)
 * into milliseconds from now. Returns null when the header is missing or cannot
 * be interpreted.
 */
const parseRetryAfter = (value: string | null): number | null => {
  if (value === null || value.trim().length === 0) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
};

/**
 * Fetches `url` and parses the JSON body through the bounded network boundary,
 * throwing `HttpError` on a non-2xx response (with a bounded body prefix
 * attached) so failures are never silently read as empty data. The caller's
 * `AbortSignal` is composed with an internal deadline and the response body is
 * byte-capped, so polling hooks cancel in-flight requests on unmount /
 * dependency change without leaving a stalled request in the shared cache.
 */
export const fetchJson = async <T>(url: string, opts?: BoundedRequestInit): Promise<T> => {
  const response = await boundedFetch(url, {
    ...opts,
    headers: { accept: "application/json", ...(opts?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await readBoundedErrorBody(response);
    const retryAfterMs = parseRetryAfter(response.headers?.get?.("retry-after") ?? null);
    throw new HttpError(response.status, url, body, retryAfterMs);
  }
  return (await response.json()) as T;
};

/**
 * Runs an RPC read against the configured mainnet endpoints with transport-level
 * failover, reusing the protocol layer's provider plumbing. Semantic RPC errors
 * (e.g. a contract that does not implement an entrypoint) propagate; only node
 * downtime fails over to the next endpoint.
 */
export const withRpc = <T>(run: (provider: RpcProvider) => Promise<T>): Promise<T> =>
  withRpcFallback([...RPC_DIRECT_URLS], run);
