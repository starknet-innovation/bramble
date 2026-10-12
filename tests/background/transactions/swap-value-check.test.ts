/**
 * The swap value check priced from the wallet's own feed (Sherlock 137): the
 * aggregator's USD figures describe its own quote, so the wallet prices both
 * sides itself whenever its feed knows both tokens, and falls back (undefined)
 * rather than guessing when it does not.
 */
import { describe, expect, test } from "bun:test";
import type { PriceService } from "@bramble/portfolio/prices";
import type { TokenConfig } from "@bramble/settings/preferences";
import { walletSwapValueDelta } from "../../../apps/extension/src/background/transactions/swap-value-check";

const token = (address: string, symbol: string): TokenConfig =>
  ({ address, decimals: 18, networkId: "SN_MAIN", symbol }) as unknown as TokenConfig;
const SELL = token("0xa", "AAA");
const BUY = token("0xb", "BBB");

const feed = (prices: Readonly<Record<string, number>>, fails = false): PriceService => ({
  async getPrices({ currency }) {
    if (fails) throw new Error("price host unreachable");
    return { asOf: 1, changes: {}, currency, prices, stale: false };
  },
  async getTokenChart({ currency }) {
    return { currency, points: [] };
  },
});

const delta = (prices: PriceService | undefined, sellAmount = "2", buyAmount = "3") =>
  walletSwapValueDelta({
    buyAmount,
    buyToken: BUY,
    currency: "usd",
    networkId: "SN_MAIN",
    prices,
    sellAmount,
    sellToken: SELL,
  });

describe("wallet-priced swap value delta", () => {
  test("prices both sides from the feed", async () => {
    // 2 × $10 sold for 3 × $5 received: a 25% loss.
    expect(await delta(feed({ "0xa": 10, "0xb": 5 }))).toBeCloseTo(-25, 5);
  });

  test("a zero buy amount is a total loss", async () => {
    expect(await delta(feed({ "0xa": 10, "0xb": 5 }), "2", "0")).toBe(-100);
  });

  test("falls back when the feed is missing, unpriced, zero-priced or failing", async () => {
    expect(await delta(undefined)).toBeUndefined();
    expect(await delta(feed({ "0xa": 10 }))).toBeUndefined();
    expect(await delta(feed({ "0xa": 10, "0xb": 0 }))).toBeUndefined();
    expect(await delta(feed({ "0xa": 10, "0xb": 5 }, true))).toBeUndefined();
  });

  test("falls back when an amount does not parse", async () => {
    expect(await delta(feed({ "0xa": 10, "0xb": 5 }), "0", "3")).toBeUndefined();
    expect(await delta(feed({ "0xa": 10, "0xb": 5 }), "x", "3")).toBeUndefined();
  });
});
