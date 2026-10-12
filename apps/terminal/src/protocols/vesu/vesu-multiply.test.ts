import { afterEach, describe, expect, it, vi } from "vitest";
import { MAINNET_TOKEN_ADDRESSES, VESU_ADDRESSES } from "../constants";
import {
  quoteVesuMultiplyClose,
  quoteVesuMultiplyIncrease,
  buildVesuMultiplyCloseCalls,
  buildVesuMultiplyIncreaseCalls,
  parseVesuMultiplyExactOutQuote,
} from "./vesu-multiply";

const POOL = "0x451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5";
// The fixture route requests an exact USDC amount priced in ETH.
const USDC_FOR_ETH = {
  calculated: MAINNET_TOKEN_ADDRESSES.ETH,
  specified: MAINNET_TOKEN_ADDRESSES.USDC,
};

const response = {
  price_impact: -0.004,
  splits: [{
    amount_calculated: "500000000000000",
    amount_specified: "1000000",
    route: [{
      pool_key: {
        extension: "0x0",
        fee: "34028236692093847977029636859101184",
        tick_spacing: 200,
        token0: MAINNET_TOKEN_ADDRESSES.ETH,
        token1: MAINNET_TOKEN_ADDRESSES.USDC,
      },
      skip_ahead: 0,
      sqrt_ratio_limit: "0x2e76c7e22493026ef9d607c29a968",
    }],
  }],
  total_calculated: "500000000000000",
};

describe("Vesu Multiply boundary", () => {
  it("validates exact-output totals and applies the slippage ceiling", () => {
    const quote = parseVesuMultiplyExactOutQuote(
      {
        ...response,
        splits: [{
          ...response.splits[0],
          amount_calculated: "-500000000000000",
          amount_specified: "-1000000",
        }],
        total_calculated: "-500000000000000",
      },
      1_000_000n,
      100,
      USDC_FOR_ETH,
    );
    expect(quote.maxInputAmount).toBe(505_000_000_000_000n);
    expect(quote.priceImpactPct).toBe(-0.4);
    expect(() =>
      parseVesuMultiplyExactOutQuote(
        { ...response, total_calculated: "-500000000000000" },
        2_000_000n,
        100,
        USDC_FOR_ETH,
      )
    ).toThrow("route amount mismatch");
  });

  it("wraps Multiply with temporary approval and delegation", () => {
    const quote = parseVesuMultiplyExactOutQuote(
      {
        ...response,
        splits: [{
          ...response.splits[0],
          amount_calculated: "-500000000000000",
          amount_specified: "-1000000",
        }],
        total_calculated: "-500000000000000",
      },
      1_000_000n,
      100,
      USDC_FOR_ETH,
    );
    const calls = buildVesuMultiplyIncreaseCalls(
      POOL,
      MAINNET_TOKEN_ADDRESSES.ETH,
      MAINNET_TOKEN_ADDRESSES.USDC,
      "0x123",
      1_000_000_000_000_000_000n,
      quote,
    );
    expect(calls.map((call) => call.entrypoint)).toEqual([
      "approve",
      "modify_delegation",
      "modify_lever",
      "modify_delegation",
      "approve",
    ]);
    expect(calls[2]?.contractAddress).toBe(VESU_ADDRESSES.multiply);
  });

  it("atomically closes a position and revokes delegation", () => {
    const closeQuote = parseVesuMultiplyExactOutQuote(
      {
        ...response,
        splits: [{
          ...response.splits[0],
          amount_calculated: "-500000000000000",
          amount_specified: "-1000000",
        }],
        total_calculated: "-500000000000000",
      },
      1_000_000n,
      100,
      USDC_FOR_ETH,
    );
    expect(closeQuote.maxInputAmount).toBe(505_000_000_000_000n);
    expect(closeQuote.weights).toEqual([1_000_000_000_000_000_000n]);
    const calls = buildVesuMultiplyCloseCalls(
      POOL,
      MAINNET_TOKEN_ADDRESSES.ETH,
      MAINNET_TOKEN_ADDRESSES.USDC,
      "0x123",
      closeQuote,
    );
    expect(calls.map((call) => call.entrypoint)).toEqual([
      "modify_delegation",
      "modify_lever",
      "modify_delegation",
    ]);
  });

  it("refuses a route that does not connect the Multiply assets (Sherlock 147)", () => {
    const negative = {
      ...response,
      splits: [{
        ...response.splits[0],
        amount_calculated: "-500000000000000",
        amount_specified: "-1000000",
      }],
      total_calculated: "-500000000000000",
    };
    const withRoute = (route: readonly unknown[]) => ({
      ...negative,
      splits: [{ ...negative.splits[0], route }],
    });
    const hop = (token0: string, token1: string) => ({
      ...response.splits[0]!.route[0]!,
      pool_key: { ...response.splits[0]!.route[0]!.pool_key, token0, token1 },
    });
    const { ETH, STRK, USDC } = MAINNET_TOKEN_ADDRESSES;
    // A connected two-hop path USDC -> STRK -> ETH is accepted.
    expect(
      parseVesuMultiplyExactOutQuote(withRoute([hop(STRK, USDC), hop(ETH, STRK)]), 1_000_000n, 100, USDC_FOR_ETH)
        .splits[0]?.route,
    ).toHaveLength(2);
    // Starting away from the specified token, ending at another token, or
    // breaking the chain are all refused.
    for (const route of [
      [hop(ETH, STRK)],
      [hop(STRK, USDC)],
      [hop(STRK, USDC), hop("0x1", ETH)],
      // A hop that holds neither side of the walk is not skipped.
      [hop("0x1", "0x2"), hop(ETH, USDC)],
    ]) {
      expect(() =>
        parseVesuMultiplyExactOutQuote(withRoute(route), 1_000_000n, 100, USDC_FOR_ETH)
      ).toThrow("does not connect");
    }
  });

  it("quotes each direction with its own specified token", async () => {
    const { ETH, STRK, USDC } = MAINNET_TOKEN_ADDRESSES;
    const node = response.splits[0]!.route[0]!;
    // A two-hop USDC -> STRK -> ETH path, which only connects from USDC.
    const answer = {
      ...response,
      splits: [{
        ...response.splits[0],
        amount_calculated: "-500000000000000",
        amount_specified: "-1000000",
        route: [
          { ...node, pool_key: { ...node.pool_key, token0: STRK, token1: USDC } },
          { ...node, pool_key: { ...node.pool_key, token0: ETH, token1: STRK } },
        ],
      }],
      total_calculated: "-500000000000000",
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer))));
    // Increase: an exact collateral (USDC) output priced in debt (ETH).
    await expect(quoteVesuMultiplyIncrease(USDC, ETH, 1_000_000n)).resolves.toMatchObject({
      requiredInputAmount: 500_000_000_000_000n,
    });
    // Close: an exact debt (USDC) repayment priced in collateral (ETH).
    await expect(quoteVesuMultiplyClose(USDC, ETH, 1_000_000n)).resolves.toMatchObject({
      requiredInputAmount: 500_000_000_000_000n,
    });
    // The same route for the opposite pairing does not connect.
    await expect(quoteVesuMultiplyClose(ETH, USDC, 1_000_000n)).rejects.toThrow("does not connect");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
