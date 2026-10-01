/**
 * A `simulate: true` prepare must never hand the viewing key to the RPC node.
 *
 * The pinned SDK's own `simulate` wraps the RPC provider in a mock prover that
 * sends `compile_actions(user_addr, viewing_key, actions)` as a plain
 * `starknet_call`, and that provider is built from the user's RPC override when
 * one is set. These cases pin that simulations instead go through the prover,
 * exactly like a real proof, and still yield only an unsubmittable empty proof.
 */
import { describe, expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import {
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  sdkRuntime as runtime,
  STRK20_POOL_ADDRESS,
  strk20ProviderFor,
  STRK20_SDK_TOKEN as token,
} from "../support/official-sdk";

type RecordedCall = { readonly calldata: readonly unknown[]; readonly entrypoint: string };

// The RPC double records every view call made through the node the adapter
// would hand the SDK, so a viewing key reaching it is observable.
const recordingProviderFor = (calls: RecordedCall[]) => {
  const base = strk20ProviderFor();
  return (): RpcProvider => {
    const provider = base();
    return {
      ...provider,
      async callContract(call: { calldata?: unknown; entrypoint?: string }) {
        calls.push({
          calldata: Array.isArray(call.calldata) ? call.calldata : [],
          entrypoint: call.entrypoint ?? "",
        });
        return provider.callContract(call as never);
      },
    } as unknown as RpcProvider;
  };
};

// Mirrors the pinned SDK's `simulate`: it compiles `compile_actions` with the
// viewing key and sends it to the provider it was given. If the adapter ever
// calls it again, the recording provider sees the key.
const leakingSimulate = async (options: unknown): Promise<unknown> => {
  const { provider } = options as { readonly provider: RpcProvider };
  await provider.callContract({
    calldata: [context.account.address, await context.viewingKey(), "0x0"],
    contractAddress: context.account.address,
    entrypoint: "compile_actions",
  });
  return executeResult();
};

const withdrawal = {
  ...context,
  actions: [{ amount: "0x1", recipient: "0x999", token, type: "withdraw" as const }],
  simulate: true,
};

describe("STRK20 simulate keeps the viewing key off the RPC node", () => {
  test("a simulation proves through the prover and returns an empty proof", async () => {
    const calls: RecordedCall[] = [];
    const invocations: unknown[] = [];
    const viewingKey = await context.viewingKey();
    const sdk = runtime(() => ({
      build: () => ({ ...builder(), simulate: leakingSimulate }),
      discoverNotes: async () => ({ notes: new Map() }),
      async executeWithInvocation(invocation: unknown) {
        invocations.push(invocation);
        return executeResult();
      },
    }));
    const service = createOfficialStrk20Service({
      providerFor: recordingProviderFor(calls),
      sdk,
    });

    await expect(service.prepare(withdrawal)).resolves.toEqual({
      call: {
        calldata: ["0x1"],
        contract_address: STRK20_POOL_ADDRESS,
        entry_point: "apply_actions",
      },
      proof: { data: "", output: [], proof_facts: [] },
    });
    expect(invocations).toHaveLength(1);
    expect(calls.map((call) => call.entrypoint)).not.toContain("compile_actions");
    for (const call of calls) {
      for (const felt of call.calldata) {
        expect(typeof felt === "string" && sameFelt(felt, viewingKey)).toBe(false);
      }
    }
  });

  test("a prover refusal of a simulation surfaces as a proving-stage error", async () => {
    const sdk = runtime(() => ({
      build: () => builder(),
      discoverNotes: async () => ({ notes: new Map() }),
      async executeWithInvocation() {
        throw new Error("proof rejected by prover");
      },
    }));
    const service = createOfficialStrk20Service({ providerFor: strk20ProviderFor(), sdk });

    await expect(service.prepare(withdrawal)).rejects.toThrow(
      "strk20 services unavailable (proving/proof-rejected)",
    );
  });
});
