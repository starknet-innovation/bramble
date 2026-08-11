/**
 * Final wallet-policy gate at the official SDK proof boundary.
 */
import { expect, test } from "bun:test";
import { WalletError } from "@mc-wallet/core/errors";
import { createOfficialStrk20Service } from "@mc-wallet/privacy/official-sdk-service";
import {
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  type providerFor,
  sdkRuntime as runtime,
  strk20ProviderFor,
  STRK20_SDK_TOKEN as token,
} from "../support/official-sdk";

test("the final wallet gate runs after preflights and before proof creation", async () => {
  let poolReads = 0;
  let proofs = 0;
  let submissions = 0;
  const baseProviderFor = strk20ProviderFor();
  const observedProviderFor = (): ReturnType<typeof providerFor> => {
    const provider = baseProviderFor();
    return {
      ...provider,
      async callContract(input) {
        poolReads += 1;
        return provider.callContract(input);
      },
    } as ReturnType<typeof providerFor>;
  };
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
    providerFor: observedProviderFor,
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
      beforeProof: async () => {
        expect(poolReads).toBeGreaterThan(0);
        throw new WalletError("The recipient has not activated private balances");
      },
      plan: { mode: "account", poolFeeFri: "0x0" },
    }),
  ).rejects.toThrow("The recipient has not activated private balances");
  expect(proofs).toBe(0);
  expect(submissions).toBe(0);
});
