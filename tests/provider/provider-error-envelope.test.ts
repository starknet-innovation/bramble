/**
 * Wallet_rpc error-envelope checks: every dapp rejection crosses the bridge as
 * a spec `{ code, message, data? }` object, survives the response round-trip,
 * and reconstructs into a coded Error the in-page provider can reject with.
 * Includes the redaction invariant: an internal message carrying a node-supplied
 * failure reason is never pattern-matched and never leaves the wallet.
 */
import { describe, expect, test } from "bun:test";
import {
  PAGE_TARGET,
  type ProviderRequest,
  providerResponse,
  readProviderResponse,
  toProviderPayload,
  walletRpcException,
} from "../../src/provider/bridge";
import { invalidRequestPayload, unknownError, userRefusedOp } from "../../src/shared/rpc-errors";
import { RPC_FAILURE_PREFIX } from "../../src/shared/rpc-failure";

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

  test("malformed and invalid messages map to INVALID_REQUEST_PAYLOAD (114)", () => {
    expect(toProviderPayload({ error: "Invalid transaction payload" })).toEqual({
      error: invalidRequestPayload(),
    });
    expect(toProviderPayload({ error: "Request is malformed" })).toEqual({
      error: invalidRequestPayload(),
    });
    expect(toProviderPayload({ error: "Request origin mismatch" })).toEqual({
      error: invalidRequestPayload(),
    });
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

  test("a node-supplied failure reason never reaches the dapp", () => {
    // The extension UI shows the real reason (that is the point of the mapping
    // in src/shared/rpc-failure.ts); the dapp must still get only UNKNOWN_ERROR.
    const internal = `${RPC_FAILURE_PREFIX} (RPC error 41): Insufficient max L2Gas: max amount: 1200000000, actual used: 1378435600.`;
    const payload = toProviderPayload({ error: internal }, "wallet_addInvokeTransaction");

    expect(payload).toEqual({ error: unknownError() });
    expect(JSON.stringify(payload)).not.toContain("L2Gas");

    // Reason text is arbitrary chain data. Whatever keyword a contract puts in
    // it, the message stays generic and the code stays 163 — a revert must not
    // be re-coded as a user refusal or a registration error.
    for (const reason of ["ERC20: transfer rejected", "Account is not registered", "invalid nonce"])
      expect(
        toProviderPayload({ error: `${RPC_FAILURE_PREFIX} (RPC error 41): ${reason}` }),
      ).toEqual({ error: unknownError() });
  });

  test("walletRpcException preserves an optional data field", () => {
    const rejection = walletRpcException({ code: 117, data: "SN_GOERLI", message: "bad chain" });
    expect(rejection.message).toBe("bad chain");
    expect((rejection as { code?: number }).code).toBe(117);
    expect((rejection as { data?: string }).data).toBe("SN_GOERLI");
  });
});

// Pins the behavior of the private mappers the payload/response builders were
// decomposed into, especially the cases where the two builders deliberately
// diverge or where the original if-chain's fall-through order is observable.
describe("provider bridge decomposition invariants", () => {
  const chainIdResult = { chainId: "0x534e5f5345504f4c4941", ok: true } as const;

  test("a rejected { ok: false, pending } envelope maps to UNKNOWN_ERROR", () => {
    expect(
      toProviderPayload({ ok: false, pending: { id: 1 } }, "wallet_addInvokeTransaction"),
    ).toEqual({ error: unknownError() });
  });

  test("readProviderResponse drops a bare false result that providerResponse keeps", () => {
    // The result reader treats a falsy result as absent (original behavior),
    // while the content-side builder passes a literal `false` through.
    const built = providerResponse(request, { result: false });
    expect(built).toEqual({ id: requestId, result: false, target: PAGE_TARGET });
    expect(readProviderResponse({ id: requestId, result: false, target: PAGE_TARGET })).toBeNull();
  });

  test("a chain-id-shaped result under a fall-through method yields the chain id", () => {
    // The chain-id branch precedes the accounts tail for every late method, so a
    // chain-id envelope short-circuits to the id string even for mc_accounts.
    expect(toProviderPayload(chainIdResult, "mc_accounts")).toEqual({
      result: chainIdResult.chainId,
    });
    expect(toProviderPayload(chainIdResult, "wallet_requestChainId")).toEqual({
      result: chainIdResult.chainId,
    });
  });

  test("switch reports success (not the id) for a chain-id result", () => {
    expect(toProviderPayload(chainIdResult, "wallet_switchStarknetChain")).toEqual({
      result: true,
    });
  });

  test("an unmapped result shape falls through to the accounts tail's UNKNOWN_ERROR", () => {
    expect(toProviderPayload({ transactionHash: 42 }, "wallet_addInvokeTransaction")).toEqual({
      error: unknownError(),
    });
    expect(toProviderPayload({ transactionHash: "0x1" }, "wallet_addDeclareTransaction")).toEqual({
      error: unknownError(),
    });
  });
});
