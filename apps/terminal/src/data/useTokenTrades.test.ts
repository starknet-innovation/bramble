import { describe, expect, it } from "vitest";
import type { TokenRow } from "./types";
import { parseEkuboTokenTrades } from "./useTokenTrades";

const token = (
  address: string,
  symbol: string,
  decimals: number,
  priceUsd: number,
): TokenRow => ({
  address,
  change24h: null,
  decimals,
  liquidityUsd: null,
  logoUri: null,
  marketCapUsd: null,
  name: symbol,
  priceUsd,
  symbol,
  volume24hUsd: null,
});

describe("Ekubo token trade tape", () => {
  it("aggregates pool fills and derives side, amount, and USD execution price", () => {
    const eth = token(
      "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
      "ETH",
      18,
      2_000,
    );
    const usdc = token(
      "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
      "USDC",
      6,
      1,
    );
    const rows = parseEkuboTokenTrades(
      {
        data: [
          {
            delta0: "120000000",
            delta1: "-60000000000000000",
            locker: "456",
            timestamp: "2026-07-24T14:56:42.000Z",
            transaction_hash: "123",
            type: 0,
          },
          {
            delta0: "80000000",
            delta1: "-40000000000000000",
            locker: "456",
            timestamp: "2026-07-24T14:56:43.000Z",
            transaction_hash: "123",
            type: 0,
          },
          {
            delta0: "1",
            delta1: "-1",
            locker: "456",
            timestamp: "2026-07-24T14:56:44.000Z",
            transaction_hash: "999",
            type: 1,
          },
        ],
      },
      eth,
      usdc,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount: 0.1,
      priceUsd: 2_000,
      quoteSymbol: "USDC",
      side: "buy",
      valueUsd: 200,
    });
  });
});
