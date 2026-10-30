/**
 * Gasless HTTP classification. A 503 screening_unavailable is retried and is
 * not a lost broadcast. On execute, only an allowlisted pre-forward code in
 * the gateway's own body is a determinate refusal; the same code inside a
 * relay's JSON-RPC error is indeterminate. Every other execute answer is
 * indeterminate. A quote never broadcasts, so its refusals stay determinate.
 */
import { describe, expect, test } from "bun:test";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@bramble/starknet/provider";
import { GaslessRefusal } from "@bramble/transactions/gasless-errors";
import { GASLESS_RPC_ID, postGasless } from "@bramble/transactions/gasless-rpc";

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
    [403, "screening_denied"],
    [404, "gasless_disabled"],
  ] as const)("HTTP %s %s is a determinate pre-forward refusal", async (status, code) => {
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
      expect(error.message).not.toContain("today");
    }
    expect(calls).toBe(1);
  });

  test.each([
    [403, "screening_subject_unverifiable"],
    [403, "screening_pending"],
    [400, "invalid_screening_transaction"],
    [400, "upstream_rejected"],
    [400, "some_other_code"],
  ] as const)("HTTP %s %s on execute is indeterminate", async (status, code) => {
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
    expect(error).toBeInstanceOf(IndeterminateRpcWriteError);
    expect(error).not.toBeInstanceOf(GaslessRefusal);
    if (error instanceof Error) {
      expect(error.message).toBe(INDETERMINATE_RPC_WRITE_MESSAGE);
      expect(error.message).not.toContain("Nothing was submitted");
    }
    expect(calls).toBe(1);
  });

  test("an unreadable 4xx on execute is indeterminate, and on a quote is a refusal", async () => {
    const http = async () => new Response("nope", { status: 400 });
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

  test("a malformed relay error on execute is indeterminate", async () => {
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
    expect(error).toBeInstanceOf(IndeterminateRpcWriteError);
    if (error instanceof Error) {
      expect(error.message).not.toContain("Nothing was submitted");
    }
  });

  test("a pre-forward code inside a relay error on execute is indeterminate", async () => {
    // The gateway passes a relay's 2xx reply through unchanged, so this shape
    // can come from a relay that already holds the signature.
    for (const code of [
      "address_not_allowed",
      "gasless_disabled",
      "invalid_gasless_request",
      "screening_denied",
      "screening_unavailable",
    ]) {
      const http = async () =>
        json(200, {
          error: { code: -32000, data: code, message: "rejected" },
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
      expect(error).toBeInstanceOf(IndeterminateRpcWriteError);
      if (error instanceof Error) {
        expect(error.message).not.toContain("Nothing was submitted");
      }
    }
  });

  test.each([
    "address_not_allowed",
    "gasless_disabled",
    "invalid_gasless_request",
    "screening_denied",
    "screening_unavailable",
  ])("a 2xx gateway-shaped %s on execute is indeterminate", async (code) => {
    // A relay's 2xx reply reaches the wallet unchanged, so the shape alone
    // does not show the gateway stopped before forwarding.
    let calls = 0;
    const http = async () => {
      calls += 1;
      return gateway(200, code);
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
    expect(error).toBeInstanceOf(IndeterminateRpcWriteError);
    expect(error).not.toBeInstanceOf(GaslessRefusal);
    expect(calls).toBe(1);
  });

  test("the same relay error on a quote stays a determinate refusal", async () => {
    const http = async () =>
      json(200, {
        error: { code: -32000, data: "invalid_gasless_request", message: "rejected" },
        id: GASLESS_RPC_ID,
        jsonrpc: "2.0",
      });
    const error = await postGasless(
      http,
      url,
      "paymaster_buildTransaction",
      {},
      { executes: false },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GaslessRefusal);
    if (error instanceof GaslessRefusal) {
      expect(error.code).toBe("invalid_gasless_request");
    }
  });

  test("an error beside a result on execute is indeterminate", async () => {
    const http = async () =>
      json(200, {
        error: { code: -32000, data: "invalid_gasless_request", message: "rejected" },
        id: GASLESS_RPC_ID,
        jsonrpc: "2.0",
        result: { transaction_hash: "0x1" },
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
    expect(error).toBeInstanceOf(IndeterminateRpcWriteError);
  });

  test("a quote of upstream_rejected stays a determinate refusal", async () => {
    const http = async () => gateway(400, "upstream_rejected");
    const error = await postGasless(
      http,
      url,
      "paymaster_buildTransaction",
      {},
      {
        executes: false,
      },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GaslessRefusal);
    expect(error).not.toBeInstanceOf(IndeterminateRpcWriteError);
    if (error instanceof GaslessRefusal) {
      expect(error.code).toBe("upstream_rejected");
      expect(error.message).toContain("Nothing was submitted");
    }
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
