/**
 * The polling/cancellation engine every data hook is built on. Runs an async
 * fetcher, exposes `{ data, isLoading, error, refresh }`, cancels the in-flight
 * request (via AbortSignal) when dependencies change or the component unmounts,
 * and optionally re-runs on an interval. On a refresh/poll it keeps the last
 * good `data` so the UI shows stale-but-valid rows instead of flashing a
 * skeleton, and surfaces the new error alongside it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Resource } from "./types";

const toMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
};

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
  fetcherRef.current = fetcher;

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
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
