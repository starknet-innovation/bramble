/**
 * EXT-M-01: the route call's CALLDATA is part of the reviewed intent.
 *
 * Pinning the counterparty and the selector (../background/swap-build-policy.test.ts)
 * left the aggregator writing the two fields that decide where the money goes:
 * the `beneficiary` the exchange transfers the bought token to, and the
 * `buy_token_min_amount` it asserts against. Nothing read them, so a build that
 * moved the beneficiary to an attacker and dropped the minimum to zero prepared
 * and executed with summaries and flags byte-identical to the honest build —
 * while the confirm card stated a "Minimum received" the transaction did not
 * carry.
 *
 * Every case here holds the reviewed swap constant and changes exactly ONE
 * field of the route, so the rejection proves that field alone is load-bearing;
 * the suite ends by executing the honest build end to end, so "bound" cannot
 * quietly become "refuses everything".
 */
import { describe, expect, test } from "bun:test";
import { avnuDirectRoute, avnuRouteCalldata } from "../support/avnu-route-fixture";
import {
  ATTACKER_ADDRESS,
  account,
  approveRouter,
  BUY_AMOUNT,
  buyTokenId,
  ETH_TOKEN_ADDRESS,
  extensionSender,
  MIN_BUY_AMOUNT,
  makeSwapHarness,
  prepareSwap,
  QUOTE_ID,
  routeCall,
  routeWith,
  SELL_AMOUNT,
  STRK_TOKEN_ADDRESS,
  sellTokenId,
} from "../support/swap-policy-harness";

describe("the AVNU route calldata is bound to the reviewed swap", () => {
  // Once every field of the route is bound, a second swap call can only be a
  // second demand on the one allowance the user reviewed. There is no honest
  // receipt for that, so it is a rejection rather than a flag.
  test("a second swap call is rejected rather than flagged", async () => {
    const { response, submitted } = prepareSwap([approveRouter, routeCall, routeCall]);
    await expect(response).resolves.toEqual({
      error: "swap build returned more than one swap call",
    });
    expect(submitted).toHaveLength(0);
  });

  // The exact-out entry point is no longer admitted: the wallet only ever asks
  // for exact-in quotes, and that selector carries a different positional
  // layout, so admitting it would mean a decoder for a shape nothing requests.
  test("the exact-out entry point is no longer an admitted swap selector", async () => {
    const { response, submitted } = prepareSwap([
      approveRouter,
      { ...routeCall, entrypoint: "swap_exact_token_to" },
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build called an entrypoint that is not an AVNU swap",
    });
    expect(submitted).toHaveLength(0);
  });

  // THE HEADLINE CASE. Everything else about this build is honest — the pinned
  // router, the pinned selector, the reviewed pair, the reviewed sell amount,
  // the reviewed minimum, the exact approval — and only the account the
  // proceeds land in has moved. Before the route was decoded this executed and
  // produced summaries and flags byte-identical to the honest build.
  test("a route paying another account is rejected unsigned", async () => {
    const { response, submitted } = prepareSwap([
      approveRouter,
      routeWith({ beneficiary: ATTACKER_ADDRESS }),
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build routed the proceeds to another account",
    });
    expect(submitted).toHaveLength(0);
  });

  test("a route that drops the minimum output is rejected unsigned", async () => {
    const { response, submitted } = prepareSwap([approveRouter, routeWith({ minBuyAmount: 0n })]);
    await expect(response).resolves.toEqual({
      error: "swap build accepted less than the minimum you reviewed",
    });
    expect(submitted).toHaveLength(0);
  });

  // The boundary itself, because an off-by-one here is the likeliest way a
  // later edit quietly reopens the minimum: the wallet's floor is the quoted
  // buy amount less the reviewed slippage (plus one basis point of headroom,
  // since the aggregator computes its own minimum in floating point). Exactly
  // at the floor is accepted; one base unit below it is not.
  test("the minimum-output floor is exact to one base unit", async () => {
    const floor = (BUY_AMOUNT * 9949n) / 10_000n;
    const atFloor = await prepareSwap([approveRouter, routeWith({ minBuyAmount: floor })]).response;
    expect(atFloor).toMatchObject({ ok: true });

    const below = prepareSwap([approveRouter, routeWith({ minBuyAmount: floor - 1n })]);
    await expect(below.response).resolves.toEqual({
      error: "swap build accepted less than the minimum you reviewed",
    });
    expect(below.submitted).toHaveLength(0);
  });

  test("a route buying a token the user did not choose is rejected unsigned", async () => {
    const { response, submitted } = prepareSwap([
      approveRouter,
      routeWith({ buyToken: ATTACKER_ADDRESS }),
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build bought a token you did not choose",
    });
    expect(submitted).toHaveLength(0);
  });

  // The approval covers 0.01 ETH, but the route names STRK and a far larger
  // amount: without a bound sell side, the route reaches every standing
  // allowance this account holds toward the router, not just today's.
  test("a route selling a different token is rejected unsigned", async () => {
    const { response, submitted } = prepareSwap([
      approveRouter,
      routeWith({ sellAmount: 10n ** 24n, sellToken: STRK_TOKEN_ADDRESS }),
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build routed a token you are not selling",
    });
    expect(submitted).toHaveLength(0);
  });

  test("a route selling more than the reviewed amount is rejected unsigned", async () => {
    const { response, submitted } = prepareSwap([
      approveRouter,
      routeWith({ sellAmount: SELL_AMOUNT + 1n }),
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build routed an amount you did not review",
    });
    expect(submitted).toHaveLength(0);
  });

  // MCW-V09-130 again, one layer down: the route's uint256 fields are read
  // through the one shared limb join, so a `(0, huge)` spelling of the sell
  // amount is the value it really is — not a zero that the equality then waves
  // through — and a limb that is not a felt fails closed instead of throwing a
  // BigInt SyntaxError out of the handler.
  test("uint256 limbs in the route are joined, not read as their low half", async () => {
    const highLimb = prepareSwap([approveRouter, routeWith({ sellAmount: 1n << 128n })]);
    await expect(highLimb.response).resolves.toEqual({
      error: "swap build routed an amount you did not review",
    });

    const honest = avnuRouteCalldata({
      beneficiary: account.address,
      buyAmount: BUY_AMOUNT,
      buyToken: STRK_TOKEN_ADDRESS,
      minBuyAmount: MIN_BUY_AMOUNT,
      sellAmount: SELL_AMOUNT,
      sellToken: ETH_TOKEN_ADDRESS,
    });
    for (const index of [1, 2, 6, 7]) {
      const calldata = [...honest];
      calldata[index] = "not-a-felt";
      const { response, submitted } = prepareSwap([approveRouter, { ...routeCall, calldata }]);
      await expect(response).resolves.toEqual({
        error: "swap build returned a route the wallet could not decode",
      });
      expect(submitted).toHaveLength(0);
    }
  });

  test("a route whose fee would take the trade is rejected on the pinned bps cap", async () => {
    const { response, submitted } = prepareSwap([
      approveRouter,
      routeWith({ integratorFeeBps: 10_000n, integratorFeeRecipient: ATTACKER_ADDRESS }),
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build charged an aggregator fee beyond the wallet's cap",
    });
    expect(submitted).toHaveLength(0);
  });

  // Undecodable calldata must become this one rejection — never a partially
  // read route, never a thrown index or BigInt error escaping the handler.
  test("calldata the wallet cannot read exactly is refused, not guessed at", async () => {
    const honest = routeCall.calldata;
    const truncated = honest.slice(0, 8);
    const trailing = [...honest, "0x1"];
    const shortSpan = avnuRouteCalldata({
      beneficiary: account.address,
      buyAmount: BUY_AMOUNT,
      buyToken: STRK_TOKEN_ADDRESS,
      minBuyAmount: MIN_BUY_AMOUNT,
      routes: [
        avnuDirectRoute({ buyToken: STRK_TOKEN_ADDRESS, sellToken: ETH_TOKEN_ADDRESS }),
        avnuDirectRoute({ buyToken: STRK_TOKEN_ADDRESS, sellToken: ETH_TOKEN_ADDRESS }),
      ],
      sellAmount: SELL_AMOUNT,
      sellToken: ETH_TOKEN_ADDRESS,
    }).slice(0, -3);
    for (const calldata of [[], truncated, trailing, shortSpan]) {
      const { response, submitted } = prepareSwap([approveRouter, { ...routeCall, calldata }]);
      await expect(response).resolves.toEqual({
        error: "swap build returned a route the wallet could not decode",
      });
      expect(submitted).toHaveLength(0);
    }
  });

  // Disclosure, not only refusal: the reviewed line names the minimum and the
  // account being paid, so two builds that differ in those fields can no
  // longer read identically. Before the decode both produced the same
  // "Call multi_route_swap on 0x4270…3b0f".
  test("the frozen route is summarised by what it pays, and to whom", async () => {
    const prepared = await prepareSwap([approveRouter, routeCall]).response;
    const summaries = "swapPreparation" in prepared ? prepared.swapPreparation.summaries : [];
    expect(summaries).toContain(`Swap 0.01 ETH for at least 12.4375 STRK, paid to 0x1234…bcde`);
    expect(summaries.join(" ")).not.toContain("Call multi_route_swap");
    expect("swapPreparation" in prepared ? prepared.swapPreparation.minBuyAmount : "").toBe(
      "12.4375",
    );
  });

  // The whole build executes end to end, so the binding above cannot be
  // "correct" by refusing every swap.
  test("the honest build still prepares AND executes", async () => {
    const { handler, submitted } = makeSwapHarness([approveRouter, routeCall]);
    const prepared = await handler(
      {
        amount: "0.01",
        buyAmount: "12.5",
        buyTokenId,
        quoteId: QUOTE_ID,
        sellTokenId,
        type: "wallet.swapPrepare",
      },
      extensionSender,
    );
    const preparationId = "swapPreparation" in prepared ? prepared.swapPreparation.id : "";
    await expect(
      handler({ preparationId, type: "wallet.swapExecute" }, extensionSender),
    ).resolves.toEqual({ ok: true, transactionHash: "0x5aa9" });
    expect(submitted).toHaveLength(1);
  });
});
