/**
 * Watch-asset token assembly hardening: reject hostile token names (markup,
 * control, RTL, non-ASCII homoglyphs) at the dapp boundary (A-M3) and normalize
 * the contract address to a canonical form so case/padding variants of the same
 * token dedupe (A-L8).
 */
import { describe, expect, test } from "bun:test";
import { watchAssetToken } from "../../src/background/watch-asset";
import { canonicalAddress } from "../../src/starknet/networks";

const ADDRESS = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

const nameToken = (name: string) =>
  watchAssetToken({ address: ADDRESS, decimals: 6, name, symbol: "USDC" }, null, "SN_MAIN");

describe("watch-asset token name charset (A-M3)", () => {
  test("accepts an ordinary printable name", () => {
    expect(nameToken("USD Coin")?.name).toBe("USD Coin");
  });

  test("rejects a name containing angle-bracket markup", () => {
    expect(nameToken("<img src=x onerror=alert(1)>")).toBeNull();
  });

  test("rejects a name with a control character", () => {
    expect(nameToken(`USD${String.fromCharCode(0)}Coin`)).toBeNull();
  });

  test("rejects a name with an RTL-override character", () => {
    expect(nameToken(`USD${String.fromCharCode(0x202e)}Coin`)).toBeNull();
  });

  test("rejects a non-ASCII homoglyph name", () => {
    // Cyrillic lookalikes of Latin letters (U+0430 etc.) are non-ASCII.
    expect(nameToken(String.fromCharCode(0x430, 0x440, 0x440))).toBeNull();
  });
});

describe("watch-asset address canonicalization (A-L8)", () => {
  test("folds case and leading-zero padding to one canonical address", () => {
    expect(canonicalAddress("0xABC")).toBe(canonicalAddress("0x0abc"));
    expect(canonicalAddress("0xAbC")).toBe(canonicalAddress("0xabc"));
    expect(canonicalAddress("0x0")).toBeNull();
    expect(canonicalAddress("not-hex")).toBeNull();
  });

  test("keeps a full-width address stable and lowercase", () => {
    expect(canonicalAddress(ADDRESS)).toBe(ADDRESS);
    expect(canonicalAddress(ADDRESS.toUpperCase().replace("0X", "0x"))).toBe(ADDRESS);
  });

  test("stores a canonical address so mixed-case variants produce one token", () => {
    const lower = watchAssetToken(
      { address: "0xabc", decimals: 18, name: "Test Token", symbol: "TST" },
      null,
      "SN_MAIN",
    );
    const padded = watchAssetToken(
      { address: "0x0ABC", decimals: 18, name: "Test Token", symbol: "TST" },
      null,
      "SN_MAIN",
    );
    expect(lower?.address).toBe(padded?.address);
  });
});
