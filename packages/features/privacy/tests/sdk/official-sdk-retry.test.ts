/**
 * The default pause between bounded privacy-service read retries: an upstream
 * retry-after hint wins over the local per-attempt fallback.
 */
import { describe, expect, test } from "bun:test";
import { defaultServiceRetryPause, MAX_SERVICE_ATTEMPTS } from "../../src/sdk/official-sdk-retry";

describe("default privacy-service retry pause", () => {
  test("waits for the upstream hint when one is given", async () => {
    const started = performance.now();
    await defaultServiceRetryPause(MAX_SERVICE_ATTEMPTS, 5);
    // The fallback for this attempt would be seconds; the 5 ms hint is what ran.
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("a zero hint resolves without waiting for the fallback", async () => {
    await expect(defaultServiceRetryPause(1, 0)).resolves.toBeUndefined();
  });
});
