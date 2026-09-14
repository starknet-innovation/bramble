/**
 * The error-response validator at the background boundary. Split from
 * ./popup-responses for the file-size budget: this shape gained an optional
 * `detail` — the uncurated reason behind a curated `error`, sent only to the
 * extension's own surfaces — and it is worth pinning on its own rather than
 * inside a broader account-shape test.
 */
import { describe, expect, test } from "bun:test";
import { isErrorResponse } from "../../../src/popup/responses/responses";

describe("isErrorResponse", () => {
  test("accepts a non-empty error and rejects anything else in its place", () => {
    expect(isErrorResponse({ error: "bad passphrase" })).toBe(true);
    expect(isErrorResponse({ code: "bad", error: "bad passphrase" })).toBe(false);
    expect(isErrorResponse({ error: 1 })).toBe(false);
    expect(isErrorResponse({ error: "" })).toBe(false);
    expect(isErrorResponse(null)).toBe(false);
    expect(isErrorResponse({})).toBe(false);
  });

  test("accepts an optional string detail beside the error", () => {
    expect(isErrorResponse({ detail: "node said max_fee too low", error: "invoke failed" })).toBe(
      true,
    );
    expect(isErrorResponse({ detail: 1, error: "invoke failed" })).toBe(false);
    // A detail with nothing to qualify is not an error response.
    expect(isErrorResponse({ detail: "orphan reason" })).toBe(false);
  });

  test("rejects a present-but-undefined detail, like every optional field here", () => {
    // JSON never carries `undefined`, so an explicit one means the sender built
    // the object wrong — the shared key check treats that as invalid rather than
    // silently reading it as absent.
    expect(isErrorResponse({ detail: undefined, error: "invoke failed" })).toBe(false);
  });
});
