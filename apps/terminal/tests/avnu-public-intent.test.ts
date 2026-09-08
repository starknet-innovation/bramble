/** Public AVNU reviews bind untrusted quotes and built calldata to one exact trade. */
import { avnuRouteCalldata, type AvnuRouteFixture } from "@bramble/testkit/avnu-route";
import { AVNU_MAX_CALLDATA_LENGTH } from "@bramble/wallet-model/avnu-route";
import { STARKNET_NETWORKS, UINT128_LIMIT } from "@bramble/wallet-model/networks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSwapCalls, quoteSwap } from "../src/protocols/avnu/avnu";
import type { AvnuExchangeCall, AvnuRoute } from "../src/protocols/avnu/avnu-swap";
import { AVNU_ADDRESSES } from "../src/protocols/constants";

const params = {
  buyToken: "0x2",
  sellAmount: "1000",
  sellToken: "0x1",
  takerAddress: "0x3",
  slippageBps: 100,
};
const intent: AvnuRouteFixture = {
  beneficiary: params.takerAddress,
  buyAmount: 900n,
  buyToken: params.buyToken,
  minBuyAmount: 891n,
  sellAmount: 1000n,
  sellToken: params.sellToken,
};
const apiQuote = {
  buyAmount: "900",
  buyTokenAddress: params.buyToken,
  quoteId: "quote-1",
  sellAmount: params.sellAmount,
  sellTokenAddress: params.sellToken,
};
const callFor = (overrides: Partial<AvnuRouteFixture> = {}): AvnuExchangeCall => ({
  calldata: avnuRouteCalldata({ ...intent, ...overrides }),
  contractAddress: AVNU_ADDRESSES.exchange,
  entrypoint: "multi_route_swap",
});
const mockApi = (
  call = callFor(),
  quote: unknown = apiQuote,
  chainId = STARKNET_NETWORKS.SN_MAIN.chainId,
) => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => [quote] })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ calls: [call], chainId }) });
  vi.stubGlobal("fetch", fetch);
  return fetch;
};
afterEach(() => vi.unstubAllGlobals());

describe("AVNU public swap intent", () => {
  it("reviews the actual enforced minimum and approves only the requested input", async () => {
    mockApi(callFor({ minBuyAmount: 895n }));
    const quote = await quoteSwap(params);
    expect(quote.minBuyAmount).toBe("895");
    const calls = buildSwapCalls({ quote, takerAddress: params.takerAddress });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ contractAddress: params.sellToken, entrypoint: "approve" });
    expect(calls[0]?.calldata?.map(String).slice(1)).toEqual(["1000", "0"]);
    expect(calls[1]?.calldata).toEqual(avnuRouteCalldata({ ...intent, minBuyAmount: 895n }));
  });

  it.each([
    ["sell token", { sellToken: "0x9" }],
    ["buy token", { buyToken: "0x9" }],
    ["sell amount", { sellAmount: 1001n }],
    ["expected output", { buyAmount: 899n }],
    ["beneficiary", { beneficiary: "0xdead" }],
    ["zero beneficiary", { beneficiary: "0x0" }],
    ["minimum output", { minBuyAmount: 889n }],
    ["zero minimum", { minBuyAmount: 0n }],
    ["unrequested fee", { integratorFeeBps: 1n }],
    ["impossible minimum", { minBuyAmount: 901n }],
  ] satisfies [string, Partial<AvnuRouteFixture>][])(
    "rejects a changed %s before review",
    async (_name, overrides) => {
      mockApi(callFor(overrides));
      await expect(quoteSwap(params)).rejects.toThrow();
    },
  );

  it("tolerates AVNU's reviewed rounding allowance", async () => {
    mockApi(callFor({ minBuyAmount: 890n }));
    await expect(quoteSwap(params)).resolves.toMatchObject({ minBuyAmount: "890" });
  });

  it.each([
    { sellTokenAddress: "0x9" },
    { buyTokenAddress: "0x9" },
    { sellAmount: "1001" },
    { sellAmount: "0" },
    { buyAmount: "0" },
    { buyAmount: `0x${"f".repeat(65)}` },
  ])("rejects a mismatched or invalid quote: %j", async (overrides) => {
    const fetch = mockApi(callFor(), { ...apiQuote, ...overrides });
    await expect(quoteSwap(params)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 0.5, 10_000, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects slippage %s before fetching",
    async (slippageBps) => {
      const fetch = mockApi();
      await expect(quoteSwap({ ...params, slippageBps })).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["", "-1", "1.1", "0", (UINT128_LIMIT * UINT128_LIMIT).toString()])(
    "rejects input amount %s before fetching",
    async (sellAmount) => {
      const fetch = mockApi();
      await expect(quoteSwap({ ...params, sellAmount })).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["truncated", () => ["0x1"]],
    ["trailing", () => [...callFor().calldata, "0x0"]],
    ["oversized", () => Array<string>(AVNU_MAX_CALLDATA_LENGTH + 1).fill("0x0")],
    ["invalid route felt", () => [...callFor().calldata.slice(0, -1), "not-a-felt"]],
    ["negative route felt", () => [...callFor().calldata.slice(0, -1), "-1"]],
    ["over-wide route felt", () => [...callFor().calldata.slice(0, -1), `0x${"f".repeat(64)}`]],
    [
      "invalid uint256 limb",
      () => {
        const data = [...callFor().calldata];
        data[1] = `0x${UINT128_LIMIT.toString(16)}`;
        return data;
      },
    ],
  ] satisfies [string, () => string[]][])("rejects %s calldata", async (_name, calldata) => {
    mockApi({ ...callFor(), calldata: calldata() });
    await expect(quoteSwap(params)).rejects.toThrow();
  });

  it("rejects a build for another chain", async () => {
    mockApi(callFor(), apiQuote, STARKNET_NETWORKS.SN_SEPOLIA.chainId);
    await expect(quoteSwap(params)).rejects.toThrow();
  });

  it("accepts equivalent padded addresses and zero slippage", async () => {
    mockApi(callFor({ beneficiary: "0x0003", minBuyAmount: 900n, sellToken: "0x0001" }));
    const quote = await quoteSwap({ ...params, slippageBps: 0 });
    expect(buildSwapCalls({ quote, takerAddress: "0x0003" })).toHaveLength(2);
  });

  it("requires the quoted output when slippage is zero", async () => {
    mockApi(callFor({ minBuyAmount: 899n }));
    await expect(quoteSwap({ ...params, slippageBps: 0 })).rejects.toThrow();
  });

  it("binds submission to the current taker and the displayed minimum", async () => {
    mockApi();
    const quote = await quoteSwap(params);
    expect(() => buildSwapCalls({ quote, takerAddress: "0xdead" })).toThrow();
    expect(() =>
      buildSwapCalls({
        quote: { ...quote, minBuyAmount: "892" },
        takerAddress: params.takerAddress,
      }),
    ).toThrow();
  });

  it.each([
    { ...callFor(), contractAddress: "0x9" },
    { ...callFor(), entrypoint: "transfer" },
    callFor({ beneficiary: "0xdead" }),
    callFor({ minBuyAmount: 0n }),
    callFor({ sellAmount: 1001n }),
    callFor({ buyToken: "0x9" }),
    callFor({ integratorFeeBps: 1n }),
    { ...callFor(), calldata: ["0x1"] },
  ])("revalidates changed cached calldata at submission", async (exchangeCall) => {
    mockApi();
    const quote = await quoteSwap(params);
    const route = quote.route as AvnuRoute;
    expect(() =>
      buildSwapCalls({
        quote: { ...quote, route: { ...route, exchangeCall } },
        takerAddress: params.takerAddress,
      }),
    ).toThrow();
  });

  it("derives approval from reviewed values even if opaque route metadata changes", async () => {
    mockApi();
    const quote = await quoteSwap(params);
    const calls = buildSwapCalls({
      quote: {
        ...quote,
        route: { ...(quote.route as AvnuRoute), sellAmount: "999999", sellToken: "0x9" },
      },
      takerAddress: params.takerAddress,
    });
    expect(calls[0]?.contractAddress).toBe(params.sellToken);
    expect(calls[0]?.calldata?.map(String).slice(1)).toEqual(["1000", "0"]);
  });
});
