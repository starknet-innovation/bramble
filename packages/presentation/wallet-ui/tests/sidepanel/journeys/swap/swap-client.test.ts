/**
 * Swap client helper checks: the quote value-delta sanity heuristic that
 * surfaces bad routes (dust orders through thin pools) before the user acts.
 */
import { describe, expect, test } from "bun:test";
import {
  createSwapClient,
  SWAP_LOSS_HIGH_RISK_PERCENT,
  SWAP_LOSS_WARN_PERCENT,
  type SwapQuoteView,
  swapValueDeltaPercent,
} from "../../../../src/sidepanel/journeys/swap/swap-client";

const quote = (sellUsd: number, buyUsd: number): SwapQuoteView => ({
  buyAmount: "1",
  buyAmountInUsd: buyUsd,
  gasFeesInUsd: 0.01,
  quoteId: "q",
  sellAmount: "1",
  sellAmountInUsd: sellUsd,
});

describe("swap value delta", () => {
  test("reports the received-vs-paid difference in percent", () => {
    expect(swapValueDeltaPercent(quote(0.0855, 0.0853))).toBeCloseTo(-0.234, 2);
    expect(swapValueDeltaPercent(quote(100, 95))).toBeCloseTo(-5, 5);
    expect(swapValueDeltaPercent(quote(100, 101))).toBeCloseTo(1, 5);
  });

  test("a mispriced dust route crosses the warn and high-risk tiers", () => {
    // The reported oddity: ~3 STRK quoted at ~4.6x its value would read as a
    // ±78% delta — far past both thresholds, so the UI warns and restyles.
    const bad = swapValueDeltaPercent(quote(0.39, 0.085)) ?? 0;
    expect(bad).toBeLessThan(-SWAP_LOSS_HIGH_RISK_PERCENT);
    expect(SWAP_LOSS_WARN_PERCENT).toBeLessThan(SWAP_LOSS_HIGH_RISK_PERCENT);
  });

  test("an unpriced sell side yields null instead of a fake zero", () => {
    expect(swapValueDeltaPercent(quote(0, 0.085))).toBeNull();
  });

  test("a priced sell side whose buy side is valued at zero is a total loss (Sherlock 137)", () => {
    expect(swapValueDeltaPercent(quote(0.39, 0))).toBe(-100);
  });

  test("the wallet's feed can surface a loss the aggregator hides (Sherlock 137)", () => {
    // The aggregator claims parity; the wallet's prices show a 40% loss.
    expect(swapValueDeltaPercent({ ...quote(100, 100), valueDeltaPercent: -40 })).toBe(-40);
  });

  test("a wallet feed showing parity cannot hide a loss the aggregator reports", () => {
    // A mismatched feed price reads break-even; the aggregator reports -50%.
    const masked = swapValueDeltaPercent({ ...quote(100, 50), valueDeltaPercent: 0 }) ?? 0;
    expect(masked).toBeCloseTo(-50, 5);
    expect(masked).toBeLessThan(-SWAP_LOSS_HIGH_RISK_PERCENT);
  });

  test("the wallet's delta stands alone when the aggregator leaves the sell side unpriced", () => {
    expect(swapValueDeltaPercent({ ...quote(0, 0), valueDeltaPercent: -12 })).toBe(-12);
  });
});

describe("swap quote validation", () => {
  const clientAnswering = (swapQuote: unknown) =>
    createSwapClient({
      async sendMessage() {
        return { ok: true, swapQuote };
      },
    } as never);
  const input = { amount: "1", buyTokenId: "b", sellTokenId: "s" };

  test("accepts a wallet-priced value delta and rejects one past a total loss", async () => {
    const accepted = await clientAnswering({ ...quote(1, 1), valueDeltaPercent: -40 }).quote(input);
    expect(accepted.valueDeltaPercent).toBe(-40);
    await expect(
      clientAnswering({ ...quote(1, 1), valueDeltaPercent: -101 }).quote(input),
    ).rejects.toThrow();
    await expect(
      clientAnswering({ ...quote(1, 1), valueDeltaPercent: Number.NaN }).quote(input),
    ).rejects.toThrow();
  });
});

describe("token search ranking", () => {
  test("exact symbol beats prefix beats name beats substring", async () => {
    const { rankTokenQueryMatch } = await import("../../../../src/sidepanel/shared/token-search");
    expect(rankTokenQueryMatch({ name: "USDC", symbol: "USDC" }, "usdc")).toBe(0);
    expect(rankTokenQueryMatch({ name: "Bridged USDC", symbol: "USDC.e" }, "usdc")).toBe(1);
    expect(rankTokenQueryMatch({ name: "USDC yield", symbol: "fyU" }, "usdc")).toBe(2);
    expect(rankTokenQueryMatch({ name: "Relend Network USDC", symbol: "rUSDC" }, "usdc")).toBe(3);
    expect(rankTokenQueryMatch({ name: "Ethereum", symbol: "ETH" }, "usdc")).toBeNull();
  });
});
