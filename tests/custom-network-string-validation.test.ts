/**
 * Custom RPC URL validation: the length/type guard rejects a non-string, an
 * empty string, and an over-2048-character string before attempting to parse a
 * URL, while a normal https endpoint is still accepted.
 */
import { describe, expect, test } from "bun:test";
import { isCustomRpcUrl } from "../src/storage/custom-network";

describe("isCustomRpcUrl length/type guard", () => {
  test("rejects an empty string", () => {
    expect(isCustomRpcUrl("")).toBe(false);
  });

  test("rejects a string longer than 2048 characters", () => {
    const tooLong = `https://example.com/${"a".repeat(2100)}`;
    expect(tooLong.length).toBeGreaterThan(2048);
    expect(isCustomRpcUrl(tooLong)).toBe(false);
  });

  test("rejects non-string values", () => {
    expect(isCustomRpcUrl(undefined)).toBe(false);
    expect(isCustomRpcUrl(42)).toBe(false);
    expect(isCustomRpcUrl({ url: "https://example.com" })).toBe(false);
  });

  test("still accepts a normal https endpoint", () => {
    expect(isCustomRpcUrl("https://rpc.example.com")).toBe(true);
  });
});
