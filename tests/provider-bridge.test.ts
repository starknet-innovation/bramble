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
} from "../src/provider/bridge";

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
const accountResult = { accounts: [account], ok: true };

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
    expect(readProviderRequestArguments({ debug: true, method: "mc_accounts" })).toBeNull();
  });

  test("reads well-formed provider requests", () => {
    expect(
      readProviderRequest({ id: requestId, method: "mc_accounts", target: CONTENT_TARGET }),
    ).toEqual({
      id: requestId,
      method: "mc_accounts",
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
    expect(
      toRuntimeMessage(
        { id: "1", method: "mc_status", params: { ignored: true } },
        "https://a.test",
      ),
    ).toBeNull();
    expect(
      toRuntimeMessage({ id: "6", method: "mc_accounts", params: [] }, "https://a.test"),
    ).toBeNull();
    expect(toRuntimeMessage({ id: "4", method: "mc_accounts" }, "https://a.test")).toEqual({
      origin: "https://a.test",
      type: "wallet.getGrantedAccounts",
    });
    expect(toRuntimeMessage({ id: "5", method: "mc_requestAccounts" }, "https://a.test")).toEqual({
      origin: "https://a.test",
      type: "wallet.requestAccounts",
    });
    expect(toRuntimeMessage({ id: "2", method: "wallet.signHash" }, "https://a.test")).toBeNull();
    expect(
      toRuntimeMessage({ id: "3", method: "wallet.createAccount" }, "https://a.test"),
    ).toBeNull();
  });

  test("creates page-targeted responses", () => {
    expect(
      providerResponse({ id: requestId, method: "mc_accounts" }, { result: accountResult }),
    ).toEqual({
      id: requestId,
      result: accountResult,
      target: PAGE_TARGET,
    });
    expect(
      providerResponse(
        { id: requestId, method: "mc_status" },
        { error: "wallet locked", result: { ready: true } },
      ),
    ).toEqual({
      error: "wallet locked",
      id: requestId,
      target: PAGE_TARGET,
    });
    expect(
      providerResponse({ id: requestId, method: "mc_status" }, { result: { ready: true } }),
    ).toEqual({
      error: "invalid provider response",
      id: requestId,
      target: PAGE_TARGET,
    });
    expect(providerResponse({ id: requestId, method: "mc_status" }, {})).toEqual({
      error: "invalid provider response",
      id: requestId,
      target: PAGE_TARGET,
    });
    expect(providerResponse({ id: requestId, method: "mc_status" }, { error: "" })).toEqual({
      error: "invalid provider response",
      id: requestId,
      target: PAGE_TARGET,
    });
  });

  test("reads exact page-targeted responses", () => {
    expect(
      readProviderResponse({ id: requestId, result: accountResult, target: PAGE_TARGET }),
    ).toEqual({
      id: requestId,
      result: accountResult,
      target: PAGE_TARGET,
    });
    expect(
      readProviderResponse({ error: "wallet locked", id: requestId, target: PAGE_TARGET }),
    ).toEqual({
      error: "wallet locked",
      id: requestId,
      target: PAGE_TARGET,
    });
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
      readProviderResponse({
        error: "wallet locked",
        id: requestId,
        result: true,
        target: PAGE_TARGET,
      }),
    ).toBeNull();
  });

  test("maps background errors to provider rejections", () => {
    expect(toProviderPayload({ error: "wallet locked" })).toEqual({ error: "wallet locked" });
    expect(toProviderPayload({ accounts: [], ok: true })).toEqual({
      result: { accounts: [], ok: true },
    });
    expect(toProviderPayload({ ok: true, signature: { r: "0x1", s: "0x2" } })).toEqual({
      error: "invalid provider response",
    });
  });

  test("accepts only exact provider account responses", () => {
    const sparseAccounts = new Array<unknown>(1);

    expect(toProviderPayload({ accounts: [account], ok: true })).toEqual({
      result: { accounts: [account], ok: true },
    });
    expect(toProviderPayload({ accounts: sparseAccounts, ok: true })).toEqual({
      error: "invalid provider response",
    });
    expect(
      toProviderPayload({ accounts: [{ ...account, privateKey: "0x456" }], ok: true }),
    ).toEqual({
      error: "invalid provider response",
    });
    expect(toProviderPayload({ accounts: [account], ok: true, signature: "0x123" })).toEqual({
      error: "invalid provider response",
    });
  });

  test("redacts pending approval internals from provider responses", () => {
    expect(
      toProviderPayload({
        ok: false,
        pending: { id: "123e4567-e89b-42d3-a456-426614174000", origin: "https://a.test" },
      }),
    ).toEqual({ error: "approval pending" });
  });
});
