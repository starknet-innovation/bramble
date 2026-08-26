/**
 * `hexToBytes` decodes untrusted encodings at a trust boundary — a post-quantum
 * key or signature read off a device response — so it must be total and exact:
 * every rejection is a value that would otherwise decode to different bytes than
 * the sender meant, and it round-trips with `bytesToHex` in both directions.
 */
import { expect, test } from "bun:test";
import { bytesToHex, hexToBytes } from "@mc-wallet/core/hex";

test("round-trips with bytesToHex", () => {
  const bytes = Uint8Array.from([0, 1, 15, 16, 127, 128, 254, 255]);
  expect(hexToBytes(`0x${bytesToHex(bytes)}`)).toEqual(bytes);
  expect(bytesToHex(hexToBytes("0x00ff10") as Uint8Array)).toBe("00ff10");
  expect(hexToBytes("0x")).toEqual(new Uint8Array(0));
});

test("rejects anything that is not one exact lowercase byte string", () => {
  // A missing prefix or an odd digit count would silently shift every byte.
  expect(hexToBytes("00ff")).toBeNull();
  expect(hexToBytes("0xabc")).toBeNull();
  // Uppercase is a different spelling of the same value; the wallet emits one.
  expect(hexToBytes("0xAB")).toBeNull();
  expect(hexToBytes("0xzz")).toBeNull();
  expect(hexToBytes("0x 12")).toBeNull();
  expect(hexToBytes("0x12 ")).toBeNull();
  expect(hexToBytes("")).toBeNull();
});

test("decodes a long value without loss", () => {
  const long = Uint8Array.from({ length: 3309 }, (_, index) => index % 256);
  expect(hexToBytes(`0x${bytesToHex(long)}`)).toEqual(long);
});
