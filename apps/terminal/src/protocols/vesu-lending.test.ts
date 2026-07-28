import { describe, expect, it } from "vitest";
import { MAINNET_TOKEN_ADDRESSES } from "./constants";
import {
  buildVesuBorrowCalls,
  buildVesuRepayCalls,
  buildVesuSupplyCalls,
  parseVesuPool,
} from "./vesu-lending";

const POOL = "0x451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5";
const VTOKEN = "0x123";
const ACCOUNT = "0x456";

describe("Vesu V2 lending boundary", () => {
  it("accepts only V2 pool anchors from the API", () => {
    const body = {
      data: {
        assets: [{
          address: MAINNET_TOKEN_ADDRESSES.USDC,
          stats: {},
          vToken: { address: VTOKEN },
        }],
        id: POOL,
        protocolVersion: "v2",
      },
    };
    expect(parseVesuPool(body)).toMatchObject({
      poolAddress: POOL,
      assets: [{ address: MAINNET_TOKEN_ADDRESSES.USDC, vTokenAddress: VTOKEN }],
    });
    expect(
      parseVesuPool({ data: { ...body.data, protocolVersion: "v1" } }),
    ).toBeNull();
  });

  it("revokes supply and borrow allowances in the same multicall", () => {
    expect(
      buildVesuSupplyCalls(
        MAINNET_TOKEN_ADDRESSES.USDC,
        VTOKEN,
        1_000_000n,
        ACCOUNT,
      ).map((call) => call.entrypoint),
    ).toEqual(["approve", "deposit", "approve"]);
    expect(
      buildVesuBorrowCalls(
        POOL,
        MAINNET_TOKEN_ADDRESSES.ETH,
        10n,
        MAINNET_TOKEN_ADDRESSES.USDC,
        5n,
        ACCOUNT,
      ).map((call) => call.entrypoint),
    ).toEqual(["approve", "modify_position", "approve"]);
  });

  it("fails closed on invalid amounts and revokes repay approval", () => {
    expect(() =>
      buildVesuSupplyCalls(
        MAINNET_TOKEN_ADDRESSES.USDC,
        VTOKEN,
        0n,
        ACCOUNT,
      )
    ).toThrow("positive u256");
    expect(
      buildVesuRepayCalls(
        POOL,
        MAINNET_TOKEN_ADDRESSES.ETH,
        MAINNET_TOKEN_ADDRESSES.USDC,
        5n,
        ACCOUNT,
      ).map((call) => call.entrypoint),
    ).toEqual(["approve", "modify_position", "approve"]);
  });
});
