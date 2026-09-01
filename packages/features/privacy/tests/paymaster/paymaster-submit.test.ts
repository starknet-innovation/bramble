/** Submission-side privacy-paymaster contract tests. */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@mc-wallet/core/errors";
import { buildStrk20PaymasterPlan, submitStrk20PaymasterPlan } from "@mc-wallet/privacy/paymaster";
import { STRK20_SUBMISSION_UNAVAILABLE } from "@mc-wallet/privacy/service";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@mc-wallet/starknet/provider";
import {
  paymasterCall as call,
  paymasterChainId as chainId,
  paymasterConfig as config,
  paymasterTypedData as outsideTypedData,
  paymasterResponse as response,
} from "../support/paymaster";

// The injected transport shape both paymaster entry points accept.
type PaymasterHttp = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe("STRK20 paymaster submission boundary", () => {
  test("submits the frozen proof and validates the returned transaction hash", async () => {
    const requests: Record<string, unknown>[] = [];
    const result = await submitStrk20PaymasterPlan({
      accountAddress: "0x1",
      call,
      config,
      http: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return response({ transaction_hash: "0x123" });
      },
      nowSeconds: 2,
      plan: {
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
      },
      proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
      signTypedData: async () => {
        throw new Error("no public approval signature expected");
      },
    });
    expect(result).toEqual({ transactionHash: "0x123" });
    expect(requests[0]?.["method"]).toBe("paymaster_executeTransaction");
  });

  test("signs exactly the frozen typed data for public token approvals", async () => {
    const typedData = outsideTypedData();
    let signed: unknown;
    let submitted: Record<string, unknown> | undefined;
    await submitStrk20PaymasterPlan({
      accountAddress: "0x1",
      call,
      config,
      http: async (_url, init) => {
        submitted = JSON.parse(String(init?.body));
        return response({ transaction_hash: "0x123" });
      },
      nowSeconds: 2,
      plan: {
        authorization: {
          caller: "0x99",
          executeAfter: "0x1",
          executeBefore: "0x100",
          publicCallCount: 1,
        },
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
        typedData,
      },
      proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
      signTypedData: async (value) => {
        signed = value;
        return ["0x6", "0x7"];
      },
    });
    expect(signed).toBe(typedData);
    expect(submitted?.["params"]).toMatchObject({
      transaction: {
        invoke: { signature: ["0x6", "0x7"], typed_data: typedData, user_address: "0x1" },
        type: "invoke_and_apply_action",
      },
    });
  });

  test("rejects incomplete public authorization plans before signing or submitting", async () => {
    const authorization = {
      caller: "0x99",
      executeAfter: "0x1",
      executeBefore: "0x100",
      publicCallCount: 1,
    } as const;
    for (const plan of [
      {
        authorization,
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" as const },
      },
      {
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" as const },
        typedData: outsideTypedData(),
      },
    ]) {
      let signed = false;
      let submitted = false;
      await expect(
        submitStrk20PaymasterPlan({
          accountAddress: "0x1",
          call,
          config,
          http: async () => {
            submitted = true;
            return response({ transaction_hash: "0x123" });
          },
          nowSeconds: 2,
          plan,
          proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
          signTypedData: async () => {
            signed = true;
            return ["0x6", "0x7"];
          },
        }),
      ).rejects.toThrow("strk20 private submission unavailable");
      expect(signed).toBe(false);
      expect(submitted).toBe(false);
    }
  });

  test("rejects a plan that expires after quote without signing or submitting", async () => {
    let signed = false;
    let submitted = false;
    await expect(
      submitStrk20PaymasterPlan({
        accountAddress: "0x1",
        call,
        config,
        http: async () => {
          submitted = true;
          return response({ transaction_hash: "0x123" });
        },
        nowSeconds: 250,
        plan: {
          authorization: {
            caller: "0x99",
            executeAfter: "0x1",
            executeBefore: "0x100",
            publicCallCount: 1,
          },
          feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
          typedData: outsideTypedData(),
        },
        proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
        signTypedData: async () => {
          signed = true;
          return ["0x6", "0x7"];
        },
      }),
    ).rejects.toThrow("strk20 private submission unavailable");
    expect(signed).toBe(false);
    expect(submitted).toBe(false);
  });

  /**
   * EXT-M2. The relay lane reaches its node through this file's own HTTP client
   * rather than through `withRpcWrite`, so nothing upstream can tell an answer
   * the wallet could not read apart from a refusal the relay stated. Collapsing
   * both to a flat `WalletError` told the maturity scope that the write was
   * determinately rejected, so it released the `submitting` guard over a
   * transaction the relay may already have forwarded — and the next private
   * action proved against note state a landed write would have invalidated.
   *
   * The line drawn here: once `paymaster_executeTransaction` has left the
   * wallet, only an answer the relay states for itself is determinate.
   */
  const submitWith = async (http: PaymasterHttp): Promise<unknown> =>
    submitStrk20PaymasterPlan({
      accountAddress: "0x1",
      call,
      config,
      http,
      nowSeconds: 2,
      plan: {
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
      },
      proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
      signTypedData: async () => [],
    }).then(
      () => null,
      (error: unknown) => error,
    );

  test("keeps a broadcast whose answer was lost ambiguous, and a stated refusal determinate", async () => {
    const lost: readonly PaymasterHttp[] = [
      // Declared past the response budget: refused before a byte is read.
      async () =>
        new Response("{}", {
          headers: { "content-length": String(1024 * 1024 + 1) },
          status: 200,
        }),
      // Answered, but not with JSON.
      async () => new Response("not json", { status: 200 }),
      // A JSON-RPC envelope the client cannot interpret.
      async () =>
        new Response(JSON.stringify({ id: "mc-wallet-strk20", jsonrpc: "2.0", surprise: 1 }), {
          status: 200,
        }),
      // A well-formed envelope carrying neither a result nor an error.
      async () =>
        new Response(JSON.stringify({ id: "mc-wallet-strk20", jsonrpc: "2.0" }), { status: 200 }),
      // A result the relay accepted, with no usable handle on it.
      async () => response({ transaction_hash: "not-a-hash" }),
      // This client's own deadline ended the exchange after the request went out.
      async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    ];
    for (const http of lost) {
      const rejected = await submitWith(http);
      expect(rejected).toBeInstanceOf(IndeterminateRpcWriteError);
      // Curated, shared with the JSON-RPC lane, and carrying nothing of the
      // relay's answer.
      expect((rejected as Error).message).toBe(INDETERMINATE_RPC_WRITE_MESSAGE);
    }

    // The counterweight: over-correcting into "hold the scope on every relay
    // failure" would strand a caller behind a stale `submitting` guard after an
    // ordinary refusal, so a relay that answers for itself stays determinate.
    const stated: readonly PaymasterHttp[] = [
      async () => new Response("unavailable", { status: 503 }),
      async () =>
        new Response(
          JSON.stringify({
            error: { code: -32_000, message: "failed" },
            id: "mc-wallet-strk20",
            jsonrpc: "2.0",
          }),
          { status: 200 },
        ),
      // No exchange took place at all: DNS, a refused connection, a refused
      // redirect. Nothing was broadcast.
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ];
    for (const http of stated) {
      const rejected = await submitWith(http);
      expect(rejected).toBeInstanceOf(WalletError);
      expect(rejected).not.toBeInstanceOf(IndeterminateRpcWriteError);
      expect((rejected as Error).message).toContain("strk20 private submission unavailable");
    }
  });

  test("leaves quote failures determinate — a quote never broadcasts anything", async () => {
    // `paymaster_buildTransaction` runs before the maturity scope is closed and
    // puts nothing on the wire, so the same lost answer must NOT mint the
    // ambiguity marker there or a bad quote would strand the scope.
    for (const http of [
      async () =>
        new Response("{}", {
          headers: { "content-length": String(1024 * 1024 + 1) },
          status: 200,
        }),
      async () => new Response("not json", { status: 200 }),
    ] satisfies readonly PaymasterHttp[]) {
      const rejected = await buildStrk20PaymasterPlan({
        accountAddress: "0x1",
        approveCalls: [],
        chainId,
        config,
        expectedFeeAmount: 5n,
        http,
        nowSeconds: 2,
        poolAddress: "0x2",
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(rejected).toBeInstanceOf(WalletError);
      expect(rejected).not.toBeInstanceOf(IndeterminateRpcWriteError);
      expect((rejected as Error).message).toBe(STRK20_SUBMISSION_UNAVAILABLE);
    }
  });

  test("never exposes proof material echoed by the relay", async () => {
    const rejected = await submitStrk20PaymasterPlan({
      accountAddress: "0x1",
      call,
      config,
      http: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: -32_000,
              data: { execution_error: "proof proof_facts 0x2" },
              message: "rejected proof",
            },
            id: "mc-wallet-strk20",
            jsonrpc: "2.0",
          }),
          { status: 200 },
        ),
      nowSeconds: 2,
      plan: {
        feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
      },
      proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
      signTypedData: async () => [],
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toBe(STRK20_SUBMISSION_UNAVAILABLE);
  });
});
