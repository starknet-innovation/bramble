/**
 * The polling/cancellation engine every data hook is built on. Runs an async
 * fetcher, exposes `{ data, isLoading, error, refresh }`, cancels the in-flight
 * request (via AbortSignal) when dependencies change or the component unmounts,
 * and optionally re-runs on an interval. On a refresh/poll it keeps the last
 * good `data`; when resource identity dependencies change it clears the prior
 * result so one market/token is never rendered under another one's heading.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { userErrorMessage } from "../../protocols/support/user-error";
import type { Resource } from "./types";

// Transport detail (a URL, a response body) and terminal plumbing collapse to
// the existing "Request failed"; see ../../protocols/support/user-error.
const toMessage = (error: unknown): string => userErrorMessage(error, "Request failed");

const sameDependencies = (left: readonly unknown[], right: readonly unknown[]): boolean =>
  left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

/**
 * Drives an async fetcher with cancellation and optional polling.
 *
 * @param fetcher receives an AbortSignal; may be recreated each render (the
 *   latest is always used, but it does not itself trigger a re-fetch).
 * @param deps re-fetch whenever these change (same contract as a dep array).
 * @param pollMs when > 0, re-fetch on this interval.
 */
export const useAsyncResource = <T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  pollMs = 0,
): Resource<T> => {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  const previousDepsRef = useRef<readonly unknown[] | null>(null);
  fetcherRef.current = fetcher;

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const previousDeps = previousDepsRef.current;
    if (previousDeps !== null && !sameDependencies(previousDeps, deps)) {
      setData(null);
    }
    previousDepsRef.current = [...deps];
    setIsLoading(true);
    void fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (active) {
          setData(result);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active && !controller.signal.aborted) {
          // Keep the last good data; only surface the fresh error.
          setError(toMessage(cause));
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (pollMs > 0) {
      intervalId = setInterval(() => setTick((value) => value + 1), pollMs);
    }
    return () => {
      active = false;
      controller.abort();
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, pollMs]);

  return { data, isLoading, error, refresh };
};
