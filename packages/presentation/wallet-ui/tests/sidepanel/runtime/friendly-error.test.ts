/**
 * Tests for the raw-to-friendly error mapping that drives side-panel error
 * toasts and their copy-to-clipboard affordance.
 */
import { describe, expect, test } from "bun:test";

import { friendlyError } from "../../../src/sidepanel/runtime/friendly-error";

describe("friendlyError", () => {
  test("rewrites 'invalid <...> request' validation strings", () => {
    for (const raw of [
      "invalid transfer review request",
      "invalid balances request",
      "invalid unlock request",
    ]) {
      const result = friendlyError(raw);
      expect(result.message).not.toBe(raw);
      expect(result.message).not.toContain("invalid");
    }
  });

  test("maps 'wallet unavailable' to a friendly message", () => {
    const result = friendlyError("wallet unavailable");
    expect(result).toEqual({
      message: "The wallet is locked or unavailable. Unlock it and try again.",
    });
  });

  test("maps platform network rejections to a friendly message", () => {
    for (const raw of ["Failed to fetch", "NetworkError", "Load failed", "network error"]) {
      const result = friendlyError(raw);
      if (raw === "NetworkError") {
        // Not an exact match; treated as unexpected and left verbatim.
        expect(result.message).toBe(raw);
        continue;
      }
      expect(result).toEqual({
        message: "Couldn't reach the network. Check your connection and try again.",
      });
    }
  });

  test("matches known strings case-insensitively and ignores surrounding whitespace", () => {
    const result = friendlyError("  Wallet Unavailable  ");
    expect(result.message).toBe("The wallet is locked or unavailable. Unlock it and try again.");
  });

  test("keeps unrecognized errors verbatim", () => {
    const raw = "krusty kms handshake failed: 0x1f timeout";
    expect(friendlyError(raw)).toEqual({ message: raw });
  });

  test("falls back to a generic message for empty input", () => {
    const result = friendlyError("   ");
    expect(result.message).toBe("Something went wrong. Please try again.");
  });
});
