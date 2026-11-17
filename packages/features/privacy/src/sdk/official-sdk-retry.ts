/**
 * Bounded retry policy for read-only STRK20 service operations.
 */

import { isRetryableStrk20ServiceError, strk20RetryAfterMilliseconds } from "./official-sdk-errors";

/**
 * How many times one read-only service operation is attempted before a
 * throttling failure is final. Exported so a proof can report which of its
 * bounded rounds it is in.
 */
export const MAX_SERVICE_ATTEMPTS = 3;

/**
 * Pause boundary for a retryable private-service read. The optional delay is a
 * capped, untrusted upstream hint in milliseconds; callers must not expose it
 * outside this SDK boundary.
 */
export type ServiceRetryPause = (
  attempt: number,
  retryAfterMilliseconds: number | undefined,
) => Promise<void>;

/**
 * Default backoff between bounded privacy-service retries. A valid upstream
 * delta-seconds hint takes precedence over the short local fallback.
 */
export const defaultServiceRetryPause: ServiceRetryPause = (
  attempt,
  retryAfterMilliseconds,
): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, retryAfterMilliseconds ?? attempt * 1_000);
  });

/**
 * Retries only explicit throttling failures from a read before any transaction
 * can be prepared or broadcast. Non-throttling failures pass through unchanged
 * for the caller's reviewed error mapper.
 */
export const retryStrk20ServiceRead = async <T>(
  read: () => Promise<T>,
  pause: ServiceRetryPause,
): Promise<T> => {
  for (let attempt = 1; attempt <= MAX_SERVICE_ATTEMPTS; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt === MAX_SERVICE_ATTEMPTS || !isRetryableStrk20ServiceError(error)) {
        throw error;
      }
      await pause(attempt, strk20RetryAfterMilliseconds(error));
    }
  }
  throw new Error("unreachable STRK20 retry state");
};
