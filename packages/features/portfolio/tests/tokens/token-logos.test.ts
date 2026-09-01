/**
 * tokenLogoSvg returns a bundled inline SVG for a known token address (matched
 * after canonicalization), null for an unknown token, and null — via the
 * BigInt catch — for a malformed address that cannot be canonicalized.
 */
import { describe, expect, test } from "bun:test";
import { tokenLogoSvg } from "@bramble/portfolio/token-logos";

// STRK, one of the bundled logos.
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

describe("tokenLogoSvg", () => {
  test("returns the inline SVG for a known token, tolerating spacing and case", () => {
    const logo = tokenLogoSvg(STRK);
    expect(logo).toContain("<svg");
    expect(tokenLogoSvg(`  ${STRK.toUpperCase()}  `)).toBe(logo);
  });

  test("returns null for a well-formed but unknown token address", () => {
    expect(tokenLogoSvg("0x123")).toBeNull();
  });

  test("returns null when the address cannot be parsed as a felt", () => {
    expect(tokenLogoSvg("not-an-address")).toBeNull();
  });
});
