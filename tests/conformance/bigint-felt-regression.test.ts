/**
 * Regression: a dapp that connects fine but then submits an on-chain action
 * carrying a bigint (or integer number) felt must NOT be dropped with "invalid
 * provider request". get-starknet forwards `request` args unserialized, so a
 * bigint amount/calldata reaches the bridge raw. This proves the real bridge
 * normalizes such felts and routes the invoke, that a genuinely malformed
 * payload still rejects with a spec code 114 (INVALID_REQUEST_PAYLOAD) error,
 * and that the connect-phase methods accept their spec optional params.
 */
import { describe, expect, test } from "bun:test";
import {
  readProviderRequestArguments,
  toRuntimeMessage,
  walletRpcException,
} from "../../src/provider/bridge";
import { invalidRequestPayload } from "../../src/shared/rpc-errors";
import { TOKEN } from "./spec-fixtures";
import { ORIGIN, REQUEST_ID } from "./wallet-rpc-spec";

describe("bigint felt regression", () => {
  test("accepts and normalizes an invoke carrying a bigint felt", () => {
    const accepted = readProviderRequestArguments({
      method: "wallet_addInvokeTransaction",
      params: {
        // 1000000n amount + a bigint recipient felt, as a dapp would pass them.
        invoke_transaction: [
          { calldata: [0x123n, 1000000n], contract_address: TOKEN, entry_point: "transfer" },
        ],
      },
    });
    expect(accepted).not.toBeNull();
    // The bigint felts are normalized to canonical 0x-hex strings.
    expect(accepted?.params).toEqual({
      invoke_transaction: [
        { calldata: ["0x123", "0xf4240"], contract_address: TOKEN, entry_point: "transfer" },
      ],
    });

    const routed = accepted ? toRuntimeMessage({ id: REQUEST_ID, ...accepted }, ORIGIN) : null;
    expect(routed).toEqual({
      calls: [{ calldata: ["0x123", "0xf4240"], contractAddress: TOKEN, entrypoint: "transfer" }],
      origin: ORIGIN,
      type: "wallet.addInvokeTransaction",
    });
  });

  test("accepts an integer-number calldata felt", () => {
    const accepted = readProviderRequestArguments({
      method: "wallet_addInvokeTransaction",
      params: {
        invoke_transaction: [{ calldata: [255], contract_address: TOKEN, entry_point: "transfer" }],
      },
    });
    const routed = accepted ? toRuntimeMessage({ id: REQUEST_ID, ...accepted }, ORIGIN) : null;
    expect(routed).toEqual({
      calls: [{ calldata: ["0xff"], contractAddress: TOKEN, entrypoint: "transfer" }],
      origin: ORIGIN,
      type: "wallet.addInvokeTransaction",
    });
  });

  test("a genuinely malformed invoke is dropped and the boundary codes it 114", () => {
    // A negative bigint is not a felt, so it is not normalized and the payload
    // stays non-JSON, which the wire gate rejects — the case the in-page request
    // boundary rejects with INVALID_REQUEST_PAYLOAD.
    expect(
      readProviderRequestArguments({
        method: "wallet_addInvokeTransaction",
        params: {
          invoke_transaction: [
            { calldata: [-1n], contract_address: TOKEN, entry_point: "transfer" },
          ],
        },
      }),
    ).toBeNull();
    // An unknown top-level key is likewise malformed.
    expect(
      readProviderRequestArguments({ debug: true, method: "wallet_addInvokeTransaction" }),
    ).toBeNull();

    // The spec-coded error the in-page boundary now rejects with (code 114).
    const rejection = walletRpcException(invalidRequestPayload("invalid provider request"));
    expect((rejection as { code?: number }).code).toBe(114);
    expect((rejection as { data?: string }).data).toBe("invalid provider request");
    expect(rejection.message.length).toBeGreaterThan(0);
  });

  test("connect-phase methods accept their spec optional params", () => {
    expect(
      toRuntimeMessage(
        { id: REQUEST_ID, method: "wallet_requestAccounts", params: { silent_mode: true } },
        ORIGIN,
      ),
    ).toEqual({ origin: ORIGIN, type: "wallet.requestAccounts" });
    expect(
      toRuntimeMessage(
        { id: REQUEST_ID, method: "wallet_requestChainId", params: { api_version: "0.7.2" } },
        ORIGIN,
      ),
    ).toEqual({ origin: ORIGIN, type: "wallet.getChainId" });
    expect(
      toRuntimeMessage(
        { id: REQUEST_ID, method: "wallet_getPermissions", params: { api_version: "0.7.2" } },
        ORIGIN,
      ),
    ).toEqual({ origin: ORIGIN, type: "wallet.getPermissions" });

    // Junk params on a connect method are still refused rather than routed.
    expect(
      toRuntimeMessage(
        { id: REQUEST_ID, method: "wallet_requestAccounts", params: { unexpected_key: "boom" } },
        ORIGIN,
      ),
    ).toBeNull();
  });
});
