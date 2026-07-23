/**
 * Token row renders the compact amount, fiat value, and a signed 24h change.
 */
import { describe, expect, test } from "bun:test";
import type { TokenBalance } from "../src/popup/responses";
import { balanceRow, compactAmount, tokenGlyph } from "../src/sidepanel/token-row";

const token: TokenBalance = {
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  balance: "842000000000000000",
  decimals: 18,
  formatted: "0.842",
  id: "SN_MAIN:ETH:0x049d",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};

describe("balanceRow", () => {
  test("shows fiat and a green up change for a positive move", () => {
    const html = balanceRow(token, 2000, 1.53, "usd");
    expect(html).toContain('class="token-change up">↑ 1.53%');
    expect(html).toContain("$1,684.00");
    expect(html).toContain(">0.842</p>");
  });

  test("shows a red down change for a negative move", () => {
    const html = balanceRow(token, 2000, -4.2, "usd");
    expect(html).toContain('class="token-change down">↓ 4.20%');
  });

  test("omits the change badge when no change is known", () => {
    const html = balanceRow(token, 2000, undefined, "usd");
    expect(html).not.toContain("token-change");
  });

  // Logos moved from 128px raster <img> to inline vector <svg> so they stay
  // crisp on high-DPI displays; unknown tokens still fall back to a letter badge.
  test("renders a bundled token logo as an inline vector svg", () => {
    const glyph = tokenGlyph(token.address, token.symbol);
    expect(glyph).toContain('<svg class="token-logo"');
    expect(glyph).not.toContain("<img");
  });

  test("falls back to a letter badge for an unknown token", () => {
    const glyph = tokenGlyph("0x1234", "FOO");
    // Letter badges carry a deterministic per-token tint (data-tone).
    expect(glyph).toMatch(/^<span class="token-mark" data-tone="[0-3]">FOO<\/span>$/);
  });

  test("compactAmount groups thousands and trims trailing zeros", () => {
    expect(compactAmount("1284.5019")).toBe("1,284.5019");
    expect(compactAmount("1.0")).toBe("1");
    expect(compactAmount("49.899547068683683328")).toBe("49.89954");
  });
});
