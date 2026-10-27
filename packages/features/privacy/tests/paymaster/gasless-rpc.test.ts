/**
 * Gasless HTTP classification. A 503 screening_unavailable is retried and is
 * not a lost broadcast. Other lost execute replies are indeterminate. Stated
 * gateway codes, including relay JSON-RPC errors on HTTP 200, are refusals.
 */
import { describe, expect, test } from "bun:test";
import { GaslessRefusal } from "@bramble/privacy/gasless-errors";
import { GASLESS_RPC_ID, postGasless } from "@bramble/privacy/gasless-rpc";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";

const url = "https://wallet.example/api/paymaster/mainnet";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status });

const gateway = (status: number, code: string): Response => json(status, { error: code });

describe("postGasless", () => {
  test("returns a JSON-RPC result", async () => {
    const http = async () => json(200, { id: GASLESS_RPC_ID, jsonrpc: "2.0", result: true });
    await expect(
      postGasless(http, url, "paymaster_isAvailable", [], { executes: false }),
    ).resolves.toBe(true);
  });

  test("a lock during an execute retry refuses before the next broadcast", async () => {
    let calls = 0;
    let locked = false;
    const http = async () => {
      calls += 1;
      locked = true;
      return gateway(503, "screening_unavailable");
    };
    const error = await postGasless(
      http,
      url,
      "paymaster_executeTransaction",
      {},
      {
        executes: true,
        isAuthorized: () => !locked,
        sleep: async () => undefined,
      },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toBe("wallet locked");
    }
    expect(calls).toBe(1);
  });

  test("retries screening_unavailable and does not treat it as a lost broadcast", async () => {
    let calls = 0;
    const http = async () => {
      calls += 1;
      return calls < 3
        ? gateway(503, "screening_unavailable")
        : json(200, { id: GASLESS_RPC_ID, jsonrpc: "2.0", result: { transaction_hash: "0x1" } });
    };
    const sleep = async () => undefined;
    await expect(
      postGasless(http, url, "paymaster_executeTransaction", {}, { executes: true, sleep }),
    ).resolves.toEqual({ transaction_hash: "0x1" });
    expect(calls).toBe(3);
  });

  test("a spent screening_unavailable retry is determinate", async () => {
    const http = async () => gateway(503, "screening_unavailable");
    const error = await postGasless(
      http,
      url,
      "paymaster_executeTransaction",
      {},
      {
        executes: true,
        sleep: async () => undefined,
      },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GaslessRefusal);
    expect(error).not.toBeInstanceOf(IndeterminateRpcWriteError);
    if (error instanceof GaslessRefusal) {
      expect(error.code).toBe("screening_unavailable");
      expect(error.retryable).toBe(true);
    }
  });

  test("another 5xx on execute is a lost reply and is not retried", async () => {
    let calls = 0;
    const http = async () => {
      calls += 1;
      return gateway(502, "upstream_rejected");
    };
    const error = await postGasless(
      http,
      url,
      "paymaster_executeTransaction",
      {},
      {
        executes: true,
        sleep: async () => undefined,
      },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IndeterminateRpcWriteError);
    expect(calls).toBe(1);
  });

  test.each([
    [400, "invalid_gasless_request"],
    [403, "address_not_allowed"],
    [403, "screening_subject_unverifiable"],
    [403, "screening_denied"],
    [403, "screening_pending"],
    [400, "invalid_screening_transaction"],
    [404, "gasless_disabled"],
    [400, "upstream_rejected"],
  ] as const)("HTTP %s %s is a determinate refusal", async (status, code) => {
    let calls = 0;
    const http = async () => {
      calls += 1;
      return gateway(status, code);
    };
    const error = await postGasless(
      http,
      url,
      "paymaster_executeTransaction",
      {},
      {
        executes: true,
      },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GaslessRefusal);
    expect(error).not.toBeInstanceOf(IndeterminateRpcWriteError);
    if (error instanceof GaslessRefusal) {
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(false);
    }
    expect(calls).toBe(1);
  });

  test("an unreadable 4xx is a determinate refusal", async () => {
    const http = async () => new Response("nope", { status: 400 });
    const error = await postGasless(
      http,
      url,
      "paymaster_executeTransaction",
      {},
      {
        executes: true,
      },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GaslessRefusal);
    expect(error).not.toBeInstanceOf(IndeterminateRpcWriteError);
  });

  test("a relay JSON-RPC error on HTTP 200 is a determinate refusal", async () => {
    const http = async () =>
      json(200, {
        error: { code: -32000, data: "nope", message: "rejected" },
        id: GASLESS_RPC_ID,
        jsonrpc: "2.0",
      });
    const error = await postGasless(
      http,
      url,
      "paymaster_executeTransaction",
      {},
      {
        executes: true,
      },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GaslessRefusal);
    expect(error).not.toBeInstanceOf(IndeterminateRpcWriteError);
  });

  test("a transport failure on execute is a lost reply, and on a quote is not", async () => {
    const http = async () => {
      throw new Error("timeout");
    };
    const execute = await postGasless(
      http,
      url,
      "paymaster_executeTransaction",
      {},
      {
        executes: true,
      },
    ).catch((caught: unknown) => caught);
    const quote = await postGasless(
      http,
      url,
      "paymaster_buildTransaction",
      {},
      {
        executes: false,
      },
    ).catch((caught: unknown) => caught);
    expect(execute).toBeInstanceOf(IndeterminateRpcWriteError);
    expect(quote).toBeInstanceOf(GaslessRefusal);
    expect(quote).not.toBeInstanceOf(IndeterminateRpcWriteError);
  });
});
