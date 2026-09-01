/** HTTP Retry-After parser boundary checks. */
import { describe, expect, test } from "bun:test";
import { parseRetryAfterMilliseconds } from "../src/http-json";

describe("HTTP retry timing", () => {
  test("accepts bounded standard forms and rejects malformed timing", () => {
    const now = Date.parse("2026-08-25T10:00:00.000Z");
    expect(parseRetryAfterMilliseconds(" 12 ", now)).toBe(12_000);
    expect(parseRetryAfterMilliseconds("Tue, 25 Aug 2026 10:01:00 GMT", now)).toBe(60_000);
    expect(parseRetryAfterMilliseconds("12.5", now)).toBeNull();
    expect(parseRetryAfterMilliseconds("never", now)).toBeNull();
    expect(parseRetryAfterMilliseconds("Tue, 25 Aug 2026 10:01:00 GMT", Number.NaN)).toBeNull();
  });
});
