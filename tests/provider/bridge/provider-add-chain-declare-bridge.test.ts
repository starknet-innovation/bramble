/**
 * Provider-bridge wire mapping for wallet_addStarknetChain and
 * wallet_addDeclareTransaction: valid params map to safe runtime messages,
 * malformed params map to nothing (INVALID_REQUEST_PAYLOAD at the content
 * boundary), denials map to USER_REFUSED_OP, and declare results are padded to
 * their spec widths.
 */
import { describe, expect, test } from "bun:test";
import {
  type ProviderRequest,
  providerResponse,
  toRuntimeMessage,
} from "@bramble/wallet-protocol/bridge";
import { toProviderPayload } from "@bramble/wallet-protocol/results";

const origin = "https://dapp.example";
const requestId = "123e4567-e89b-42d3-a456-426614174000";

const request = (method: ProviderRequest["method"], params: unknown): ProviderRequest =>
  ({ id: requestId, method, params }) as ProviderRequest;

const chainParams = {
  chain_id: "0x534e5f4b4154414e41",
  chain_name: "Katana",
  id: "katana",
  rpc_urls: ["https://rpc.katana.example"],
};

const declareParams = {
  declare_transaction: {
    class_hash: "0x5abc",
    compiled_class_hash: "0x6def",
    contract_class: { sierra_program: ["0x1"] },
  },
};

describe("wallet_addStarknetChain bridge mapping", () => {
  test("maps valid params to a safe runtime message", () => {
    expect(toRuntimeMessage(request("wallet_addStarknetChain", chainParams), origin)).toEqual({
      chain: {
        chainId: "0x534e5f4b4154414e41",
        chainName: "Katana",
        id: "katana",
        rpcUrls: ["https://rpc.katana.example"],
      },
      origin,
      type: "wallet.addStarknetChain",
    });
  });

  test("rejects malformed chain params", () => {
    expect(
      toRuntimeMessage(request("wallet_addStarknetChain", { chain_name: "x" }), origin),
    ).toBeNull();
  });

  test("accepts the optional api_version beside the chain fields and drops it", () => {
    const expected = toRuntimeMessage(request("wallet_addStarknetChain", chainParams), origin);
    for (const api_version of ["0.10", "0.10.4", "0.10.4-rc.0"]) {
      expect(
        toRuntimeMessage(
          request("wallet_addStarknetChain", { ...chainParams, api_version }),
          origin,
        ),
      ).toEqual(expected);
    }
  });

  test("rejects a malformed api_version", () => {
    for (const api_version of ["not.a.version.x", "", "v0.10.4", 10, null]) {
      expect(
        toRuntimeMessage(
          request("wallet_addStarknetChain", { ...chainParams, api_version }),
          origin,
        ),
      ).toBeNull();
    }
  });

  test("maps an added result to a boolean true", () => {
    expect(toProviderPayload({ added: true, ok: true }, "wallet_addStarknetChain")).toEqual({
      result: true,
    });
  });

  test("maps a denial to USER_REFUSED_OP (113)", () => {
    const payload = toProviderPayload({ error: "request rejected" }, "wallet_addStarknetChain");
    expect(payload.error?.code).toBe(113);
  });
});

describe("wallet_addDeclareTransaction bridge mapping", () => {
  test("maps valid params to a safe runtime message", () => {
    expect(
      toRuntimeMessage(request("wallet_addDeclareTransaction", declareParams), origin),
    ).toEqual({
      declare: {
        classHash: "0x5abc",
        compiledClassHash: "0x6def",
        contractClass: { sierra_program: ["0x1"] },
      },
      origin,
      type: "wallet.addDeclareTransaction",
    });
  });

  test("accepts the optional top-level api_version and drops it", () => {
    const expected = toRuntimeMessage(
      request("wallet_addDeclareTransaction", declareParams),
      origin,
    );
    for (const api_version of ["0.10", "0.10.4", "0.10.4-rc.0"]) {
      expect(
        toRuntimeMessage(
          request("wallet_addDeclareTransaction", { ...declareParams, api_version }),
          origin,
        ),
      ).toEqual(expected);
    }
  });

  test("rejects a malformed api_version, or one nested inside the declare", () => {
    for (const api_version of ["not.a.version.x", "", "v0.10.4", 10, null]) {
      expect(
        toRuntimeMessage(
          request("wallet_addDeclareTransaction", { ...declareParams, api_version }),
          origin,
        ),
      ).toBeNull();
    }
    expect(
      toRuntimeMessage(
        request("wallet_addDeclareTransaction", {
          declare_transaction: { ...declareParams.declare_transaction, api_version: "0.10.4" },
        }),
        origin,
      ),
    ).toBeNull();
  });

  test("rejects a declare missing its contract class", () => {
    expect(
      toRuntimeMessage(
        request("wallet_addDeclareTransaction", {
          declare_transaction: { compiled_class_hash: "0x6def" },
        }),
        origin,
      ),
    ).toBeNull();
  });

  test("rejects declare hashes outside the canonical Stark-field grammar", () => {
    for (const compiledClassHash of [`0x${"f".repeat(64)}`, "0xABC"]) {
      expect(
        toRuntimeMessage(
          request("wallet_addDeclareTransaction", {
            declare_transaction: {
              compiled_class_hash: compiledClassHash,
              contract_class: { sierra_program: ["0x1"] },
            },
          }),
          origin,
        ),
      ).toBeNull();
    }
  });

  test("pads the declare transaction and class hashes to spec widths", () => {
    const payload = toProviderPayload(
      { classHash: "0x5abc", ok: true, transactionHash: "0x7cd" },
      "wallet_addDeclareTransaction",
    );
    const result = payload.result as { class_hash: string; transaction_hash: string };
    expect(result.transaction_hash).toMatch(/^0x0[0-8][0-9a-f]{62}$/);
    expect(result.class_hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(BigInt(result.transaction_hash)).toBe(0x7cdn);
    expect(BigInt(result.class_hash)).toBe(0x5abcn);
  });

  test("builds a page response carrying the padded declare result", () => {
    const payload = toProviderPayload(
      { classHash: "0x5abc", ok: true, transactionHash: "0x7cd" },
      "wallet_addDeclareTransaction",
    );
    const response = providerResponse(
      request("wallet_addDeclareTransaction", declareParams),
      payload,
    );
    expect(response).toMatchObject({
      id: requestId,
      result: { class_hash: expect.any(String), transaction_hash: expect.any(String) },
    });
  });

  test("maps a denial to USER_REFUSED_OP (113)", () => {
    const payload = toProviderPayload(
      { error: "request rejected" },
      "wallet_addDeclareTransaction",
    );
    expect(payload.error?.code).toBe(113);
  });
});
