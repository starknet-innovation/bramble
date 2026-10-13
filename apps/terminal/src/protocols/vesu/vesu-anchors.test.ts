/**
 * Vesu addresses are anchored to the pinned pool factory's registry before
 * they reach a call (Sherlock 169): the API names the pool and vToken, and
 * `v_token_for_asset(pool, asset)` decides whether they are Vesu's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINNET_TOKEN_ADDRESSES, VESU_ADDRESSES } from "../constants";

type Registry = Readonly<Record<string, string>>;
let registry: Registry = {};
let registryFails = false;
const reads: { readonly calldata: readonly string[]; readonly contractAddress: string }[] = [];

vi.mock("../support/provider", async (importActual) => {
  const actual = await importActual<typeof import("../support/provider")>();
  return {
    ...actual,
    withRpcFallback: async (
      _urls: readonly string[],
      run: (provider: unknown) => Promise<unknown>,
    ): Promise<unknown> =>
      run({
        callContract: async (call: {
          readonly calldata: readonly string[];
          readonly contractAddress: string;
          readonly entrypoint: string;
        }) => {
          reads.push(call);
          if (registryFails) throw new Error("node unreachable");
          if (call.entrypoint !== "v_token_for_asset") throw new Error("unexpected entrypoint");
          const [pool, asset] = call.calldata.map((felt) => BigInt(felt).toString(16));
          return [registry[`${pool}:${asset}`] ?? "0x0"];
        },
      }),
  };
});

const { quoteLending, buildLendingCalls } = await import("./vesu");
const {
  recheckVesuLendingQuote,
  registeredVesuVToken,
  verifyVesuMultiplyPool,
  VESU_REGISTRY_UNAVAILABLE,
  VESU_UNREGISTERED,
} = await import("./vesu-anchors");

const POOL = VESU_ADDRESSES.primePoolId;
const USDC = MAINNET_TOKEN_ADDRESSES.USDC;
const ETH = MAINNET_TOKEN_ADDRESSES.ETH;
const VTOKEN = "0x79c83c3eb20df05d9e3ebdd45990060101bd126666181de622e432948f3e9";
const ACCOUNT = "0x456";
const key = (pool: string, asset: string): string =>
  `${BigInt(pool).toString(16)}:${BigInt(asset).toString(16)}`;

const apiPool = (vToken: string) => ({
  data: {
    assets: [
      { address: USDC, stats: {}, vToken: { address: vToken } },
      { address: ETH, stats: {}, vToken: { address: "0xe7" } },
    ],
    id: POOL,
    protocolVersion: "v2",
  },
});

const answerApi = (body: unknown): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
};

beforeEach(() => {
  registry = { [key(POOL, USDC)]: VTOKEN, [key(POOL, ETH)]: "0xe7" };
  registryFails = false;
  reads.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Vesu registry anchor", () => {
  it("asks the pinned pool factory for the asset's vToken", async () => {
    expect(await registeredVesuVToken(POOL, USDC)).toBe(VTOKEN);
    expect(reads[0]?.contractAddress).toBe(VESU_ADDRESSES.poolFactory);
  });

  it("refuses a pool or asset the factory does not register, and an unreadable registry", async () => {
    await expect(registeredVesuVToken("0xbad", USDC)).rejects.toThrow(VESU_UNREGISTERED);
    registryFails = true;
    await expect(registeredVesuVToken(POOL, USDC)).rejects.toThrow(VESU_REGISTRY_UNAVAILABLE);
  });

  it("builds a supply that approves and deposits into the registered vToken", async () => {
    answerApi(apiPool(VTOKEN));
    const quote = await quoteLending({
      accountAddress: ACCOUNT,
      action: "supply",
      amount: "1000000",
      asset: USDC,
      poolId: POOL,
    });
    expect(quote.vTokenAddress).toBe(VTOKEN);
    const calls = buildLendingCalls({ accountAddress: ACCOUNT, quote });
    expect(calls.map((call) => call.contractAddress)).toEqual([USDC, VTOKEN, USDC]);
  });

  it("refuses an API answer that names a different vToken", async () => {
    answerApi(apiPool("0xa77ac4e7"));
    await expect(
      quoteLending({ accountAddress: ACCOUNT, action: "supply", amount: "1", asset: USDC, poolId: POOL }),
    ).rejects.toThrow("does not register");
  });

  it("refuses a pool the factory never created, even when the API vouches for it", async () => {
    const forged = "0xf00d";
    answerApi({ data: { ...apiPool(VTOKEN).data, id: forged } });
    await expect(
      quoteLending({ accountAddress: ACCOUNT, action: "supply", amount: "1", asset: USDC, poolId: forged }),
    ).rejects.toThrow(VESU_UNREGISTERED);
  });

  it("refuses a borrow whose collateral asset the pool does not register", async () => {
    answerApi(apiPool(VTOKEN));
    registry = { [key(POOL, USDC)]: VTOKEN };
    await expect(
      quoteLending({
        accountAddress: ACCOUNT,
        action: "borrow",
        amount: "1",
        asset: USDC,
        collateralAmount: "1",
        collateralAsset: ETH,
        poolId: POOL,
      }),
    ).rejects.toThrow(VESU_UNREGISTERED);
  });

  it("verifies both legs of a Multiply pool before its calls are built", async () => {
    await expect(verifyVesuMultiplyPool(POOL, ETH, USDC)).resolves.toBeUndefined();
    expect(reads.map((read) => read.contractAddress)).toEqual([
      VESU_ADDRESSES.poolFactory,
      VESU_ADDRESSES.poolFactory,
    ]);
    await expect(verifyVesuMultiplyPool("0xf00d", ETH, USDC)).rejects.toThrow(VESU_UNREGISTERED);
    registry = { [key(POOL, ETH)]: "0xe7" };
    await expect(verifyVesuMultiplyPool(POOL, ETH, USDC)).rejects.toThrow(VESU_UNREGISTERED);
    registry = { [key(POOL, USDC)]: VTOKEN };
    await expect(verifyVesuMultiplyPool(POOL, ETH, USDC)).rejects.toThrow(VESU_UNREGISTERED);
    registryFails = true;
    await expect(verifyVesuMultiplyPool(POOL, ETH, USDC)).rejects.toThrow(
      VESU_REGISTRY_UNAVAILABLE,
    );
  });

  describe("re-check at wallet handoff (#270)", () => {
    const borrowQuote = async () => {
      answerApi(apiPool(VTOKEN));
      return quoteLending({
        accountAddress: ACCOUNT,
        action: "borrow",
        amount: "1",
        asset: USDC,
        collateralAmount: "1",
        collateralAsset: ETH,
        poolId: POOL,
      });
    };

    it("passes while the registry still lists the quoted pool, asset, vToken and collateral", async () => {
      const quote = await borrowQuote();
      reads.length = 0;
      await expect(recheckVesuLendingQuote(quote)).resolves.toBeUndefined();
      expect(reads.map((read) => read.contractAddress)).toEqual([
        VESU_ADDRESSES.poolFactory,
        VESU_ADDRESSES.poolFactory,
      ]);
    });

    it("refuses when the registry now names a different vToken than the quote", async () => {
      const quote = await borrowQuote();
      registry = { ...registry, [key(POOL, USDC)]: "0xa77ac4e7" };
      await expect(recheckVesuLendingQuote(quote)).rejects.toThrow(VESU_REGISTRY_UNAVAILABLE);
    });

    it("refuses when the asset or the collateral asset is no longer registered", async () => {
      const quote = await borrowQuote();
      registry = { [key(POOL, ETH)]: "0xe7" };
      await expect(recheckVesuLendingQuote(quote)).rejects.toThrow(VESU_UNREGISTERED);
      registry = { [key(POOL, USDC)]: VTOKEN };
      await expect(recheckVesuLendingQuote(quote)).rejects.toThrow(VESU_UNREGISTERED);
    });

    it("refuses when the registry is unreadable at handoff, or the quote has no vToken", async () => {
      const quote = await borrowQuote();
      registryFails = true;
      await expect(recheckVesuLendingQuote(quote)).rejects.toThrow(VESU_REGISTRY_UNAVAILABLE);
      registryFails = false;
      await expect(
        recheckVesuLendingQuote({ ...quote, vTokenAddress: null }),
      ).rejects.toThrow(VESU_REGISTRY_UNAVAILABLE);
    });
  });
});
