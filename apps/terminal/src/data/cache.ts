/**
 * Shared read-through cache + in-flight de-duplication + retry/backoff for the
 * JSON GET endpoints the data layer polls. Its job is to stop the app from
 * hammering rate-limited public APIs:
 *
 *  - De-duplication: concurrent callers requesting the same URL share ONE
 *    network request instead of each firing their own (e.g. Portfolio + Tokens
 *    both reading prices coalesce into a single fetch).
 *  - TTL cache: a successful response is served from memory for `cacheMs`, so a
 *    remount or a second consumer within the window never hits the network.
 *  - Backoff: on HTTP 429 / 5xx the request retries with exponential backoff,
 *    honoring a `Retry-After` header when the server sent one. Aborted requests
 *    never retry.
 *
 * Under vitest (`import.meta.env.MODE === "test"`) caching AND retries are
 * disabled so `getJson` behaves exactly like the underlying `fetchJson` — the
 * unit suite mocks `fetch` per-test and must see each call go through unchanged.
 */
import { fetchJson, HttpError } from "./client";

/** Vite/Bun-safe env accessor (see endpoints.ts for the same guard). */
const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;

/**
 * Caching + retries are live in the real app but OFF under test so mocked-fetch
 * assertions see each request unchanged (no stale cache, no slow backoff loops).
 */
const RESILIENCE_ENABLED = env.MODE !== "test";

/** Default exponential-backoff ceiling and base for retryable failures. */
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;

type CacheEntry = { readonly value: unknown; readonly expires: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

const abortError = (): DOMException => new DOMException("Aborted", "AbortError");

// A shared request must outlive any one React consumer. Strict Mode mounts,
// aborts, then remounts effects; passing the first effect's signal to the shared
// fetch poisoned the promise reused by the real mount. Each caller can still
// stop waiting without cancelling the underlying request for every caller.
const waitFor = <T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> => {
  if (signal === undefined || signal === null) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
};

/** Options for {@link getJson}: standard `RequestInit` plus resilience knobs. */
export type GetJsonOptions = RequestInit & {
  /** Serve a cached success for this many ms (0 disables the TTL cache). */
  readonly cacheMs?: number;
  /** Max retries on a 429/5xx before giving up. Default 3. */
  readonly retries?: number;
};

const isRetryableStatus = (status: number): boolean =>
  status === 429 || (status >= 500 && status < 600);

/** Aborts-aware sleep: rejects with the abort reason if `signal` fires first. */
const sleep = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

/**
 * Cached, de-duplicated, backoff-aware JSON GET. Same signature surface as
 * `fetchJson`, so callers just swap the import; the extra `cacheMs` / `retries`
 * options tune the resilience per endpoint.
 */
export const getJson = async <T>(url: string, opts: GetJsonOptions = {}): Promise<T> => {
  const { cacheMs = 0, retries = 3, ...init } = opts;
  const { signal, ...sharedInit } = init;
  const ttl = RESILIENCE_ENABLED ? cacheMs : 0;
  const maxRetries = RESILIENCE_ENABLED ? retries : 0;
  const key = `${init.method ?? "GET"} ${url}`;

  if (ttl > 0) {
    const hit = cache.get(key);
    if (hit !== undefined && hit.expires > Date.now()) {
      return hit.value as T;
    }
  }

  const existing = inFlight.get(key);
  if (existing !== undefined) {
    return waitFor(existing as Promise<T>, signal);
  }

  const run = (async (): Promise<T> => {
    let attempt = 0;
    for (;;) {
      try {
        const value = await fetchJson<T>(url, sharedInit);
        if (ttl > 0) {
          cache.set(key, { value, expires: Date.now() + ttl });
        }
        return value;
      } catch (cause) {
        if (cause instanceof HttpError && isRetryableStatus(cause.status) && attempt < maxRetries) {
          const backoff = cause.retryAfterMs ?? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
          attempt += 1;
          await sleep(backoff);
          continue;
        }
        throw cause;
      }
    }
  })();

  inFlight.set(key, run);
  const remove = (): void => {
    if (inFlight.get(key) === run) {
      inFlight.delete(key);
    }
  };
  void run.then(remove, remove);
  return waitFor(run, signal);
};

/** Clears the TTL cache and any tracked in-flight promises (test helper). */
export const clearCache = (): void => {
  cache.clear();
  inFlight.clear();
};
