/**
 * The two halves of the error boundary. `walletErrorMessage` is the curated,
 * dapp-safe message; `errorDetail` is the uncurated reason kept for the wallet's
 * own surfaces. The pair only works if callers can tell them apart, so these
 * tests pin what each one does and does not reveal.
 */
import { describe, expect, test } from "bun:test";
import { errorDetail, WalletError, walletErrorMessage } from "../src/errors";

describe("walletErrorMessage", () => {
  test("keeps a curated WalletError message and collapses anything else", () => {
    expect(walletErrorMessage(new WalletError("Device rejected the request"), "fallback")).toBe(
      "Device rejected the request",
    );
    expect(walletErrorMessage(new Error("node said something internal"), "fallback")).toBe(
      "fallback",
    );
    expect(walletErrorMessage("a bare string", "fallback")).toBe("fallback");
  });
});

describe("errorDetail", () => {
  test("returns the raw reason a curated message throws away", () => {
    // The point of the helper: this text is exactly what `walletErrorMessage`
    // discards, and exactly what a user needs to see a rejected fee.
    expect(
      errorDetail(
        new Error("Account balance is smaller than the max fee"),
        "invoke request failed",
      ),
    ).toBe("Account balance is smaller than the max fee");
    expect(errorDetail("rate limited by the node", "invoke request failed")).toBe(
      "rate limited by the node",
    );
  });

  test("returns null when it would only repeat the summary or add nothing", () => {
    // Callers omit the field on null, so an error whose own message is already
    // the curated one does not get shown twice.
    expect(errorDetail(new Error("invoke request failed"), "invoke request failed")).toBeNull();
    expect(errorDetail(new Error("   "), "invoke request failed")).toBeNull();
    expect(errorDetail(new Error(""), "invoke request failed")).toBeNull();
    // A non-Error, non-string carries no message to extract.
    expect(errorDetail({ code: -32_005 }, "invoke request failed")).toBeNull();
    expect(errorDetail(undefined, "invoke request failed")).toBeNull();
  });

  test("trims and truncates so a node cannot push an unbounded string into the UI", () => {
    expect(errorDetail(new Error("  padded reason  "), "summary")).toBe("padded reason");
    const long = errorDetail(new Error("x".repeat(5000)), "summary");
    expect(long).not.toBeNull();
    // Bounded, and the truncation is visible rather than a silent cut.
    expect((long ?? "").length).toBeLessThanOrEqual(601);
    expect(long?.endsWith("…")).toBe(true);
  });
});
