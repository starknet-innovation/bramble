/**
 * Ekubo quoting reads the chosen pool's price from Core `get_pool_price`,
 * whose only argument is the `PoolKey` (Sherlock 133). Core refuses longer
 * input, so passing the RouterV3 quote calldata made every quote fail.
 */
import { describe, expect, it, vi } from "vitest";

type FakeCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

const calls: FakeCall[] = [];

vi.mock("../support/provider", async (importActual) => {
  const actual = await importActual<typeof import("../support/provider")>();
  return {
    ...actual,
    withRpcFallback: async (
      _urls: readonly string[],
      run: (provider: unknown) => Promise<unknown>,
    ): Promise<unknown> =>
      run({
        callContract: async (call: FakeCall) => {
          calls.push(call);
          if (call.entrypoint === "quote_swap") {
            // Delta { amount0: +sold, amount1: -bought }.
            return ["0x64", "0x0", "0x5a", "0x1"];
          }
          if (call.entrypoint === "get_pool_price") {
            // The Cairo entrypoint wrapper rejects extra felts.
            if (call.calldata.length !== 5) {
              throw new Error("Input too long for arguments");
            }
            // PoolPrice { sqrt_ratio: u256, tick: i129 }.
            return ["0x100", "0x0", "0x0", "0x0"];
          }
          throw new Error(`unexpected entrypoint ${call.entrypoint}`);
        },
      }),
  };
});

const { quoteSwap } = await import("./ekubo");
const { buildPoolKey, buildPoolPriceCalldata, EKUBO_FEE_TIERS } = await import("./ekubo-swap");

const TOKEN_A = "0x1";
const TOKEN_B = "0x2";

describe("Ekubo pool price read", () => {
  it("passes Core only the pool key", () => {
    const tier = EKUBO_FEE_TIERS[0];
    if (!tier) throw new Error("no fee tier");
    const poolKey = buildPoolKey(TOKEN_A, TOKEN_B, tier);
    expect(buildPoolPriceCalldata(poolKey)).toEqual([
      "1",
      "2",
      BigInt(poolKey.fee).toString(),
      BigInt(poolKey.tickSpacing).toString(),
      BigInt(poolKey.extension).toString(),
    ]);
  });

  it("quotes a swap through Core's five-felt get_pool_price", async () => {
    calls.length = 0;
    const quote = await quoteSwap({
      buyToken: TOKEN_B,
      sellAmount: "100",
      sellToken: TOKEN_A,
      takerAddress: "0x9",
    });

    expect(quote.buyAmount).toBe("90");
    const priceRead = calls.find((call) => call.entrypoint === "get_pool_price");
    expect(priceRead?.calldata).toHaveLength(5);
  });
});
