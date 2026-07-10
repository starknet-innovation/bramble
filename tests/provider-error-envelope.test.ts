/**
 * Wallet_rpc error-envelope checks: every dapp rejection crosses the bridge as
 * a spec `{ code, message, data? }` object, survives the response round-trip,
 * and reconstructs into a coded Error the in-page provider can reject with.
 */
import { describe, expect, test } from "bun:test";
import {
  PAGE_TARGET,
  type ProviderRequest,
  providerResponse,
  readProviderResponse,
  toProviderPayload,
  walletRpcException,
} from "../src/provider/bridge";
import { invalidRequestPayload, unknownError, userRefusedOp } from "../src/shared/rpc-errors";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const request: ProviderRequest = { id: requestId, method: "wallet_addInvokeTransaction" };

describe("wallet_rpc error envelope", () => {
  test("a held-request deny reaches the dapp as USER_REFUSED_OP (113)", () => {
    // Background settles a denied held request with the "request rejected" string.
    const payload = toProviderPayload({ error: "request rejected" }, "wallet_addInvokeTransaction");
    expect(payload).toEqual({ error: userRefusedOp() });

    const response = providerResponse(request, payload);
    const read = readProviderResponse(response);
    expect(read).not.toBeNull();
    expect(read?.error?.code).toBe(113);

    // The in-page provider rejects with a coded Error carrying .code === 113.
    const rejection = read?.error ? walletRpcException(read.error) : new Error("unreachable");
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as { code?: number }).code).toBe(113);
    expect(rejection.message).toBe("The user refused the operation");
  });

  test("connection denial also maps to USER_REFUSED_OP (113)", () => {
    expect(toProviderPayload({ error: "connection rejected" })).toEqual({ error: userRefusedOp() });
  });

  test("the content-script unsupported-method path emits a spec error object", () => {
    // src/content/index.ts posts providerResponse(request, { error: invalidRequestPayload() }).
    const response = providerResponse(request, { error: invalidRequestPayload() });
    expect(response).toEqual({
      error: invalidRequestPayload(),
      id: requestId,
      target: PAGE_TARGET,
    });

    // readProviderResponse accepts the object, so the in-page promise rejects
    // instead of hanging forever on a dropped raw-string error.
    const read = readProviderResponse(response);
    expect(read).not.toBeNull();
    expect(read?.error?.code).toBe(114);
  });

  test("the content-script transport-failure path emits UNKNOWN_ERROR (163)", () => {
    const response = providerResponse(request, { error: unknownError() });
    const read = readProviderResponse(response);
    expect(read?.error?.code).toBe(163);
  });

  test("a raw string error is not a valid wire error and is dropped", () => {
    expect(
      readProviderResponse({ error: "request rejected", id: requestId, target: PAGE_TARGET }),
    ).toBeNull();
  });

  test("walletRpcException preserves an optional data field", () => {
    const rejection = walletRpcException({ code: 117, data: "SN_GOERLI", message: "bad chain" });
    expect(rejection.message).toBe("bad chain");
    expect((rejection as { code?: number }).code).toBe(117);
    expect((rejection as { data?: string }).data).toBe("SN_GOERLI");
  });
});
