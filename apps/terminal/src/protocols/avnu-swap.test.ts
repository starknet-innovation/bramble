import { describe, expect, it } from "vitest";
import { AVNU_ADDRESSES } from "./constants";
import {
  AVNU_BUILD_PATH,
  AVNU_QUOTES_PATH,
  buildQuotesUrl,
  parseBuildResponse,
  parseQuoteResponse,
} from "./avnu-swap";

describe("AVNU v3 swap boundary", () => {
  it("builds the current v3 quote endpoint with a hex sell amount", () => {
    const url = new URL(
      buildQuotesUrl("https://starknet.api.avnu.fi/", {
        buyToken: "0x2",
        sellAmount: "1000",
        sellToken: "0x1",
        takerAddress: "0x3",
      }),
    );
    expect(AVNU_QUOTES_PATH).toBe("swap/v3/quotes");
    expect(AVNU_BUILD_PATH).toBe("swap/v3/build");
    expect(url.pathname).toBe("/swap/v3/quotes");
    expect(url.searchParams.get("sellAmount")).toBe("0x3e8");
  });

  it("accepts one verified exchange call from the v3 calls envelope", () => {
    expect(
      parseBuildResponse({
        chainId: "0x534e5f4d41494e",
        calls: [
          {
            calldata: ["0x1", "0x2"],
            contractAddress: AVNU_ADDRESSES.exchange,
            entrypoint: "multi_route_swap",
          },
        ],
      }),
    ).toEqual({
      calldata: ["0x1", "0x2"],
      contractAddress: AVNU_ADDRESSES.exchange,
      entrypoint: "multi_route_swap",
    });
  });

  it("keeps AVNU fee, impact, and liquidity-source details for review", () => {
    expect(
      parseQuoteResponse([
        {
          buyAmount: "990",
          gasFeesInUsd: 0.08,
          priceImpact: 12,
          quoteId: "quote-1",
          routes: [{ name: "Ekubo", percent: 70 }, { name: "Hashstack", percent: 30 }],
          sellAmount: "1000",
        },
      ]),
    ).toEqual({
      buyAmount: "990",
      gasFeesInUsd: 0.08,
      priceImpactBps: 12,
      quoteId: "quote-1",
      routeLabels: ["Ekubo 70%", "Hashstack 30%"],
      sellAmount: "1000",
    });
  });

  it("rejects an unexpected target, entrypoint, or call count", () => {
    const call = {
      calldata: ["0x1"],
      contractAddress: AVNU_ADDRESSES.exchange,
      entrypoint: "multi_route_swap",
    };
    expect(() => parseBuildResponse({ calls: [{ ...call, contractAddress: "0x1" }] })).toThrow();
    expect(() => parseBuildResponse({ calls: [{ ...call, entrypoint: "transfer" }] })).toThrow();
    expect(() => parseBuildResponse({ calls: [call, call] })).toThrow();
  });
});
