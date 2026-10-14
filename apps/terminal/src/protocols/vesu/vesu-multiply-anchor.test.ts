import { afterEach, describe, expect, it, vi } from "vitest";
import { MAINNET_TOKEN_ADDRESSES } from "../constants";
import { quoteVesuMultiplyClose, quoteVesuMultiplyIncrease } from "./vesu-multiply";
import {
  recheckVesuMultiplyQuote,
  VESU_MULTIPLY_MAX_PREMIUM_BPS,
  VesuMultiplyAnchorError,
} from "./vesu-multiply-anchor";

const { ETH, USDC } = MAINNET_TOKEN_ADDRESSES;

// An exact 1 USDC output priced in ETH by a one-pool route. At $2,000 per ETH
// the mid-price input is 0.0005 ETH; the cap may carry 10% plus the 1% slippage.
const MID_INPUT = 500_000_000_000_000n;
const quoterAnswer = (input: bigint) => ({
  price_impact: -0.004,
  splits: [{
    amount_calculated: `-${input}`,
    amount_specified: "-1000000",
    route: [{
      pool_key: {
        extension: "0x0",
        fee: "34028236692093847977029636859101184",
        tick_spacing: 200,
        token0: ETH,
        token1: USDC,
      },
      skip_ahead: 0,
      sqrt_ratio_limit: "0x2e76c7e22493026ef9d607c29a968",
    }],
  }],
  total_calculated: `-${input}`,
});

const quoterReturns = (input: bigint): void => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(quoterAnswer(input)))));
};

const prices = (eth: number | null, usdc: number | null = 1) => async (asset: string) =>
  asset === ETH ? eth : usdc;

const increase = (priceUsd: (asset: string) => Promise<number | null>) =>
  quoteVesuMultiplyIncrease(USDC, ETH, 1_000_000n, {
    collateralDecimals: 6,
    debtDecimals: 18,
    priceUsd,
  });

// The largest reported input whose 1% slippage cap stays within 10% + 1% of
// the mid-price input: required × 1.01 ≤ mid × 1.11.
const LARGEST_ALLOWED_INPUT =
  (MID_INPUT * BigInt(10_000 + VESU_MULTIPLY_MAX_PREMIUM_BPS + 100)) / 10_100n;

const refusalCode = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => "resolved",
    (cause: unknown) => (cause instanceof VesuMultiplyAnchorError ? cause.code : cause),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Vesu Multiply swap cap anchor (#646)", () => {
  it("passes a quote within the premium over the reference mid-price", async () => {
    quoterReturns(MID_INPUT);
    await expect(increase(prices(2_000))).resolves.toMatchObject({
      maxInputAmount: 505_000_000_000_000n,
    });
    quoterReturns(LARGEST_ALLOWED_INPUT);
    await expect(increase(prices(2_000))).resolves.toMatchObject({
      requiredInputAmount: LARGEST_ALLOWED_INPUT,
    });
  });

  it("refuses a quoter that inflates the input past the premium", async () => {
    quoterReturns(LARGEST_ALLOWED_INPUT + 1_000_000_000n);
    await expect(increase(prices(2_000))).rejects.toThrow("The swap price is too far from the market price. Try again later.");
    // Twice the fair input is refused in the close direction too.
    quoterReturns(MID_INPUT * 2n);
    await expect(
      quoteVesuMultiplyClose(USDC, ETH, 1_000_000n, {
        collateralDecimals: 18,
        debtDecimals: 6,
        priceUsd: prices(2_000),
      }),
    ).rejects.toThrow("The swap price is too far from the market price. Try again later.");
  });

  it("refuses the route when no independent price is available", async () => {
    quoterReturns(MID_INPUT);
    for (const priceUsd of [
      prices(null),
      prices(2_000, null),
      prices(0),
      prices(Number.NaN),
      prices(Number.POSITIVE_INFINITY),
      prices(-2_000),
      async () => {
        throw new Error("feed down");
      },
    ]) {
      await expect(increase(priceUsd)).rejects.toThrow("Couldn't get a market price for this swap, so it can't be checked. Try again, or choose another market.");
    }
    await expect(
      quoteVesuMultiplyClose(USDC, ETH, 1_000_000n, {
        collateralDecimals: 18,
        debtDecimals: 6,
        priceUsd: prices(null),
      }),
    ).rejects.toThrow("Couldn't get a market price for this swap, so it can't be checked. Try again, or choose another market.");
    await expect(
      quoteVesuMultiplyIncrease(USDC, ETH, 1_000_000n, {
        collateralDecimals: 6.5,
        debtDecimals: 18,
        priceUsd: prices(2_000),
      }),
    ).rejects.toThrow("Couldn't get a market price for this swap, so it can't be checked. Try again, or choose another market.");
  });

  it("re-checks the quoted cap against a fresh price at handoff", async () => {
    quoterReturns(MID_INPUT);
    const quote = await increase(prices(2_000));
    await expect(recheckVesuMultiplyQuote(quote, prices(2_000))).resolves.toBeUndefined();
    // ETH rose 20%: the output now needs less ETH, so the same cap is too high.
    await expect(recheckVesuMultiplyQuote(quote, prices(2_400))).rejects.toThrow(
      "The swap price is too far from the market price. Try again later.",
    );
    await expect(recheckVesuMultiplyQuote(quote, prices(null))).rejects.toThrow(
      "Couldn't get a market price for this swap, so it can't be checked. Try again, or choose another market.",
    );
  });

  it("shows each refusal as its reviewed sentence, exactly", async () => {
    quoterReturns(MID_INPUT);
    const quote = await increase(prices(2_000));
    const message = (work: Promise<unknown>) =>
      work.then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : null),
      );
    await expect(message(recheckVesuMultiplyQuote(quote, prices(2_400)))).resolves.toBe(
      "The swap price is too far from the market price. Try again later.",
    );
    await expect(message(recheckVesuMultiplyQuote(quote, prices(null)))).resolves.toBe(
      "Couldn't get a market price for this swap, so it can't be checked. Try again, or choose another market.",
    );
  });

  it("names each refusal with a stable code for copy mapping", async () => {
    quoterReturns(MID_INPUT);
    const quote = await increase(prices(2_000));
    await expect(refusalCode(recheckVesuMultiplyQuote(quote, prices(2_400)))).resolves.toBe(
      "price_premium_exceeded",
    );
    await expect(refusalCode(recheckVesuMultiplyQuote(quote, prices(null)))).resolves.toBe(
      "price_unavailable",
    );
    const badDecimals = {
      ...quote,
      anchor: { ...quote.anchor, calculated: { ...quote.anchor.calculated, decimals: -1 } },
    };
    await expect(refusalCode(recheckVesuMultiplyQuote(badDecimals, prices(2_000)))).resolves.toBe(
      "price_unavailable",
    );
    // A quoter outage is the quote path's own refusal, not an anchor refusal.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(refusalCode(increase(prices(2_000)))).resolves.not.toBe("price_unavailable");
  });
});
