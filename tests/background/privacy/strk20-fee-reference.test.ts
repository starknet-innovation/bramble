/**
 * The independent price leg of the converted-fee bound.
 *
 * This adapter is the only thing standing between a relay-set conversion rate
 * and a shielded balance, so its arithmetic is pinned against hand-computed
 * values and every way it can fail to produce a number is required to return
 * `null` — which the privacy layer turns into a refused route rather than an
 * unbounded quote.
 */
import { describe, expect, test } from "bun:test";
import type { PriceService, TokenPrices } from "@bramble/portfolio/prices";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import {
  createStrk20FeeReference,
  strk20FeeAssetFor,
} from "../../../apps/extension/src/background/privacy/strk20-fee-reference";

const USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const WBTC = "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac";
const networkId = "SN_MAIN" as const;
const POOL_FEE_6_STRK = 6_000_000_000_000_000_000n;

const priceService = (
  prices: Readonly<Record<string, number>>,
  snapshot: Pick<TokenPrices, "asOf" | "stale"> = { asOf: 1_000, stale: false },
): PriceService => ({
  async getPrices(): Promise<TokenPrices> {
    return { ...snapshot, changes: {}, currency: "usd", prices };
  },
  async getTokenChart() {
    return { currency: "usd", points: [] };
  },
});

describe("createStrk20FeeReference", () => {
  test("converts the pool's STRK charge into the fee token's base units", async () => {
    const reference = createStrk20FeeReference(
      priceService({ [STRK_TOKEN_ADDRESS]: 0.2, [USDC]: 1 }),
    );

    // 6 STRK at $0.20 is $1.20, which is 1.2 USDC at 6 decimals.
    await expect(
      reference({ feeToken: USDC, networkId, poolFeeFri: POOL_FEE_6_STRK }),
    ).resolves.toBe(1_200_000n);
  });

  test("rebases correctly onto a token with different decimals", async () => {
    const reference = createStrk20FeeReference(
      priceService({ [STRK_TOKEN_ADDRESS]: 0.2, [WBTC]: 60_000 }),
    );

    // $1.20 of an 8-decimal token priced at $60,000 is 2000 base units.
    await expect(
      reference({ feeToken: WBTC, networkId, poolFeeFri: POOL_FEE_6_STRK }),
    ).resolves.toBe(2_000n);
  });

  test("matches feed keys numerically, so felt padding does not read as unpriced", async () => {
    const reference = createStrk20FeeReference(
      priceService({ [`0x0${STRK_TOKEN_ADDRESS.slice(2)}`]: 0.2, [`0x0${USDC.slice(2)}`]: 1 }),
    );

    await expect(
      reference({ feeToken: USDC, networkId, poolFeeFri: POOL_FEE_6_STRK }),
    ).resolves.toBe(1_200_000n);
  });

  test.each([
    ["the fee token has no price", { [STRK_TOKEN_ADDRESS]: 0.2 }],
    ["STRK has no price", { [USDC]: 1 }],
    ["a price is zero", { [STRK_TOKEN_ADDRESS]: 0.2, [USDC]: 0 }],
    ["a price is negative", { [STRK_TOKEN_ADDRESS]: 0.2, [USDC]: -1 }],
    ["a price is not finite", { [STRK_TOKEN_ADDRESS]: 0.2, [USDC]: Number.NaN }],
  ])("declines to price when %s", async (_case, prices) => {
    const reference = createStrk20FeeReference(priceService(prices));

    await expect(
      reference({ feeToken: USDC, networkId, poolFeeFri: POOL_FEE_6_STRK }),
    ).resolves.toBeNull();
  });

  // #357: an unreachable feed serves its last-known-good snapshot as `stale`
  // with no age limit, and an old high STRK rate would raise the ceiling.
  test.each([
    ["the feed served a stale last-known-good snapshot", { asOf: 1_000, stale: true }],
    ["the snapshot carries no capture time", { asOf: null, stale: false }],
  ])("declines to price when %s", async (_case, snapshot) => {
    const reference = createStrk20FeeReference(
      priceService({ [STRK_TOKEN_ADDRESS]: 0.2, [USDC]: 1 }, snapshot),
    );

    await expect(
      reference({ feeToken: USDC, networkId, poolFeeFri: POOL_FEE_6_STRK }),
    ).resolves.toBeNull();
  });

  test("declines a token the registry does not describe", async () => {
    const reference = createStrk20FeeReference(priceService({ [STRK_TOKEN_ADDRESS]: 0.2 }));

    await expect(
      reference({ feeToken: "0xdead", networkId, poolFeeFri: POOL_FEE_6_STRK }),
    ).resolves.toBeNull();
  });

  test("declines a non-positive pool fee rather than returning a zero bound", async () => {
    const reference = createStrk20FeeReference(
      priceService({ [STRK_TOKEN_ADDRESS]: 0.2, [USDC]: 1 }),
    );

    await expect(reference({ feeToken: USDC, networkId, poolFeeFri: 0n })).resolves.toBeNull();
  });
});

describe("strk20FeeAssetFor", () => {
  test("describes a registry fee token for the review surface", () => {
    expect(
      strk20FeeAssetFor(networkId, {
        feeAction: { amount: "0x1", recipient: "0x2", token: USDC, type: "withdraw" },
      }),
    ).toEqual({ decimals: 6, symbol: "USDC" });
  });

  test("describes nothing on the account route or for an unknown token", () => {
    expect(strk20FeeAssetFor(networkId, { mode: "account", poolFeeFri: "0x1" })).toBeUndefined();
    expect(
      strk20FeeAssetFor(networkId, {
        feeAction: { amount: "0x1", recipient: "0x2", token: "0xdead", type: "withdraw" },
      }),
    ).toBeUndefined();
  });
});
