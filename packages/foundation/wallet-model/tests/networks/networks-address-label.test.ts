/**
 * The one display shortener: padded to 64 digits first, then 6 and 4 characters,
 * and untouched when the value is not a felt. `addressText` is the full form.
 */
import { describe, expect, test } from "bun:test";
import { addressLabel, addressText } from "@bramble/wallet-model/networks";

const ADDRESS = "0x5e1d3f3c9f2b3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293af2e4";

describe("addressLabel", () => {
  test("padded and canonical spellings of one address give one label", () => {
    expect(addressLabel(ADDRESS)).toBe("0x05e1…f2e4");
    expect(addressLabel(`0x0${ADDRESS.slice(2)}`)).toBe("0x05e1…f2e4");
    expect(addressLabel(`0x${ADDRESS.slice(2).toUpperCase()}`)).toBe("0x05e1…f2e4");
  });

  test("a short felt is padded before it is cut, never shown stripped", () => {
    expect(addressLabel("0x11ce")).toBe("0x0000…11ce");
    expect(addressLabel("0x5")).toBe("0x0000…0005");
    expect(addressLabel("")).toBe("");
  });

  test("the full spelling is the padded 64-digit form", () => {
    expect(addressText(ADDRESS)).toBe(`0x0${ADDRESS.slice(2)}`);
    expect(addressText(`0x${ADDRESS.slice(2).toUpperCase()}`)).toBe(`0x0${ADDRESS.slice(2)}`);
    expect(addressText("0x5")).toBe(`0x${"5".padStart(64, "0")}`);
    expect(addressText("not an address")).toBe("not an address");
  });

  test("a value that is not a felt passes through unchanged", () => {
    const nostr = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
    expect(addressLabel(nostr)).toBe(nostr);
    expect(addressLabel("1700000000")).toBe("1700000000");
    expect(addressLabel("not an address at all")).toBe("not an address at all");
  });
});
