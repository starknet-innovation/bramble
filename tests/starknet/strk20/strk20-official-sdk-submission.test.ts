/**
 * Official privacy-SDK submission tests. The deterministic runtime double
 * verifies registration, approval, and proof boundaries without live services.
 */
import { describe, expect, test } from "bun:test";
import type { Call } from "starknet";
import { num } from "starknet";
import { WalletError } from "../../../src/shared/errors";
import { STARK_FIELD_PRIME, STRK_TOKEN_ADDRESS } from "../../../src/starknet/networks";
import { memoryStrk20MaturityStore } from "../../../src/starknet/strk20/maturity";
import { createOfficialStrk20Service } from "../../../src/starknet/strk20/official-sdk-service";
import {
  STRK20_SDK_ACCOUNT as account,
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  type OfficialBuilder,
  STRK20_POOL_ADDRESS as poolAddress,
  providerFor,
  sdkRuntime as runtime,
  strk20ProviderFor,
  STRK20_SDK_TOKEN as token,
} from "../../support/strk20-official-sdk";

const scope = {
  accountId: account.id,
  networkId: account.networkId,
  poolAddress,
};

const rateLimitError = (): Error =>
  Object.assign(new Error("RPC request failed"), {
    baseError: { code: -32_005, data: null, message: "rate limit exceeded" },
  });

describe("official STRK20 SDK submission boundary", () => {
  test("submits only a non-empty proof to the configured apply_actions call", async () => {
    const submitted: Call[] = [];
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({
      providerFor,
      sdk,
      async submitInvoke(input) {
        submitted.push(...input.calls);
        return { calls: input.calls, transactionHash: "0x123" };
      },
    });
    const proof = { data: "proof", output: ["0x1"], proof_facts: ["0x2"] };
    await expect(
      service.submitPrepared({
        ...context,
        call: { calldata: ["0x1"], contractAddress: poolAddress, entrypoint: "apply_actions" },
        proof,
      }),
    ).resolves.toEqual({ transactionHash: "0x123" });
    await expect(
      service.submitPrepared({
        ...context,
        call: { calldata: [], contractAddress: "0x999", entrypoint: "apply_actions" },
        proof,
      }),
    ).rejects.toThrow("strk20 private submission unavailable");
    expect(submitted).toHaveLength(1);
  });

  test("registers through the SDK builder and submits only the reviewed pool proof", async () => {
    let registerCalls = 0;
    const submitted: unknown[] = [];
    const sdk = runtime(() => {
      const base = builder(executeResult());
      const instrumented = {
        ...base,
        register() {
          registerCalls += 1;
          return instrumented;
        },
      } as unknown as OfficialBuilder;
      return {
        build: () => instrumented,
        async discoverNotes() {
          return { notes: new Map() };
        },
        executeWithInvocation: async () => executeResult(),
      };
    });
    const service = createOfficialStrk20Service({
      providerFor,
      sdk,
      async submitInvoke(input) {
        submitted.push(input);
        return { calls: input.calls, transactionHash: "0xabc" };
      },
    });

    await expect(service.register?.({ ...context, poolFeeFri: "0x0" })).resolves.toEqual({
      transactionHash: "0xabc",
    });
    expect(registerCalls).toBe(1);
    expect(submitted).toEqual([
      {
        account,
        calls: [
          {
            calldata: ["0x1"],
            contractAddress: poolAddress,
            entrypoint: "apply_actions",
          },
        ],
        proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
        rpcUrls: context.rpcUrls,
        signHash: expect.any(Function),
      },
    ]);
  });

  test("retries rate-limited registration proofs before any broadcast", async () => {
    let proofAttempts = 0;
    const pauses: number[] = [];
    const submitted: unknown[] = [];
    const sdk = runtime(() => {
      const base = builder(executeResult());
      const instrumented = {
        ...base,
        async createProofInvocation() {
          proofAttempts += 1;
          if (proofAttempts < 3) {
            throw rateLimitError();
          }
          return { warnings: [] };
        },
        register() {
          return instrumented;
        },
      } as unknown as OfficialBuilder;
      return {
        build: () => instrumented,
        async discoverNotes() {
          return { notes: new Map() };
        },
        executeWithInvocation: async () => executeResult(),
      };
    });
    const service = createOfficialStrk20Service({
      pauseForServiceRetry: async (attempt) => {
        pauses.push(attempt);
      },
      providerFor,
      sdk,
      async submitInvoke(input) {
        submitted.push(input);
        return { calls: input.calls, transactionHash: "0xabc" };
      },
    });

    await expect(service.register?.({ ...context, poolFeeFri: "0x0" })).resolves.toEqual({
      transactionHash: "0xabc",
    });
    expect(proofAttempts).toBe(3);
    expect(pauses).toEqual([1, 2]);
    expect(submitted).toHaveLength(1);
  });

  test("bounds registration retries and never broadcasts after persistent throttling", async () => {
    let proofAttempts = 0;
    const pauses: number[] = [];
    let submitted = false;
    const sdk = runtime(() => {
      const base = builder(executeResult());
      const instrumented = {
        ...base,
        async createProofInvocation() {
          proofAttempts += 1;
          throw rateLimitError();
        },
        register() {
          return instrumented;
        },
      } as unknown as OfficialBuilder;
      return {
        build: () => instrumented,
        async discoverNotes() {
          return { notes: new Map() };
        },
        executeWithInvocation: async () => executeResult(),
      };
    });
    const service = createOfficialStrk20Service({
      pauseForServiceRetry: async (attempt) => {
        pauses.push(attempt);
      },
      providerFor,
      sdk,
      async submitInvoke(input) {
        submitted = true;
        return { calls: input.calls, transactionHash: "0xabc" };
      },
    });

    await expect(service.register?.({ ...context, poolFeeFri: "0x0" })).rejects.toThrow(
      "strk20 services unavailable (proving/rate-limited): -32005 rate limit exceeded",
    );
    expect(proofAttempts).toBe(3);
    expect(pauses).toEqual([1, 2]);
    expect(submitted).toBe(false);
  });

  test("registration approves the pool's non-zero STRK action fee before apply_actions", async () => {
    const submitted: (readonly Call[])[] = [];
    const sdk = runtime(() => {
      const base = builder(executeResult());
      const instrumented = {
        ...base,
        register: () => instrumented,
      } as unknown as OfficialBuilder;
      return {
        build: () => instrumented,
        async discoverNotes() {
          return { notes: new Map() };
        },
        executeWithInvocation: async () => executeResult(),
      };
    });
    const feeProviderFor = (): ReturnType<typeof providerFor> =>
      ({
        ...providerFor(),
        callContract: async (call: { entrypoint?: string }) =>
          call?.entrypoint === "get_fee_amount" ? ["0x3782dace9d900000"] : ["0x0", "0x10"],
      }) as unknown as ReturnType<typeof providerFor>;
    const service = createOfficialStrk20Service({
      providerFor: feeProviderFor,
      sdk,
      async submitInvoke(input) {
        submitted.push(input.calls);
        return { calls: input.calls, transactionHash: "0xabc" };
      },
    });

    await expect(
      service.register?.({ ...context, poolFeeFri: "0x3782dace9d900000" }),
    ).resolves.toEqual({ transactionHash: "0xabc" });
    expect(submitted).toEqual([
      [
        {
          calldata: ["0x123", "0x3782dace9d900000", "0x0"],
          contractAddress: num.toHex(BigInt(STRK_TOKEN_ADDRESS)),
          entrypoint: "approve",
        },
        {
          calldata: ["0x1"],
          contractAddress: poolAddress,
          entrypoint: "apply_actions",
        },
      ],
    ]);
  });

  test("refuses a changed registration fee before proving or signing", async () => {
    let proofs = 0;
    let submissions = 0;
    const sdk = runtime(() => ({
      build: () => ({
        ...builder(executeResult()),
        async createProofInvocation() {
          proofs += 1;
          return executeResult();
        },
      }),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({
      providerFor: strk20ProviderFor({ poolFee: "0x2" }),
      sdk,
      async submitInvoke(input) {
        submissions += 1;
        return { calls: input.calls, transactionHash: "0xabc" };
      },
    });

    await expect(service.register?.({ ...context, poolFeeFri: "0x1" })).rejects.toThrow(
      "Private pool fee changed",
    );
    expect(proofs).toBe(0);
    expect(submissions).toBe(0);
  });

  test("an unreadable pool fee fails registration closed before submission", async () => {
    const sdk = runtime(() => {
      const base = builder(executeResult());
      const instrumented = {
        ...base,
        register: () => instrumented,
      } as unknown as OfficialBuilder;
      return {
        build: () => instrumented,
        async discoverNotes() {
          return { notes: new Map() };
        },
        executeWithInvocation: async () => executeResult(),
      };
    });
    const brokenProviderFor = (): ReturnType<typeof providerFor> =>
      ({
        ...providerFor(),
        callContract: async () => {
          throw new Error("fee read failed");
        },
      }) as unknown as ReturnType<typeof providerFor>;
    let submissions = 0;
    const service = createOfficialStrk20Service({
      providerFor: brokenProviderFor,
      sdk,
      async submitInvoke(input) {
        submissions += 1;
        return { calls: input.calls, transactionHash: "0xabc" };
      },
    });

    await expect(service.register?.({ ...context, poolFeeFri: "0x0" })).rejects.toThrow(
      "strk20 services unavailable",
    );
    expect(submissions).toBe(0);
  });

  test("first deposits grant only exact aggregate approval before pool submission", async () => {
    const submitted: (readonly Call[])[] = [];
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({
      providerFor,
      sdk,
      async submitInvoke(input) {
        submitted.push(input.calls);
        return { calls: input.calls, transactionHash: "0xdef" };
      },
    });

    await expect(
      service.submitActions({
        ...context,
        actions: [
          { amount: "0x80000000000000000000000000000000", token, type: "deposit" },
          { amount: "0x80000000000000000000000000000000", token, type: "deposit" },
        ],
        plan: { mode: "account", poolFeeFri: "0x0" },
      }),
    ).resolves.toEqual({ transactionHash: "0xdef" });
    expect(submitted).toEqual([
      [
        {
          calldata: ["0x123", "0x0", "0x1"],
          contractAddress: token,
          entrypoint: "approve",
        },
        {
          calldata: ["0x1"],
          contractAddress: poolAddress,
          entrypoint: "apply_actions",
        },
      ],
    ]);
    await expect(
      service.submitActions({
        ...context,
        actions: [{ amount: "0x1", recipient: "0x999", token, type: "withdraw" }],
        plan: { mode: "account", poolFeeFri: "0x0" },
      }),
    ).rejects.toThrow("strk20 privacy leak");
  });

  test("refuses a changed deposit fee before proving or signing", async () => {
    let proofs = 0;
    let submissions = 0;
    const sdk = runtime(() => ({
      build: () => ({
        ...builder(executeResult()),
        async createProofInvocation() {
          proofs += 1;
          return executeResult();
        },
      }),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({
      providerFor: strk20ProviderFor({ poolFee: "0x2" }),
      sdk,
      async submitInvoke(input) {
        submissions += 1;
        return { calls: input.calls, transactionHash: "0xabc" };
      },
    });

    await expect(
      service.submitActions({
        ...context,
        actions: [{ amount: "0x1", token, type: "deposit" }],
        plan: { mode: "account", poolFeeFri: "0x1" },
      }),
    ).rejects.toThrow("Private pool fee changed");
    expect(proofs).toBe(0);
    expect(submissions).toBe(0);
  });

  test("surfaces a pool rejection of registration and frees the scope for a retry", async () => {
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const maturityStore = memoryStrk20MaturityStore();
    let attempts = 0;
    const service = createOfficialStrk20Service({
      maturityStore,
      providerFor,
      sdk,
      async submitInvoke(input) {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("RPC: starknet_addInvokeTransaction with params {...}"), {
            baseError: {
              code: 41,
              data: { execution_error: "pool/registration-closed" },
              message: "Transaction execution error",
            },
          });
        }
        return { calls: input.calls, transactionHash: "0xabc" };
      },
    });

    // The revert reason reaches the caller instead of a bare generic failure.
    await expect(service.register?.({ ...context, poolFeeFri: "0x0" })).rejects.toThrow(
      "(submission/execution-reverted): 41 Transaction execution error pool/registration-closed",
    );
    // And the scope is not left stuck on `submitting`, so the retry proceeds.
    expect(await maturityStore.read(scope)).toBeNull();
    await expect(service.register?.({ ...context, poolFeeFri: "0x0" })).resolves.toEqual({
      transactionHash: "0xabc",
    });
    expect(attempts).toBe(2);
  });

  test("surfaces an account-mode deposit rejection without echoing the request body", async () => {
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const maturityStore = memoryStrk20MaturityStore();
    // starknet.js builds an RpcError's `message` by embedding the serialized
    // JSON-RPC request params, so the raw message of a rejected shielding
    // broadcast carries the invoke calldata and the proof blob.
    const requestBody =
      '{"calldata":["0xfeedfacedeadbeef1234"],"proof":"UHJvb2ZCbG9iQmFzZTY0ZGF0YQ"}';
    const service = createOfficialStrk20Service({
      maturityStore,
      providerFor,
      sdk,
      async submitInvoke() {
        throw Object.assign(
          new Error(`RPC: starknet_addInvokeTransaction with params ${requestBody}`),
          {
            baseError: {
              code: 41,
              data: { execution_error: "pool/deposit-cap-reached" },
              message: "Transaction execution error",
            },
          },
        );
      },
    });

    let rejection: unknown;
    try {
      await service.submitActions({
        ...context,
        actions: [{ amount: "0x1", token, type: "deposit" }],
        plan: { mode: "account" },
      });
    } catch (error) {
      rejection = error;
    }

    // The failure is mapped, so only the sanitized on-chain reason is surfaced.
    expect(rejection).toBeInstanceOf(WalletError);
    const surfaced = rejection instanceof Error ? rejection.message : "";
    expect(surfaced).toContain(
      "(submission/execution-reverted): 41 Transaction execution error pool/deposit-cap-reached",
    );
    // The serialized request params never reach a rendered surface.
    expect(surfaced).not.toContain("starknet_addInvokeTransaction");
    expect(surfaced).not.toContain("0xfeedfacedeadbeef1234");
    expect(surfaced).not.toContain("UHJvb2ZCbG9iQmFzZTY0ZGF0YQ");
    // And the determinate rejection frees the scope instead of wedging it.
    expect(await maturityStore.read(scope)).toBeNull();
  });
});
