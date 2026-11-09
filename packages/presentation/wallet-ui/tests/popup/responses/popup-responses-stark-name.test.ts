/**
 * Name-resolution response validator: the recipient step only trusts a reply
 * that names the network it was resolved on and carries a well-formed
 * discriminated outcome, so a reply read on another network, or a malformed
 * one, can never be committed as an address.
 */
import { describe, expect, test } from "bun:test";
import { isStarkNameResolutionResponse } from "../../../src/popup/responses/responses";

const ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const resolved = () => ({
  networkId: "SN_MAIN",
  ok: true,
  resolution: { address: ADDRESS, status: "resolved" },
});

describe("isStarkNameResolutionResponse", () => {
  test("accepts a resolved name that names the network it was read on", () => {
    expect(isStarkNameResolutionResponse(resolved())).toBe(true);
  });

  test("accepts a not-found answer that names its network", () => {
    expect(
      isStarkNameResolutionResponse({
        networkId: "SN_MAIN",
        ok: true,
        resolution: { status: "not-found" },
      }),
    ).toBe(true);
  });

  test("rejects a reply that does not name the network, or names an unknown one", () => {
    expect(
      isStarkNameResolutionResponse({
        ok: true,
        resolution: { address: ADDRESS, status: "resolved" },
      }),
    ).toBe(false);
    expect(isStarkNameResolutionResponse({ ...resolved(), networkId: "SN_MAINNET" })).toBe(false);
  });

  test("rejects a malformed outcome or envelope", () => {
    expect(isStarkNameResolutionResponse({ ...resolved(), ok: false })).toBe(false);
    // A resolved outcome must carry a nonzero felt, never the zero address.
    expect(
      isStarkNameResolutionResponse({
        ...resolved(),
        resolution: { address: "0x0", status: "resolved" },
      }),
    ).toBe(false);
    expect(isStarkNameResolutionResponse({ ...resolved(), extra: true })).toBe(false);
    expect(isStarkNameResolutionResponse(null)).toBe(false);
  });
});
