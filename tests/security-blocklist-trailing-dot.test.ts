/**
 * Trailing-dot FQDN blocklist regression: the fully-qualified "example.com."
 * form must resolve to the same registrable domain as "example.com" so it
 * cannot slip past the exact blocklist (A-H2).
 */
import { describe, expect, test } from "bun:test";
import { isBlockedOrigin } from "../src/security/blocklist";

describe("blocklist trailing-dot normalization", () => {
  test("blocks the dotted FQDN form of a blocklisted domain", () => {
    expect(isBlockedOrigin("https://airdrop-starknet.com")).toBe(true);
    expect(isBlockedOrigin("https://airdrop-starknet.com.")).toBe(true);
    expect(isBlockedOrigin("https://starknet-airdrop.com.")).toBe(true);
  });

  test("blocks a dotted subdomain of a blocklisted domain", () => {
    expect(isBlockedOrigin("https://www.airdrop-starknet.com.")).toBe(true);
  });

  test("leaves an unrelated dotted origin unblocked", () => {
    expect(isBlockedOrigin("https://example.com.")).toBe(false);
  });
});
