/**
 * get-starknet compatible provider surface checks: wallet_getPermissions and
 * wallet_watchAsset bridge mappings, watch-asset param parsing, background
 * input readers, and the pure watch-asset token builder.
 */
import { describe, expect, test } from "bun:test";
import { readGetPermissionsInput, readWatchAssetInput } from "../src/background/provider-inputs";
import { watchAssetToken } from "../src/background/watch-asset";
import {
  CONTENT_TARGET,
  PAGE_TARGET,
  providerResponse,
  readProviderRequest,
  readProviderRequestArguments,
  readProviderResponse,
  toProviderPayload,
  toRuntimeMessage,
} from "../src/provider/bridge";
import { readProviderWatchAsset } from "../src/provider/watch-asset-params";
import { invalidRequestPayload, unknownError } from "../src/shared/rpc-errors";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const tokenAddress = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const watchParams = {
  options: { address: tokenAddress, decimals: 6, symbol: "USDC" },
  type: "ERC20",
};

describe("provider permission surface", () => {
  test("reads permission request arguments and messages", () => {
    expect(readProviderRequestArguments({ type: "wallet_getPermissions" })).toEqual({
      method: "wallet_getPermissions",
    });
    // wallet_getPermissions accepts its spec-defined optional api_version param.
    expect(
      readProviderRequestArguments({
        method: "wallet_getPermissions",
        params: { api_version: "0.7.2" },
      }),
    ).toEqual({ method: "wallet_getPermissions", params: { api_version: "0.7.2" } });
    expect(
      readProviderRequest({
        id: requestId,
        method: "wallet_getPermissions",
        target: CONTENT_TARGET,
      }),
    ).toEqual({ id: requestId, method: "wallet_getPermissions" });
  });

  test("maps permission queries only for secure origins", () => {
    expect(
      toRuntimeMessage({ id: "1", method: "wallet_getPermissions" }, "https://a.test"),
    ).toEqual({ origin: "https://a.test", type: "wallet.getPermissions" });
    expect(
      toRuntimeMessage({ id: "1", method: "wallet_getPermissions" }, "http://a.test"),
    ).toBeNull();
  });

  test("maps permission responses to a permission list", () => {
    expect(
      toProviderPayload({ ok: true, permissions: ["accounts"] }, "wallet_getPermissions"),
    ).toEqual({ result: ["accounts"] });
    expect(toProviderPayload({ ok: true, permissions: [] }, "wallet_getPermissions")).toEqual({
      result: [],
    });
    expect(toProviderPayload({ error: "sender origin mismatch" }, "wallet_getPermissions")).toEqual(
      {
        error: invalidRequestPayload(),
      },
    );
    expect(toProviderPayload({ ok: true }, "wallet_getPermissions")).toEqual({
      error: unknownError(),
    });
  });

  test("round-trips a permission list through page responses", () => {
    const response = providerResponse(
      { id: requestId, method: "wallet_getPermissions" },
      { result: ["accounts"] },
    );
    expect(response).toEqual({ id: requestId, result: ["accounts"], target: PAGE_TARGET });
    expect(readProviderResponse(response)).toEqual({
      id: requestId,
      result: ["accounts"],
      target: PAGE_TARGET,
    });
  });
});

describe("provider watch-asset surface", () => {
  test("reads watch-asset request arguments and messages", () => {
    expect(
      readProviderRequestArguments({ method: "wallet_watchAsset", params: watchParams }),
    ).toEqual({ method: "wallet_watchAsset", params: watchParams });
    expect(readProviderRequestArguments({ method: "wallet_watchAsset" })).toEqual({
      method: "wallet_watchAsset",
    });
    expect(
      readProviderRequest({
        id: requestId,
        method: "wallet_watchAsset",
        params: watchParams,
        target: CONTENT_TARGET,
      }),
    ).toEqual({ id: requestId, method: "wallet_watchAsset", params: watchParams });
  });

  test("maps watch-asset requests only when the asset is well formed", () => {
    expect(
      toRuntimeMessage(
        { id: "1", method: "wallet_watchAsset", params: watchParams },
        "https://a.test",
      ),
    ).toEqual({
      asset: { address: tokenAddress, decimals: 6, symbol: "USDC" },
      origin: "https://a.test",
      type: "wallet.watchAsset",
    });
    expect(toRuntimeMessage({ id: "1", method: "wallet_watchAsset" }, "https://a.test")).toBeNull();
    expect(
      toRuntimeMessage(
        {
          id: "1",
          method: "wallet_watchAsset",
          params: { options: { address: "0x0" }, type: "ERC20" },
        },
        "https://a.test",
      ),
    ).toBeNull();
  });

  test("maps watch-asset outcomes to boolean or approval-pending", () => {
    expect(toProviderPayload({ ok: true, watched: true }, "wallet_watchAsset")).toEqual({
      result: true,
    });
    expect(
      toProviderPayload(
        { ok: false, pending: { id: requestId, kind: "watch-asset", origin: "https://a.test" } },
        "wallet_watchAsset",
      ),
    ).toEqual({ error: unknownError() });
    expect(
      toProviderPayload({ error: "invalid watch asset metadata" }, "wallet_watchAsset"),
    ).toEqual({
      error: invalidRequestPayload(),
    });
    expect(toProviderPayload({ ok: true }, "wallet_watchAsset")).toEqual({
      error: unknownError(),
    });
  });

  test("round-trips a watch-asset boolean through page responses", () => {
    const response = providerResponse(
      { id: requestId, method: "wallet_watchAsset" },
      { result: true },
    );
    expect(response).toEqual({ id: requestId, result: true, target: PAGE_TARGET });
    expect(readProviderResponse(response)).toEqual({
      id: requestId,
      result: true,
      target: PAGE_TARGET,
    });
  });
});

describe("readProviderWatchAsset", () => {
  test("accepts SNIP ERC20 options with a non-zero address", () => {
    expect(readProviderWatchAsset(watchParams)).toEqual({
      address: tokenAddress,
      decimals: 6,
      symbol: "USDC",
    });
    expect(readProviderWatchAsset({ options: { address: tokenAddress }, type: "ERC20" })).toEqual({
      address: tokenAddress,
    });
  });

  test("rejects malformed watch-asset options", () => {
    expect(readProviderWatchAsset(undefined)).toBeNull();
    expect(
      readProviderWatchAsset({ options: { address: tokenAddress }, type: "ERC721" }),
    ).toBeNull();
    expect(readProviderWatchAsset({ options: { address: "0x0" }, type: "ERC20" })).toBeNull();
    expect(readProviderWatchAsset({ options: { address: "nope" }, type: "ERC20" })).toBeNull();
    expect(
      readProviderWatchAsset({ options: { address: tokenAddress, decimals: 99 }, type: "ERC20" }),
    ).toBeNull();
    expect(
      readProviderWatchAsset({ chainId: "0x1", options: { address: tokenAddress }, type: "ERC20" }),
    ).toBeNull();
  });
});

describe("background provider input readers", () => {
  test("parses and normalizes permission queries", () => {
    expect(
      readGetPermissionsInput({ origin: "https://a.test/app", type: "wallet.getPermissions" }),
    ).toEqual({ origin: "https://a.test" });
    expect(
      readGetPermissionsInput({ origin: "not-a-url", type: "wallet.getPermissions" }),
    ).toBeNull();
    expect(readGetPermissionsInput({ type: "wallet.getPermissions" })).toBeNull();
  });

  test("parses watch-asset requests and rejects missing assets", () => {
    expect(
      readWatchAssetInput({
        asset: { address: tokenAddress, decimals: 6, symbol: "USDC" },
        origin: "https://a.test/app",
        type: "wallet.watchAsset",
      }),
    ).toEqual({
      asset: { address: tokenAddress, decimals: 6, symbol: "USDC" },
      origin: "https://a.test",
    });
    expect(readWatchAssetInput({ origin: "https://a.test", type: "wallet.watchAsset" })).toBeNull();
    expect(
      readWatchAssetInput({
        asset: { address: 1 },
        origin: "https://a.test",
        type: "wallet.watchAsset",
      }),
    ).toBeNull();
  });
});

describe("watchAssetToken", () => {
  test("prefers on-chain metadata and uppercases the symbol", () => {
    expect(
      watchAssetToken(
        { address: tokenAddress, decimals: 99, symbol: "wrong" },
        { decimals: 6, name: "USD Coin", symbol: "usdc" },
        "SN_MAIN",
      ),
    ).toEqual({
      address: tokenAddress,
      decimals: 6,
      name: "USD Coin",
      networkId: "SN_MAIN",
      symbol: "USDC",
    });
  });

  test("falls back to dapp options when metadata is missing", () => {
    expect(
      watchAssetToken({ address: tokenAddress, decimals: 6, symbol: "USDC" }, null, "SN_SEPOLIA"),
    ).toEqual({
      address: tokenAddress,
      decimals: 6,
      name: "USDC",
      networkId: "SN_SEPOLIA",
      symbol: "USDC",
    });
  });

  test("rejects unusable tokens", () => {
    expect(
      watchAssetToken({ address: "0x0", decimals: 6, symbol: "USDC" }, null, "SN_MAIN"),
    ).toBeNull();
    expect(watchAssetToken({ address: tokenAddress }, null, "SN_MAIN")).toBeNull();
    expect(
      watchAssetToken(
        { address: tokenAddress, decimals: 6, symbol: "bad symbol" },
        null,
        "SN_MAIN",
      ),
    ).toBeNull();
  });
});
