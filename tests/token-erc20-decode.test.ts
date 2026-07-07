/**
 * ERC20 name/symbol decoding checks: single felt short strings and Cairo
 * ByteArray responses both decode to text.
 */
import { describe, expect, test } from "bun:test";
import { shortString } from "starknet";
import { decodeErc20String } from "../src/starknet/rpc";

const felt = (text: string): string => shortString.encodeShortString(text);

describe("decodeErc20String", () => {
  test("decodes an empty response to an empty string", () => {
    expect(decodeErc20String([])).toBe("");
  });

  test("decodes a single felt short string", () => {
    expect(decodeErc20String([felt("USDC")])).toBe("USDC");
  });

  test("decodes a ByteArray with only a pending word", () => {
    expect(decodeErc20String(["0x0", felt("Ether"), "0x5"])).toBe("Ether");
  });

  test("decodes a ByteArray with a full 31-byte word plus a pending word", () => {
    const word = "0123456789012345678901234567890";
    expect(word).toHaveLength(31);
    expect(decodeErc20String(["0x1", felt(word), felt("wxyz"), "0x4"])).toBe(`${word}wxyz`);
  });

  test("falls back to the first felt when the layout is not a ByteArray", () => {
    expect(decodeErc20String([felt("AB"), "0x99"])).toBe("AB");
  });
});
