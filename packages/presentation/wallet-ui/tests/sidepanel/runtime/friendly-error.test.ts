/**
 * Tests for the raw-to-friendly error mapping that drives side-panel error
 * toasts and their copy-to-clipboard affordance.
 */
import { describe, expect, test } from "bun:test";
import { WRONG_CHAIN_MESSAGE } from "@mc-wallet/starknet/provider";

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

  // The raw string names neither cause nor remedy, so the mapping supplies the
  // fix — and stays network-agnostic, since the guard fires on every network.
  test("turns the write-path chain guard into an actionable endpoint hint", () => {
    const result = friendlyError(WRONG_CHAIN_MESSAGE);
    expect(result.message).toContain("nothing was submitted");
    expect(result.message).toContain("Advanced");
    expect(result.message).not.toContain("Devnet");
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
      expect(result.message).toContain("Couldn't reach the network");
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

  test("collapses raw RPC and API diagnostics to short recovery copy", () => {
    expect(
      friendlyError(
        'RPC: starknet_addInvokeTransaction with params {"calldata":["0x1"]} 55: rejected',
      ).message,
    ).toBe("The RPC rejected this request. Copy the error details for the full response.");
    expect(friendlyError(`Gateway rejected\n${"response body ".repeat(30)}`).message).toBe(
      "A wallet service rejected this request. Copy the error details for the full response.",
    );
    expect(friendlyError('HTTP 400 response body: {"error":"invalid payload"}').message).toBe(
      "A wallet service rejected this request. Copy the error details for the full response.",
    );
    expect(friendlyError("HTTP 429: rate_limited").message).toBe(
      "This service is rate limiting requests. Wait a moment and try again.",
    );
    for (const raw of [
      "24: Block not found: undefined",
      "55: Account validation failed: Resource bounds were not satisfied",
      "Transaction execution error: contract reverted",
    ]) {
      expect(friendlyError(raw).message).toBe(
        "The RPC rejected this request. Copy the error details for the full response.",
      );
    }
  });

  test("keeps actionable wallet-domain errors visible", () => {
    const raw = "Argent multisig intent nonce is no longer current";
    expect(friendlyError(raw).message).toBe(raw);
  });

  test("falls back to a generic message for empty input", () => {
    const result = friendlyError("   ");
    expect(result.message).toBe("Something went wrong. Please try again.");
  });
});
