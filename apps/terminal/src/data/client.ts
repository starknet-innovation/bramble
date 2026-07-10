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
import { withRpcFallback } from "../protocols/support/provider";
import { RPC_URLS } from "./endpoints";

/**
 * Thrown when an HTTP request completes with a non-2xx status. Carries the
 * status code and (a truncated) response body so callers — notably the perps
 * region-lock detection — can branch on `status === 403`.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(status: number, url: string, body: string) {
    super(`Request to ${url} failed with ${status}: ${body.slice(0, 300)}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/**
 * Fetches `url` and parses the JSON body, throwing `HttpError` on a non-2xx
 * response (with the body text attached) so failures are never silently read as
 * empty data. The caller's `AbortSignal` is threaded through so polling hooks
 * cancel in-flight requests on unmount / dependency change.
 */
export const fetchJson = async <T>(url: string, opts?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...opts,
    headers: { accept: "application/json", ...(opts?.headers ?? {}) },
  });
  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // Ignore body read failures — the status alone is enough to classify.
    }
    throw new HttpError(response.status, url, body);
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
  withRpcFallback([...RPC_URLS], run);
