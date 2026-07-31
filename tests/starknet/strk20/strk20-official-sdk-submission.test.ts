/**
 * Official privacy-SDK submission tests. The deterministic runtime double
 * verifies registration, approval, and proof boundaries without live services.
 */
import { describe, expect, test } from "bun:test";
import type { Call } from "starknet";
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
  STRK20_SDK_TOKEN as token,
} from "../../support/strk20-official-sdk";

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

  test("discovers account registration using the SDK setup requirement enum", async () => {
    let requirement = 0;
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      async discoverRequirement(recipient, selectedToken) {
        expect(recipient).toBe(account.address);
        expect(selectedToken).toBe(token);
        return requirement;
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({ providerFor, sdk });

    await expect(service.registrationStatus?.({ ...context, token })).resolves.toBe("unregistered");
    requirement = 3;
    await expect(service.registrationStatus?.({ ...context, token })).resolves.toBe("registered");
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

    await expect(service.register?.(context)).resolves.toEqual({ transactionHash: "0xabc" });
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
        plan: { mode: "account" },
      }),
    ).resolves.toEqual({ transactionHash: "0xdef" });
    expect(submitted).toEqual([
      [
        {
          calldata: ["291", "0", "1"],
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
        plan: { mode: "account" },
      }),
    ).rejects.toThrow("strk20 privacy leak");
  });
});
