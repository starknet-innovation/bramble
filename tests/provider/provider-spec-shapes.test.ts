/**
 * Spec-exact dapp-wire shape checks: snake_case INVOKE_CALL / invoke_transaction
 * mapping, back-compat with the legacy { calls } param, PADDED_TXN_HASH padding,
 * and the typed_data param wrapper for wallet_signTypedData.
 */
import { describe, expect, test } from "bun:test";
import { toProviderPayload, toRuntimeMessage } from "@mc-wallet/wallet-protocol/bridge";
import { padFelt } from "@mc-wallet/wallet-protocol/results";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const call = { calldata: ["0x1"], contractAddress: "0x123", entrypoint: "transfer" };

describe("spec-exact dapp shapes", () => {
  test("accepts the spec snake_case invoke_transaction param", () => {
    expect(
      toRuntimeMessage(
        {
          id: requestId,
          method: "wallet_addInvokeTransaction",
          params: {
            invoke_transaction: [
              { calldata: ["0x1"], contract_address: "0x123", entry_point: "transfer" },
            ],
          },
        },
        "https://a.test",
      ),
    ).toEqual({ calls: [call], origin: "https://a.test", type: "wallet.addInvokeTransaction" });
  });

  test("still accepts the legacy camelCase calls param", () => {
    expect(
      toRuntimeMessage(
        { id: requestId, method: "wallet_addInvokeTransaction", params: { calls: [call] } },
        "https://a.test",
      ),
    ).toEqual({ calls: [call], origin: "https://a.test", type: "wallet.addInvokeTransaction" });
  });

  test("supports an invoke call with no calldata", () => {
    expect(
      toRuntimeMessage(
        {
          id: requestId,
          method: "wallet_addInvokeTransaction",
          params: { invoke_transaction: [{ contract_address: "0x9", entry_point: "ping" }] },
        },
        "https://a.test",
      ),
    ).toEqual({
      calls: [{ calldata: [], contractAddress: "0x9", entrypoint: "ping" }],
      origin: "https://a.test",
      type: "wallet.addInvokeTransaction",
    });
  });

  test("rejects malformed invoke params and both-shape params", () => {
    expect(
      toRuntimeMessage(
        {
          id: requestId,
          method: "wallet_addInvokeTransaction",
          params: { invoke_transaction: [{ entry_point: "transfer" }] },
        },
        "https://a.test",
      ),
    ).toBeNull();
    expect(
      toRuntimeMessage(
        {
          id: requestId,
          method: "wallet_addInvokeTransaction",
          params: { calls: [call], invoke_transaction: [call] },
        },
        "https://a.test",
      ),
    ).toBeNull();
  });

  test("pads the returned transaction hash to a PADDED_TXN_HASH", () => {
    const payload = toProviderPayload(
      { ok: true, transactionHash: "0xabc" },
      "wallet_addInvokeTransaction",
    );
    expect(payload).toEqual({ result: { transaction_hash: `0x${"abc".padStart(64, "0")}` } });
    const hash = (payload.result as { transaction_hash: string }).transaction_hash;
    expect(/^0x0[0-8][0-9a-f]{62}$/.test(hash)).toBe(true);
  });

  test("preserves a spec-conforming invoke proof for reviewed private submission", () => {
    const proof = { data: "proof", output: ["0x1"], proof_facts: ["0x2"] };
    expect(
      toRuntimeMessage(
        {
          id: requestId,
          method: "wallet_addInvokeTransaction",
          params: {
            invoke_transaction: [
              { calldata: ["0x1"], contract_address: "0x123", entry_point: "transfer" },
            ],
            proof,
          },
        },
        "https://a.test",
      ),
    ).toEqual({
      calls: [call],
      origin: "https://a.test",
      proof,
      type: "wallet.addInvokeTransaction",
    });
  });

  test("accepts wallet_switchStarknetChain with the optional silent_mode param", () => {
    expect(
      toRuntimeMessage(
        {
          id: requestId,
          method: "wallet_switchStarknetChain",
          params: { chainId: "0x534e5f4d41494e", silent_mode: true },
        },
        "https://a.test",
      ),
    ).toEqual({
      chainId: "0x534e5f4d41494e",
      origin: "https://a.test",
      type: "wallet.switchChain",
    });
  });

  test("accepts the spec typed_data wrapper and a bare typed-data object", () => {
    const typedData = { domain: {}, message: {}, primaryType: "Mail", types: {} };
    expect(
      toRuntimeMessage(
        { id: requestId, method: "wallet_signTypedData", params: { typed_data: typedData } },
        "https://a.test",
      ),
    ).toEqual({ origin: "https://a.test", typedData, type: "wallet.signTypedData" });
    expect(
      toRuntimeMessage(
        { id: requestId, method: "wallet_signTypedData", params: typedData },
        "https://a.test",
      ),
    ).toEqual({ origin: "https://a.test", typedData, type: "wallet.signTypedData" });
  });
});

describe("padFelt", () => {
  test("left-pads a short felt to 0x + 64 hex", () => {
    expect(padFelt("0xabc")).toBe(`0x${"abc".padStart(64, "0")}`);
    expect(padFelt("0x0")).toBe(`0x${"0".padStart(64, "0")}`);
  });

  test("rejects a non-hex value or one wider than 256 bits", () => {
    expect(padFelt("nope")).toBeNull();
    expect(padFelt(`0x1${"f".repeat(64)}`)).toBeNull();
  });
});
