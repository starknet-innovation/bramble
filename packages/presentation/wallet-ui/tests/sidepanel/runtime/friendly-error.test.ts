/**
 * Tests for the raw-to-friendly error mapping that drives side-panel error
 * toasts and their copy-to-clipboard affordance.
 */
import { describe, expect, test } from "bun:test";

import { friendlyError } from "../../../src/sidepanel/runtime/friendly-error";

describe("friendlyError", () => {
  test("rewrites 'invalid <...> request' validation strings without a copy control", () => {
    for (const raw of [
      "invalid transfer review request",
      "invalid balances request",
      "invalid unlock request",
    ]) {
      const result = friendlyError(raw);
      expect(result.copyable).toBe(false);
      expect(result.message).not.toBe(raw);
      expect(result.message).not.toContain("invalid");
    }
  });

  // The raw guard string names neither the cause nor a remedy, and the chain ids
  // it compares are opaque felts, so the mapping must supply the actual fix. The
  // guard fires on every network, so the copy must stay network-agnostic — the
  // devnet-only `--chain-id` flag belongs on the network screen, not here.
  test("turns the write-path chain guard into an actionable endpoint hint", () => {
    const result = friendlyError("RPC endpoint returned the wrong Starknet chain");
    expect(result.copyable).toBe(false);
    expect(result.message).toContain("nothing was submitted");
    expect(result.message).toContain("Advanced");
    expect(result.message).not.toContain("Devnet");
  });

  test("maps 'wallet unavailable' to a friendly, non-copyable message", () => {
    const result = friendlyError("wallet unavailable");
    expect(result).toEqual({
      message: "The wallet is locked or unavailable. Unlock it and try again.",
      copyable: false,
    });
  });

  test("maps platform network rejections to a friendly, non-copyable message", () => {
    for (const raw of ["Failed to fetch", "NetworkError", "Load failed", "network error"]) {
      const result = friendlyError(raw);
      if (raw === "NetworkError") {
        // Not an exact match; treated as unexpected and left copyable.
        expect(result.copyable).toBe(true);
        continue;
      }
      expect(result).toEqual({
        message: "Couldn't reach the network. Check your connection and try again.",
        copyable: false,
      });
    }
  });

  test("matches known strings case-insensitively and ignores surrounding whitespace", () => {
    const result = friendlyError("  Wallet Unavailable  ");
    expect(result.copyable).toBe(false);
    expect(result.message).toBe("The wallet is locked or unavailable. Unlock it and try again.");
  });

  test("keeps unrecognized errors verbatim and marks them copyable", () => {
    const raw = "krusty kms handshake failed: 0x1f timeout";
    expect(friendlyError(raw)).toEqual({ message: raw, copyable: true });
  });

  test("falls back to a generic message with no copy control for empty input", () => {
    const result = friendlyError("   ");
    expect(result.copyable).toBe(false);
    expect(result.message).toBe("Something went wrong. Please try again.");
  });
});
