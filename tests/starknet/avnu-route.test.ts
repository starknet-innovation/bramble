/**
 * EXT-M-01: the AVNU route decoder is a PIN, and these tests are what make a
 * change to it a reviewed change rather than a silent one.
 *
 * The wallet reads `multi_route_swap` calldata positionally, so the offsets
 * below are a trust anchor exactly like the router address: read them wrong and
 * the build policy binds the wrong felts while still reporting success. The
 * layout restated here is AVNU's `avnu-contracts-v2` at the commit this wallet
 * reviewed, 006e3ddd9ddae28be73336842684f7db55273a2f —
 *   sell_token, sell_amount:u256, buy_token, buy_amount:u256,
 *   buy_min_amount:u256, beneficiary, integrator_fee_bps:u128,
 *   integrator_fee_recipient, routes:Array<Route>
 * — and the suite additionally pins the failure DIRECTION: anything the decoder
 * cannot consume exactly comes back as null, so the caller fails closed instead
 * of reviewing a route it half-read.
 */
import { describe, expect, test } from "bun:test";
import {
  AVNU_MAX_INTEGRATOR_FEE_BPS,
  AVNU_MULTI_ROUTE_SWAP,
  avnuRouteIntentError,
  decodeAvnuRoute,
  reviewedMinBuyAmount,
} from "@mc-wallet/transactions/avnu-route";
import { avnuDirectRoute, avnuRouteCalldata } from "../support/avnu-route-fixture";

const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const TAKER = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const ATTACKER = "0x6666666666666666666666666666666666666666666666666666666666666";

const SELL_AMOUNT = 10n ** 16n;
const BUY_AMOUNT = 125n * 10n ** 17n;
const MIN_BUY_AMOUNT = 124_375n * 10n ** 14n;

const honestCalldata = (): string[] =>
  avnuRouteCalldata({
    beneficiary: TAKER,
    buyAmount: BUY_AMOUNT,
    buyToken: STRK,
    minBuyAmount: MIN_BUY_AMOUNT,
    sellAmount: SELL_AMOUNT,
    sellToken: ETH,
  });

const intent = {
  beneficiary: TAKER,
  buyToken: STRK,
  minBuyAmount: MIN_BUY_AMOUNT,
  sellAmount: SELL_AMOUNT,
  sellToken: ETH,
};

describe("decodeAvnuRoute reads the pinned exchange layout", () => {
  test("every reviewed field comes back from its pinned offset", () => {
    const route = decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, honestCalldata());
    expect(route).toEqual({
      beneficiary: `0x${BigInt(TAKER).toString(16)}`,
      buyAmount: BUY_AMOUNT,
      buyToken: `0x${BigInt(STRK).toString(16)}`,
      integratorFeeBps: 0n,
      integratorFeeRecipient: "0x0",
      minBuyAmount: MIN_BUY_AMOUNT,
      sellAmount: SELL_AMOUNT,
      sellToken: `0x${BigInt(ETH).toString(16)}`,
    });
  });

  // The offsets restated as literals: a shift of the header by even one felt
  // has to fail HERE, not silently rebind the policy to the wrong fields.
  test("the header offsets are the ones the reviewed ABI declares", () => {
    const calldata = honestCalldata();
    expect(calldata.slice(0, 12)).toEqual([
      ETH,
      `0x${SELL_AMOUNT.toString(16)}`,
      "0x0",
      STRK,
      `0x${BUY_AMOUNT.toString(16)}`,
      "0x0",
      `0x${MIN_BUY_AMOUNT.toString(16)}`,
      "0x0",
      TAKER,
      "0x0",
      "0x0",
      "0x1",
    ]);
  });

  test("only the pinned selector decodes", () => {
    expect(decodeAvnuRoute("swap_exact_token_to", honestCalldata())).toBeNull();
    expect(decodeAvnuRoute("multi_route_swap ", honestCalldata())).toBeNull();
    expect(decodeAvnuRoute("transfer", honestCalldata())).toBeNull();
  });

  test("a uint256 limb pair is joined, never read as its low half", () => {
    const calldata = honestCalldata();
    calldata[2] = "0x1";
    expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, calldata)?.sellAmount).toBe(
      SELL_AMOUNT + (1n << 128n),
    );
  });

  test("a limb wider than u128, a malformed felt, and an empty slot all fail closed", () => {
    for (const [index, value] of [
      [1, `0x${(1n << 128n).toString(16)}`],
      [2, "not-a-felt"],
      [6, ""],
      [8, ""],
      [9, "0xzz"],
    ] as const) {
      const calldata = honestCalldata();
      calldata[index] = value;
      expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, calldata)).toBeNull();
    }
  });

  test("calldata that is not consumed exactly is refused", () => {
    const honest = honestCalldata();
    // Empty, header-only, one felt short of the beneficiary, one trailing felt,
    // a routes length that overstates the span, and one that understates it.
    expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, [])).toBeNull();
    expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, honest.slice(0, 12))).toBeNull();
    expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, honest.slice(0, 8))).toBeNull();
    expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, [...honest, "0x1"])).toBeNull();
    const overstated = honestCalldata();
    overstated[11] = "0x2";
    expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, overstated)).toBeNull();
    const understated = honestCalldata();
    understated[11] = "0x0";
    expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, understated)).toBeNull();
  });

  test("a params length that runs past the call cannot be accepted", () => {
    const calldata = honestCalldata();
    // The Direct leg's `additional_swap_params` length, inflated so the span
    // would read past the end of the call.
    calldata[16] = "0xff";
    expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, calldata)).toBeNull();
  });

  // The Branch variant is a real encoding AVNU emits, marked by the Cairo short
  // string "branch". A decoder that only knew Direct legs would mis-measure the
  // span and refuse honest builds.
  test("a Branch route leg is walked, not mistaken for a Direct one", () => {
    const direct = avnuDirectRoute({ buyToken: STRK, sellToken: ETH });
    const branch = [
      ETH,
      STRK,
      `0x${0x6272616e6368n.toString(16)}`,
      ...direct.slice(2),
      "0x1",
      ...avnuDirectRoute({ buyToken: STRK, sellToken: ETH, params: ["0x7"] }).slice(2),
    ];
    const calldata = avnuRouteCalldata({
      beneficiary: TAKER,
      buyAmount: BUY_AMOUNT,
      buyToken: STRK,
      minBuyAmount: MIN_BUY_AMOUNT,
      routes: [branch],
      sellAmount: SELL_AMOUNT,
      sellToken: ETH,
    });
    expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, calldata)?.minBuyAmount).toBe(MIN_BUY_AMOUNT);
    expect(decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, calldata.slice(0, -1))).toBeNull();
  });
});

describe("avnuRouteIntentError binds a decoded route to the reviewed swap", () => {
  const decoded = () => {
    const route = decodeAvnuRoute(AVNU_MULTI_ROUTE_SWAP, honestCalldata());
    if (!route) {
      throw new Error("the honest fixture must decode");
    }
    return route;
  };

  test("the honest route matches its intent", () => {
    expect(avnuRouteIntentError(decoded(), intent)).toBeNull();
  });

  test("each field is reported on its own, so a refusal is diagnosable", () => {
    expect(avnuRouteIntentError(decoded(), { ...intent, sellToken: STRK })).toBe(
      "swap build routed a token you are not selling",
    );
    expect(avnuRouteIntentError(decoded(), { ...intent, sellAmount: SELL_AMOUNT + 1n })).toBe(
      "swap build routed an amount you did not review",
    );
    expect(avnuRouteIntentError(decoded(), { ...intent, buyToken: ETH })).toBe(
      "swap build bought a token you did not choose",
    );
    expect(avnuRouteIntentError(decoded(), { ...intent, beneficiary: ATTACKER })).toBe(
      "swap build routed the proceeds to another account",
    );
    expect(avnuRouteIntentError(decoded(), { ...intent, minBuyAmount: MIN_BUY_AMOUNT + 1n })).toBe(
      "swap build accepted less than the minimum you reviewed",
    );
  });

  // A minimum ABOVE the reviewed floor is a better deal, not a mismatch.
  test("a route promising more than the floor is admitted", () => {
    const generous = decodeAvnuRoute(
      AVNU_MULTI_ROUTE_SWAP,
      avnuRouteCalldata({
        beneficiary: TAKER,
        buyAmount: BUY_AMOUNT,
        buyToken: STRK,
        minBuyAmount: BUY_AMOUNT,
        sellAmount: SELL_AMOUNT,
        sellToken: ETH,
      }),
    );
    expect(generous && avnuRouteIntentError(generous, intent)).toBeNull();
  });

  test("the integrator fee is capped at the pinned bps ceiling", () => {
    const withFee = (bps: bigint) => {
      const route = decodeAvnuRoute(
        AVNU_MULTI_ROUTE_SWAP,
        avnuRouteCalldata({
          beneficiary: TAKER,
          buyAmount: BUY_AMOUNT,
          buyToken: STRK,
          integratorFeeBps: bps,
          integratorFeeRecipient: ATTACKER,
          minBuyAmount: MIN_BUY_AMOUNT,
          sellAmount: SELL_AMOUNT,
          sellToken: ETH,
        }),
      );
      if (!route) {
        throw new Error("the fee fixture must decode");
      }
      return avnuRouteIntentError(route, intent);
    };
    expect(AVNU_MAX_INTEGRATOR_FEE_BPS).toBe(100n);
    expect(withFee(AVNU_MAX_INTEGRATOR_FEE_BPS)).toBeNull();
    expect(withFee(AVNU_MAX_INTEGRATOR_FEE_BPS + 1n)).toBe(
      "swap build charged an aggregator fee beyond the wallet's cap",
    );
    expect(withFee(10_000n)).toBe("swap build charged an aggregator fee beyond the wallet's cap");
  });
});

describe("reviewedMinBuyAmount states the floor in integer base units", () => {
  test("the reviewed 0.5% slippage yields the quote less 51 bps", () => {
    // 50 bps of reviewed slippage plus one basis point of headroom, because the
    // aggregator computes its own minimum in floating point over an 18-decimal
    // quantity — the floor must refuse a hostile minimum, not a rounding one.
    expect(reviewedMinBuyAmount(BUY_AMOUNT, 0.005)).toBe((BUY_AMOUNT * 9949n) / 10_000n);
    expect(reviewedMinBuyAmount(BUY_AMOUNT, 0.005)).toBeLessThan(MIN_BUY_AMOUNT);
  });

  test("a fractional basis point rounds toward more slippage, never less", () => {
    // Rounding the other way would reject an honest build whose minimum sits
    // just under a whole basis point.
    expect(reviewedMinBuyAmount(BUY_AMOUNT, 0.00501)).toBe((BUY_AMOUNT * 9948n) / 10_000n);
  });

  test("a floor it cannot state comes back as null", () => {
    expect(reviewedMinBuyAmount(0n, 0.005)).toBeNull();
    expect(reviewedMinBuyAmount(BUY_AMOUNT, 0)).toBeNull();
    expect(reviewedMinBuyAmount(BUY_AMOUNT, -0.01)).toBeNull();
    expect(reviewedMinBuyAmount(BUY_AMOUNT, Number.NaN)).toBeNull();
    expect(reviewedMinBuyAmount(BUY_AMOUNT, 1)).toBeNull();
  });
});
