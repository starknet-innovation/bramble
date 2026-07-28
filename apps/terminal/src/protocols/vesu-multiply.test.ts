import { describe, expect, it } from "vitest";
import { MAINNET_TOKEN_ADDRESSES, VESU_ADDRESSES } from "./constants";
import {
  buildVesuMultiplyCloseCalls,
  buildVesuMultiplyIncreaseCalls,
  parseVesuMultiplyExactOutQuote,
} from "./vesu-multiply";

const POOL = "0x451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5";

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
    );
    expect(quote.maxInputAmount).toBe(505_000_000_000_000n);
    expect(quote.priceImpactPct).toBe(-0.4);
    expect(() =>
      parseVesuMultiplyExactOutQuote(
        { ...response, total_calculated: "-500000000000000" },
        2_000_000n,
        100,
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
});
