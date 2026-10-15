/**
 * Token row renders the compact amount, fiat value, and a signed 24h change
 * carrying its own window label.
 */
import { describe, expect, test } from "bun:test";
import type { TokenBalance } from "../../../../src/popup/responses/responses";
import {
  balanceRow,
  compactAmount,
  PORTFOLIO_FRACTION_PLACES,
  starknetNetworkGlyph,
  tokenGlyph,
} from "../../../../src/sidepanel/journeys/portfolio/token-row";

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
    expect(html).toContain('class="token-change-win"> · 24h price</span>');
    expect(html).toContain("$1,684.00");
    expect(html).toContain(">0.84</p>");
  });

  test("shows a red down change for a negative move", () => {
    const html = balanceRow(token, 2000, -4.2, "usd");
    expect(html).toContain('class="token-change down">↓ 4.20%');
    expect(html).toContain('class="token-change-win"> · 24h price</span>');
  });

  test("omits the change badge when no change is known", () => {
    const html = balanceRow(token, 2000, undefined, "usd");
    expect(html).not.toContain("token-change");
  });

  test("marks a private balance without changing the public row structure", () => {
    const html = balanceRow(token, 2000, 1.53, "usd", { private: true });

    expect(html).toContain('class="token-open"');
    expect(html).toContain('class="private-balance-mark" aria-label="Private balance"');
    expect(html).toContain("$1,684.00");
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

  test("uses the trusted bundled token mark for Starknet network context", () => {
    const glyph = starknetNetworkGlyph();
    expect(glyph).toContain('<svg class="token-logo"');
    expect(glyph).not.toContain('class="token-mark"');
  });

  test("compactAmount groups thousands and trims trailing zeros", () => {
    expect(compactAmount("1284.5019")).toBe("1,284.5019");
    expect(compactAmount("1.0")).toBe("1");
    expect(compactAmount("49.899547068683683328")).toBe("49.89954");
  });
});

describe("portfolio precision", () => {
  test("the portfolio column pads to two places without erasing dust", () => {
    // Padded so a column of amounts lines up.
    expect(compactAmount("1", PORTFOLIO_FRACTION_PLACES)).toBe("1.00");
    expect(compactAmount("0.5", PORTFOLIO_FRACTION_PLACES)).toBe("0.50");
    expect(compactAmount("1234.56789", PORTFOLIO_FRACTION_PLACES)).toBe("1,234.56");
    expect(compactAmount("0", PORTFOLIO_FRACTION_PLACES)).toBe("0.00");
    // Truncated, never rounded up: a balance is never overstated.
    expect(compactAmount("9.999", PORTFOLIO_FRACTION_PLACES)).toBe("9.99");
    // Dust keeps its significant digits rather than claiming the balance is
    // empty, which two fixed places would do.
    expect(compactAmount("0.00001234", PORTFOLIO_FRACTION_PLACES)).toBe("0.00001234");
    expect(compactAmount("0.005", PORTFOLIO_FRACTION_PLACES)).toBe("0.005");
    expect(compactAmount("0.000000001", PORTFOLIO_FRACTION_PLACES)).toBe("<0.00000001");
  });

  test("detail screens keep the wider default precision", () => {
    expect(compactAmount("1")).toBe("1");
    expect(compactAmount("0.5")).toBe("0.5");
    expect(compactAmount("1234.56789")).toBe("1,234.56789");
  });
});
