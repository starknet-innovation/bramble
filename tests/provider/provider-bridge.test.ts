/**
 * Provider bridge checks prove arbitrary page messages cannot reach privileged wallet commands.
 */
import { describe, expect, test } from "bun:test";
import {
  CONTENT_TARGET,
  canQueueProviderRequest,
  isTrustedPageMessage,
  MAX_PENDING_PROVIDER_REQUESTS,
  PAGE_TARGET,
  providerResponse,
  readProviderRequest,
  readProviderRequestArguments,
  readProviderResponse,
  toProviderPayload,
  toRuntimeMessage,
} from "../../src/provider/bridge";
import { invalidRequestPayload, unknownError, userRefusedOp } from "../../src/shared/rpc-errors";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const account = {
  address: "0x123",
  classHash: "0xabc",
  derivation: {
    accountIndex: 0,
    addressIndex: 0,
    kind: "starknet-bip44" as const,
  },
  id: "SN_SEPOLIA:0x123",
  networkId: "SN_SEPOLIA" as const,
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};
const accountResult = { accounts: [account], ok: true as const };
// Page-facing view: only address + networkId survive sanitization.
const publicAccount = { address: account.address, networkId: account.networkId };
const publicAccountResult = { accounts: [publicAccount], ok: true as const };
const invokeParams = {
  calls: [{ calldata: ["0x1"], contractAddress: "0x123", entrypoint: "transfer" }],
};
// A spec PADDED_TXN_HASH: 0x + 64 hex with the top nibble in 0-8.
const paddedHash = `0x${"123".padStart(64, "0")}`;

describe("provider bridge", () => {
  test("caps unresolved in-page provider requests", () => {
    expect(canQueueProviderRequest(0)).toBe(true);
    expect(canQueueProviderRequest(MAX_PENDING_PROVIDER_REQUESTS - 1)).toBe(true);
    expect(canQueueProviderRequest(MAX_PENDING_PROVIDER_REQUESTS)).toBe(false);
    expect(canQueueProviderRequest(-1)).toBe(false);
    expect(canQueueProviderRequest(Number.NaN)).toBe(false);
  });

  test("reads direct provider request arguments", () => {
    expect(readProviderRequestArguments({ method: "mc_accounts" })).toEqual({
      method: "mc_accounts",
    });
    expect(readProviderRequestArguments(null)).toBeNull();
    expect(readProviderRequestArguments({ method: "" })).toBeNull();
    expect(readProviderRequestArguments({ method: 1 })).toBeNull();
    expect(readProviderRequestArguments({ method: "wallet.signHash" })).toBeNull();
    expect(readProviderRequestArguments({ method: "mc_accounts", params: [] })).toBeNull();
    expect(readProviderRequestArguments({ method: "mc_requestAccounts" })).toEqual({
      method: "mc_requestAccounts",
    });
    expect(readProviderRequestArguments({ type: "wallet_requestAccounts" })).toEqual({
      method: "wallet_requestAccounts",
    });
    expect(readProviderRequestArguments({ type: "wallet_requestChainId" })).toEqual({
      method: "wallet_requestChainId",
    });
    expect(
      readProviderRequestArguments({
        params: { chainId: "0x534e5f4d41494e" },
        type: "wallet_switchStarknetChain",
      }),
    ).toEqual({
      method: "wallet_switchStarknetChain",
      params: { chainId: "0x534e5f4d41494e" },
    });
    expect(
      readProviderRequestArguments({ params: invokeParams, type: "wallet_addInvokeTransaction" }),
    ).toEqual({
      method: "wallet_addInvokeTransaction",
      params: invokeParams,
    });
    expect(readProviderRequestArguments({ debug: true, method: "mc_accounts" })).toBeNull();
    // Discovery methods reach request() with an optional api_version param.
    expect(readProviderRequestArguments({ method: "wallet_supportedSpecs" })).toEqual({
      method: "wallet_supportedSpecs",
    });
    expect(
      readProviderRequestArguments({
        method: "wallet_deploymentData",
        params: { api_version: "0.7.2" },
      }),
    ).toEqual({ method: "wallet_deploymentData", params: { api_version: "0.7.2" } });
  });

  test("reads well-formed provider requests", () => {
    expect(
      readProviderRequest({ id: requestId, method: "mc_accounts", target: CONTENT_TARGET }),
    ).toEqual({
      id: requestId,
      method: "mc_accounts",
    });
    expect(
      readProviderRequest({ id: requestId, method: "wallet.signHash", target: CONTENT_TARGET }),
    ).toBeNull();
    expect(
      readProviderRequest({
        id: requestId,
        params: invokeParams,
        method: "wallet_addInvokeTransaction",
        target: CONTENT_TARGET,
      }),
    ).toEqual({
      id: requestId,
      method: "wallet_addInvokeTransaction",
      params: invokeParams,
    });
    expect(
      readProviderRequest({
        id: requestId,
        method: "wallet_requestChainId",
        target: CONTENT_TARGET,
      }),
    ).toEqual({
      id: requestId,
      method: "wallet_requestChainId",
    });
    expect(
      readProviderRequest({
        id: requestId,
        method: "wallet_switchStarknetChain",
        params: { chainId: "0x534e5f4d41494e" },
        target: CONTENT_TARGET,
      }),
    ).toEqual({
      id: requestId,
      method: "wallet_switchStarknetChain",
      params: { chainId: "0x534e5f4d41494e" },
    });
  });

  test("rejects messages without the content target", () => {
    expect(readProviderRequest({ id: requestId, method: "wallet.signHash" })).toBeNull();
    expect(
      readProviderRequest({ id: "", method: "mc_accounts", target: CONTENT_TARGET }),
    ).toBeNull();
    expect(
      readProviderRequest({ id: "not-a-uuid", method: "mc_accounts", target: CONTENT_TARGET }),
    ).toBeNull();
    expect(
      readProviderRequest({
        debug: true,
        id: requestId,
        method: "mc_accounts",
        target: CONTENT_TARGET,
      }),
    ).toBeNull();
    expect(
      readProviderRequest({
        id: requestId,
        method: "mc_accounts",
        params: undefined,
        target: CONTENT_TARGET,
      }),
    ).toBeNull();
    expect(readProviderRequest({ id: requestId, method: "", target: CONTENT_TARGET })).toBeNull();
  });

  test("trusts only same-window same-origin page messages", () => {
    const pageWindow = {} as Window;

    expect(
      isTrustedPageMessage(
        { origin: "https://a.test", source: pageWindow },
        pageWindow,
        "https://a.test",
      ),
    ).toBe(true);
    expect(
      isTrustedPageMessage(
        { origin: "https://b.test", source: pageWindow },
        pageWindow,
        "https://a.test",
      ),
    ).toBe(false);
    expect(
      isTrustedPageMessage(
        { origin: "https://a.test", source: {} as Window },
        pageWindow,
        "https://a.test",
      ),
    ).toBe(false);
  });

  test("forwards only explicitly supported safe methods", () => {
    expect(toRuntimeMessage({ id: "7", method: "mc_accounts" }, "http://a.test")).toBeNull();
    expect(toRuntimeMessage({ id: "4", method: "mc_accounts" }, "https://a.test")).toEqual({
      origin: "https://a.test",
      type: "wallet.getGrantedAccounts",
    });
    expect(toRuntimeMessage({ id: "5", method: "mc_requestAccounts" }, "https://a.test")).toEqual({
      origin: "https://a.test",
      type: "wallet.requestAccounts",
    });
    expect(
      toRuntimeMessage({ id: "6", method: "wallet_requestAccounts" }, "https://a.test"),
    ).toEqual({
      origin: "https://a.test",
      type: "wallet.requestAccounts",
    });
    expect(
      toRuntimeMessage({ id: "7", method: "wallet_requestChainId" }, "https://a.test"),
    ).toEqual({
      origin: "https://a.test",
      type: "wallet.getChainId",
    });
    expect(
      toRuntimeMessage(
        {
          id: "7",
          method: "wallet_switchStarknetChain",
          params: { chainId: "0x534e5f4d41494e" },
        },
        "https://a.test",
      ),
    ).toEqual({
      chainId: "0x534e5f4d41494e",
      origin: "https://a.test",
      type: "wallet.switchChain",
    });
    expect(
      toRuntimeMessage(
        { id: "7", method: "wallet_switchStarknetChain", params: { chainId: "SN_MAIN" } },
        "https://a.test",
      ),
    ).toBeNull();
    expect(
      toRuntimeMessage(
        { id: "8", method: "wallet_addInvokeTransaction", params: invokeParams },
        "https://a.test",
      ),
    ).toEqual({
      calls: invokeParams.calls,
      origin: "https://a.test",
      type: "wallet.addInvokeTransaction",
    });
    expect(
      toRuntimeMessage(
        { id: "9", method: "wallet_addInvokeTransaction", params: { calls: [] } },
        "https://a.test",
      ),
    ).toBeNull();
  });

  test("creates page-targeted responses", () => {
    expect(
      providerResponse({ id: requestId, method: "mc_accounts" }, { result: publicAccountResult }),
    ).toEqual({
      id: requestId,
      result: publicAccountResult,
      target: PAGE_TARGET,
    });
    expect(
      providerResponse(
        { id: requestId, method: "mc_accounts" },
        { error: userRefusedOp(), result: { ready: true } },
      ),
    ).toEqual({
      error: userRefusedOp(),
      id: requestId,
      target: PAGE_TARGET,
    });
    expect(
      providerResponse({ id: requestId, method: "mc_accounts" }, { result: { ready: true } }),
    ).toEqual({
      error: unknownError(),
      id: requestId,
      target: PAGE_TARGET,
    });
    expect(
      providerResponse(
        { id: requestId, method: "wallet_requestAccounts" },
        { result: [account.address] },
      ),
    ).toEqual({
      id: requestId,
      result: [account.address],
      target: PAGE_TARGET,
    });
    expect(
      providerResponse(
        { id: requestId, method: "wallet_requestChainId" },
        { result: "0x534e5f5345504f4c4941" },
      ),
    ).toEqual({
      id: requestId,
      result: "0x534e5f5345504f4c4941",
      target: PAGE_TARGET,
    });
    expect(
      providerResponse(
        { id: requestId, method: "wallet_switchStarknetChain" },
        { result: "0x534e5f4d41494e" },
      ),
    ).toEqual({
      id: requestId,
      result: "0x534e5f4d41494e",
      target: PAGE_TARGET,
    });
    expect(
      providerResponse(
        { id: requestId, method: "wallet_addInvokeTransaction" },
        { result: { transaction_hash: paddedHash } },
      ),
    ).toEqual({
      id: requestId,
      result: { transaction_hash: paddedHash },
      target: PAGE_TARGET,
    });
    // A short (unpadded) transaction hash is rejected by the wire validator.
    expect(
      providerResponse(
        { id: requestId, method: "wallet_addInvokeTransaction" },
        { result: { transaction_hash: "0x123" } },
      ),
    ).toEqual({
      error: unknownError(),
      id: requestId,
      target: PAGE_TARGET,
    });
    expect(providerResponse({ id: requestId, method: "mc_accounts" }, {})).toEqual({
      error: unknownError(),
      id: requestId,
      target: PAGE_TARGET,
    });
    expect(
      providerResponse(
        { id: requestId, method: "mc_accounts" },
        { error: invalidRequestPayload() },
      ),
    ).toEqual({
      error: invalidRequestPayload(),
      id: requestId,
      target: PAGE_TARGET,
    });
  });

  test("reads exact page-targeted responses", () => {
    expect(
      readProviderResponse({ id: requestId, result: publicAccountResult, target: PAGE_TARGET }),
    ).toEqual({
      id: requestId,
      result: publicAccountResult,
      target: PAGE_TARGET,
    });
    // A page-wire accounts result carrying derivation/public-key fields is rejected.
    expect(
      readProviderResponse({ id: requestId, result: accountResult, target: PAGE_TARGET }),
    ).toBeNull();
    expect(
      readProviderResponse({ error: userRefusedOp(), id: requestId, target: PAGE_TARGET }),
    ).toEqual({
      error: userRefusedOp(),
      id: requestId,
      target: PAGE_TARGET,
    });
    // A raw string error is not a spec error object, so the response is rejected.
    expect(
      readProviderResponse({ error: "wallet locked", id: requestId, target: PAGE_TARGET }),
    ).toBeNull();
    expect(
      readProviderResponse({ id: "not-a-uuid", result: true, target: PAGE_TARGET }),
    ).toBeNull();
    expect(
      readProviderResponse({ debug: true, id: requestId, result: true, target: PAGE_TARGET }),
    ).toBeNull();
    expect(
      readProviderResponse({ id: requestId, result: { ready: true }, target: PAGE_TARGET }),
    ).toBeNull();
    expect(
      readProviderResponse(
        Object.create(
          { result: accountResult },
          {
            id: { enumerable: true, value: requestId },
            target: { enumerable: true, value: PAGE_TARGET },
          },
        ),
      ),
    ).toBeNull();
    expect(
      readProviderResponse({
        error: userRefusedOp(),
        id: requestId,
        result: true,
        target: PAGE_TARGET,
      }),
    ).toBeNull();
  });

  test("maps background errors to provider rejections", () => {
    expect(toProviderPayload({ error: "request rejected" })).toEqual({ error: userRefusedOp() });
    expect(toProviderPayload({ error: "wallet locked" })).toEqual({ error: unknownError() });
    expect(toProviderPayload({ error: "invalid invoke request" })).toEqual({
      error: invalidRequestPayload(),
    });
    expect(toProviderPayload({ error: "unsupported chain" })).toEqual({
      error: { code: 117, message: "The chain id is not supported" },
    });
    expect(toProviderPayload({ accounts: [], ok: true })).toEqual({
      result: { accounts: [], ok: true },
    });
    expect(toProviderPayload({ accounts: [account], ok: true }, "wallet_requestAccounts")).toEqual({
      result: [account.address],
    });
    expect(toProviderPayload({ chainId: "0x534e5f5345504f4c4941", ok: true })).toEqual({
      result: "0x534e5f5345504f4c4941",
    });
    expect(
      toProviderPayload({ ok: true, transactionHash: "0x123" }, "wallet_addInvokeTransaction"),
    ).toEqual({
      result: { transaction_hash: paddedHash },
    });
    expect(toProviderPayload({ ok: true, signature: { r: "0x1", s: "0x2" } })).toEqual({
      error: unknownError(),
    });
  });

  test("accepts only exact provider account responses", () => {
    const sparseAccounts = new Array<unknown>(1);

    expect(toProviderPayload({ accounts: [account], ok: true })).toEqual({
      result: publicAccountResult,
    });
    expect(toProviderPayload({ accounts: [account, account], ok: true })).toEqual({
      error: unknownError(),
    });
    expect(toProviderPayload({ accounts: sparseAccounts, ok: true })).toEqual({
      error: unknownError(),
    });
    expect(
      toProviderPayload({ accounts: [{ ...account, privateKey: "0x456" }], ok: true }),
    ).toEqual({
      error: unknownError(),
    });
    expect(toProviderPayload({ accounts: [account], ok: true, signature: "0x123" })).toEqual({
      error: unknownError(),
    });
  });

  test("strips derivation indices and public keys from page-facing accounts", () => {
    const payload = toProviderPayload({ accounts: [account], ok: true });
    expect(payload).toEqual({ result: publicAccountResult });

    const result = payload.result as { readonly accounts: readonly Record<string, unknown>[] };
    for (const forwarded of result.accounts) {
      expect(Object.keys(forwarded).sort()).toEqual(["address", "networkId"]);
      expect(forwarded).not.toHaveProperty("derivation");
      expect(forwarded).not.toHaveProperty("publicKeyX");
      expect(forwarded).not.toHaveProperty("publicKeyY");
      expect(forwarded).not.toHaveProperty("classHash");
      expect(forwarded).not.toHaveProperty("id");
    }
  });

  test("wallet_requestAccounts still returns addresses only", () => {
    expect(toProviderPayload({ accounts: [account], ok: true }, "wallet_requestAccounts")).toEqual({
      result: [account.address],
    });
  });

  test("redacts pending approval internals from provider responses", () => {
    expect(
      toProviderPayload({
        ok: false,
        pending: { id: "123e4567-e89b-42d3-a456-426614174000", origin: "https://a.test" },
      }),
    ).toEqual({ error: unknownError() });
  });
});
