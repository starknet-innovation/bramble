/**
 * AVNU swap boundary checks: request shaping, strict response validation, the
 * requested-pair pin, call validation, and fail-closed behaviour for
 * unsupported networks and malformed payloads.
 */
import { describe, expect, test } from "bun:test";
import {
  AVNU_BASE_URLS,
  createSwapService,
  type SwapHttp,
  unavailableSwapService,
} from "../../src/starknet/avnu";
import { STARKNET_NETWORKS } from "../../src/starknet/networks";

const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const TAKER = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9";

const quotePayload = {
  buyAmount: "0x240157bc6ceea60000",
  buyAmountInUsd: 18.79,
  buyTokenAddress: STRK,
  gasFeesInUsd: 0.025,
  quoteId: "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca",
  sellAmount: "0x2386f26fc10000",
  sellAmountInUsd: 18.79,
  sellTokenAddress: ETH,
};

const quoteInput = {
  buyTokenAddress: STRK,
  networkId: "SN_MAIN",
  sellAmount: "0x2386f26fc10000",
  sellTokenAddress: ETH,
  takerAddress: TAKER,
} as const;

const httpReturning = (payload: unknown, ok = true): SwapHttp => {
  return (url, init) => {
    httpReturning.lastUrl = url;
    httpReturning.lastInit = init;
    return Promise.resolve({ json: () => Promise.resolve(payload), ok });
  };
};
httpReturning.lastUrl = "";
httpReturning.lastInit = undefined as Parameters<SwapHttp>[1];

describe("avnu swap service", () => {
  test("fetches, validates, and returns the best quote for the requested pair", async () => {
    const service = createSwapService({ http: httpReturning([quotePayload]) });
    const quote = await service.getQuote(quoteInput);
    expect(quote.quoteId).toBe(quotePayload.quoteId);
    expect(quote.buyAmount).toBe(quotePayload.buyAmount);
    expect(httpReturning.lastUrl).toStartWith(`${AVNU_BASE_URLS.SN_MAIN}/swap/v3/quotes?`);
    expect(httpReturning.lastUrl).toContain(`sellTokenAddress=${encodeURIComponent(ETH)}`);
    expect(httpReturning.lastUrl).toContain("size=1");
  });

  test("rejects a quote for a different pair or amount than requested", async () => {
    const swapped = { ...quotePayload, buyTokenAddress: ETH, sellTokenAddress: STRK };
    const service = createSwapService({ http: httpReturning([swapped]) });
    await expect(service.getQuote(quoteInput)).rejects.toThrow("does not match");
    const inflated = { ...quotePayload, sellAmount: "0xffffffffffffffff" };
    const inflatedService = createSwapService({ http: httpReturning([inflated]) });
    await expect(inflatedService.getQuote(quoteInput)).rejects.toThrow("does not match");
  });

  test("rejects malformed quotes, empty routes, and transport failures", async () => {
    for (const bad of [
      [{ ...quotePayload, quoteId: "" }],
      [{ ...quotePayload, buyAmount: "12.5" }],
      [{ ...quotePayload, gasFeesInUsd: Number.NaN }],
      [{ ...quotePayload, sellTokenAddress: "not-a-felt" }],
      [],
      {},
    ]) {
      const service = createSwapService({ http: httpReturning(bad) });
      await expect(service.getQuote(quoteInput)).rejects.toThrow();
    }
    const failed = createSwapService({ http: httpReturning([quotePayload], false) });
    await expect(failed.getQuote(quoteInput)).rejects.toThrow("swap quote failed");
  });

  test("swaps are unavailable on devnet — no request is made", async () => {
    let called = false;
    const service = createSwapService({
      http: () => {
        called = true;
        return Promise.resolve({ json: () => Promise.resolve([]), ok: true });
      },
    });
    await expect(service.getQuote({ ...quoteInput, networkId: "SN_DEVNET" })).rejects.toThrow(
      "not available",
    );
    expect(called).toBe(false);
  });

  test("builds calls with approve included and validates every call", async () => {
    const calls = [
      { calldata: ["0x1", "0x2"], contractAddress: ETH, entrypoint: "approve" },
      { calldata: ["0x3"], contractAddress: STRK, entrypoint: "multi_route_swap" },
    ];
    const service = createSwapService({
      http: httpReturning({ calls, chainId: STARKNET_NETWORKS.SN_MAIN.chainId }),
    });
    const built = await service.buildCalls({
      networkId: "SN_MAIN",
      quoteId: quotePayload.quoteId,
      slippage: 0.005,
      takerAddress: TAKER,
    });
    expect(built.calls).toHaveLength(2);
    expect(built.calls[0]?.entrypoint).toBe("approve");
    expect(built.chainId).toBe(STARKNET_NETWORKS.SN_MAIN.chainId);
    expect(httpReturning.lastUrl).toBe(`${AVNU_BASE_URLS.SN_MAIN}/swap/v3/build`);
    expect(httpReturning.lastInit?.method).toBe("POST");
    const body = JSON.parse(httpReturning.lastInit?.body ?? "{}") as Record<string, unknown>;
    expect(body["includeApprove"]).toBe(true);
    expect(body["slippage"]).toBe(0.005);
    expect(body["takerAddress"]).toBe(TAKER);
  });

  test("rejects malformed calls and out-of-range slippage", async () => {
    for (const bad of [
      { calls: [], chainId: STARKNET_NETWORKS.SN_MAIN.chainId },
      {
        calls: [{ calldata: ["nope"], contractAddress: ETH, entrypoint: "approve" }],
        chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
      },
      {
        calls: [{ calldata: ["0x1"], contractAddress: ETH, entrypoint: "bad name!" }],
        chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
      },
      {
        calls: [{ calldata: ["0x1"], contractAddress: "0xzz", entrypoint: "approve" }],
        chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
      },
      {
        calls: [{ calldata: ["0x1"], contractAddress: ETH, entrypoint: "approve" }],
        chainId: "0x1",
      },
    ]) {
      const service = createSwapService({ http: httpReturning(bad) });
      await expect(
        service.buildCalls({
          networkId: "SN_MAIN",
          quoteId: quotePayload.quoteId,
          slippage: 0.005,
          takerAddress: TAKER,
        }),
      ).rejects.toThrow();
    }
    const service = createSwapService({ http: httpReturning({ calls: [] }) });
    for (const slippage of [0, -0.01, 0.2, Number.NaN]) {
      await expect(
        service.buildCalls({
          networkId: "SN_MAIN",
          quoteId: quotePayload.quoteId,
          slippage,
          takerAddress: TAKER,
        }),
      ).rejects.toThrow("invalid slippage");
    }
  });

  test("lists the verified catalog, skipping malformed entries", async () => {
    const payload = {
      content: [
        { address: ETH, decimals: 18, logoUri: "https://x", name: "Ethereum", symbol: "ETH" },
        { address: "not-a-felt", decimals: 18, name: "Bad", symbol: "BAD" },
        { address: STRK, decimals: 200, name: "Bad decimals", symbol: "BAD2" },
        { address: STRK, decimals: 18, name: "Starknet Token", symbol: "STRK" },
      ],
    };
    const service = createSwapService({ http: httpReturning(payload) });
    const tokens = await service.listTokens("SN_MAIN");
    expect(tokens.map((token) => token.symbol)).toEqual(["ETH", "STRK"]);
    expect(httpReturning.lastUrl).toContain("/v1/starknet/tokens?tag=Verified");
    const failing = createSwapService({ http: httpReturning({}, false) });
    await expect(failing.listTokens("SN_MAIN")).rejects.toThrow("token list failed");
    await expect(
      createSwapService({ http: httpReturning({}) }).listTokens("SN_DEVNET"),
    ).rejects.toThrow("not available");
  });

  test("the unavailable default fails closed", async () => {
    await expect(unavailableSwapService.getQuote(quoteInput)).rejects.toThrow("unavailable");
    await expect(unavailableSwapService.listTokens("SN_MAIN")).rejects.toThrow("unavailable");
    await expect(
      unavailableSwapService.buildCalls({
        networkId: "SN_MAIN",
        quoteId: "x",
        slippage: 0.005,
        takerAddress: TAKER,
      }),
    ).rejects.toThrow("unavailable");
  });
});
