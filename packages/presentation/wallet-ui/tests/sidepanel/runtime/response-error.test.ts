/**
 * The panel's error carrier. A background error response may bring a `detail` —
 * the uncurated reason behind its curated message — and the runtime client throws
 * a single Error rather than threading two values through every caller. These
 * tests pin that the detail survives the trip and that nothing else is mistaken
 * for one.
 */
import { describe, expect, test } from "bun:test";
import { errorCause, responseError } from "../../../src/sidepanel/runtime/response-error";

describe("responseError", () => {
  test("prefers the response's own message over the fallback", () => {
    expect(responseError({ error: "origin not connected" }, "approval failed").message).toBe(
      "origin not connected",
    );
    expect(responseError({ ok: true }, "approval failed").message).toBe("approval failed");
    expect(responseError(undefined, "approval failed").message).toBe("approval failed");
  });

  test("carries a detail as the Error's cause so callers need not thread it", () => {
    const detail = "Account balance is smaller than the transaction's max_fee";
    const error = responseError({ detail, error: "invoke request failed" }, "approval failed");

    expect(error.message).toBe("invoke request failed");
    expect(errorCause(error)).toBe(detail);
  });

  test("leaves the cause unset when the response has no detail", () => {
    expect(
      errorCause(responseError({ error: "wallet locked" }, "approval failed")),
    ).toBeUndefined();
    expect(errorCause(responseError({ ok: true }, "approval failed"))).toBeUndefined();
  });
});

describe("errorCause", () => {
  test("reads only a string cause, so another layer's cause is never displayed", () => {
    // A cause set by some other layer is not a message we may show a user.
    expect(errorCause(new Error("wrapped", { cause: new Error("inner") }))).toBeUndefined();
    expect(errorCause(new Error("wrapped", { cause: { code: -32_005 } }))).toBeUndefined();
    expect(errorCause(new Error("plain"))).toBeUndefined();
    expect(errorCause("not an error")).toBeUndefined();
    expect(errorCause(undefined)).toBeUndefined();
  });
});
