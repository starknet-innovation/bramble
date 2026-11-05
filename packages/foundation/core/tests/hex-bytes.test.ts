/**
 * Unprefixed lowercase hex byte strings: one accepted spelling per byte
 * string, bounds checked before any pattern work, and a decoder that never
 * returns a partial or reinterpreted result.
 */
import { describe, expect, test } from "bun:test";
import { bytesToHex, hexToBytes, isLowercaseHexBytes } from "@bramble/core/hex";

const DIGEST = "9b257b6acd00017b1488ed9d73d05bc8a5dbdd43c8aa54d1d37c7e807d65c515";

describe("isLowercaseHexBytes", () => {
  test("admits whole bytes within the bounds only", () => {
    expect(isLowercaseHexBytes(DIGEST, 32, 32)).toBe(true);
    expect(isLowercaseHexBytes("", 0, 1)).toBe(true);
    for (const value of [
      DIGEST.slice(2),
      `${DIGEST}00`,
      DIGEST.toUpperCase(),
      `0x${DIGEST.slice(2)}`,
      `${DIGEST.slice(1)}`,
      `${DIGEST.slice(2)}zz`,
      32,
      null,
    ]) {
      expect(isLowercaseHexBytes(value, 32, 32)).toBe(false);
    }
    expect(isLowercaseHexBytes("", 1, 4)).toBe(false);
  });
});

describe("hexToBytes", () => {
  test("inverts bytesToHex exactly", () => {
    const bytes = hexToBytes(DIGEST);
    expect(bytes).not.toBeNull();
    expect(bytes?.length).toBe(32);
    expect(bytesToHex(bytes ?? new Uint8Array())).toBe(DIGEST);
    expect(hexToBytes("")).toEqual(new Uint8Array());
  });

  test("refuses every non-canonical spelling", () => {
    for (const value of ["0", "0x00", "AB", "zz", "a b", "0g"]) {
      expect(hexToBytes(value)).toBeNull();
    }
  });
});
