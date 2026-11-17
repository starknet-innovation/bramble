/**
 * One default swap tolerance across the terminal (#153): AVNU and Ekubo apply
 * the same 50 bps when a caller passes none, and the swap ticket starts there.
 */
import { describe, expect, it, vi } from "vitest";

const avnu = vi.hoisted(() => ({ buildSlippage: [] as number[] }));

vi.mock("../avnu/avnu-swap", async (importActual) => {
  const actual = await importActual<typeof import("../avnu/avnu-swap")>();
  return {
    ...actual,
    fetchAvnuExchangeCall: async (
      _base: string,
      request: { readonly slippage: number },
    ): Promise<never> => {
      avnu.buildSlippage.push(request.slippage);
      throw new Error("stop after the build request");
    },
    fetchAvnuQuote: async (
      _base: string,
      request: { readonly buyToken: string; readonly sellToken: string },
    ) => ({
      buyAmount: "1000000",
      buyToken: request.buyToken,
      gasFeesInStrk: null,
      gasFeesInUsd: null,
      priceImpactBps: null,
      quoteId: "quote-1",
      routeLabels: [],
      sellAmount: "100",
      sellToken: request.sellToken,
    }),
  };
});

const { DEFAULT_SLIPPAGE_BPS } = await import("./slippage");
const { quoteSwap: quoteAvnuSwap } = await import("../avnu/avnu");
const { buildSwapCalls: buildEkuboSwapCalls } = await import("../ekubo/ekubo");
const { applySlippageFloor, buildPoolKey, EKUBO_FEE_TIERS } = await import("../ekubo/ekubo-swap");

const SELL = "0x1";
const BUY = "0x2";
const TAKER = "0x9";

describe("default swap slippage", () => {
  it("is 50 bps", () => {
    expect(DEFAULT_SLIPPAGE_BPS).toBe(50);
  });

  it("asks AVNU to bind 50 bps when the caller passes no tolerance", async () => {
    avnu.buildSlippage.length = 0;
    await expect(
      quoteAvnuSwap({ buyToken: BUY, sellAmount: "100", sellToken: SELL, takerAddress: TAKER }),
    ).rejects.toThrow("stop after the build request");
    expect(avnu.buildSlippage).toEqual([DEFAULT_SLIPPAGE_BPS / 10_000]);
  });

  it("floors Ekubo's minimum output at 50 bps when the caller passes no tolerance", () => {
    const tier = EKUBO_FEE_TIERS[0];
    if (!tier) throw new Error("no fee tier");
    const calls = buildEkuboSwapCalls({
      quote: {
        buyAmount: "1000000",
        buyToken: BUY,
        minBuyAmount: "0",
        protocol: "ekubo",
        route: {
          buyAmount: "1000000",
          buyToken: BUY,
          currentSqrtRatio: (1n << 96n).toString(),
          poolKey: buildPoolKey(SELL, BUY, tier),
          protocol: "ekubo",
          sellAmount: "100",
          sellIsToken0: true,
          sellToken: SELL,
          skipAhead: "0",
        },
        sellAmount: "100",
        sellToken: SELL,
      },
      takerAddress: TAKER,
    });
    const clearMinimum = calls.find((call) => call.entrypoint === "clear_minimum");
    const floor = applySlippageFloor(1_000_000n, DEFAULT_SLIPPAGE_BPS);
    expect(floor).toBe(995_000n);
    // clear_minimum(token, u256 { low, high })
    expect(clearMinimum?.calldata).toEqual(["2", floor.toString(), "0"]);
  });
});
