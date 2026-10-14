/**
 * The collapsed Home row shows the public/private split beneath the combined
 * amount whenever part of the balance is private (issue 664), in the row's own
 * two-place column format, and stays quiet for a public-only token.
 */
import { describe, expect, test } from "bun:test";
import type { TokenBalance } from "../../../../src/popup/responses/responses";
import {
  type PrivateBreakdown,
  TOKEN_SPLIT_LINE,
  unifiedBalanceRow,
} from "../../../../src/sidepanel/journeys/portfolio/token-row";

const token: TokenBalance = {
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  balance: "0x1",
  decimals: 18,
  formatted: "1234.5",
  id: "SN_MAIN:ETH:0x049d",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};

const ready = (formatted: string, balance: string): PrivateBreakdown => ({
  balance,
  formatted,
  kind: "ready",
});

// The collapsed summary only: the expanded breakdown keeps its own lines.
const summary = (html: string): string => html.slice(0, html.indexOf("</summary>"));

describe("unifiedBalanceRow split line", () => {
  test("a public-only token shows no split line", () => {
    const html = unifiedBalanceRow(token, undefined, undefined, "usd", {
      private: ready("0", "0x0"),
      publicFormatted: "1234.5",
    });
    expect(html).not.toContain("token-split");
    expect(html).toContain("Public balance");
  });

  test("a private-only token shows a zero public amount beside the private one", () => {
    const html = unifiedBalanceRow({ ...token, formatted: "0.5" }, undefined, undefined, "usd", {
      private: ready("0.5", "0x6f05b59d3b20000"),
      publicFormatted: "0",
    });
    expect(summary(html)).toContain('<p class="token-split">0.00 public · 0.50 private</p>');
  });

  test("a split token shows both amounts grouped and padded like the row", () => {
    const html = unifiedBalanceRow(token, undefined, undefined, "usd", {
      private: ready("1000.25", "0x1"),
      publicFormatted: "234.25",
    });
    expect(summary(html)).toContain('<p class="token-split">234.25 public · 1,000.25 private</p>');
    // The expanded detail still names each bucket.
    expect(html).toContain("Public balance");
    expect(html).toContain("Private balance");
  });

  test("no split line while the private balance is unknown", () => {
    for (const kind of ["loading", "unavailable", "pending", "unregistered"] as const) {
      const html = unifiedBalanceRow(token, undefined, undefined, "usd", {
        private: { kind },
        publicFormatted: "1234.5",
      });
      expect(html).not.toContain("token-split");
    }
  });

  test("the proposed line reads public first, then private", () => {
    expect(TOKEN_SPLIT_LINE("1.00", "2.00")).toBe("1.00 public · 2.00 private");
  });
});
