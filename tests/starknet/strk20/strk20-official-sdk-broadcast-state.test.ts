/**
 * Account-mode broadcast state tests distinguish safe preflight retries from
 * ambiguous response-loss retries that could duplicate a private write.
 */

import { describe, expect, test } from "bun:test";
import { WalletError } from "../../../src/shared/errors";
import { memoryStrk20MaturityStore } from "../../../src/starknet/strk20/maturity";
import { createOfficialStrk20Service } from "../../../src/starknet/strk20/official-sdk-service";
import {
  STRK20_SDK_ACCOUNT as account,
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  STRK20_POOL_ADDRESS as poolAddress,
  providerFor,
  sdkRuntime as runtime,
  STRK20_SDK_TOKEN as token,
} from "../../support/strk20-official-sdk";

const sdk = runtime(() => ({
  build: () => builder(executeResult()),
  async discoverNotes() {
    return { notes: new Map() };
  },
  executeWithInvocation: async () => executeResult(),
}));
const request = {
  ...context,
  actions: [{ amount: "0x1", token, type: "deposit" }] as const,
  plan: { mode: "account" } as const,
};
const scope = { accountId: account.id, networkId: account.networkId, poolAddress };

describe("official STRK20 SDK account broadcast state", () => {
  test("restores maturity after a sanitized pre-broadcast transport failure", async () => {
    const maturityStore = memoryStrk20MaturityStore();
    let attempts = 0;
    const service = createOfficialStrk20Service({
      maturityStore,
      providerFor,
      sdk,
      async submitInvoke(input) {
        attempts += 1;
        if (attempts === 1) {
          throw new WalletError("Transaction could not be prepared. Check your connection.");
        }
        return { calls: input.calls, transactionHash: "0xabc" };
      },
    });

    await expect(service.submitActions(request)).rejects.toThrow("could not be prepared");
    expect(await maturityStore.read(scope)).toBeNull();
    await expect(service.submitActions(request)).resolves.toEqual({ transactionHash: "0xabc" });
    expect(attempts).toBe(2);
  });

  test("retains maturity and blocks retry after an indeterminate broadcast", async () => {
    const maturityStore = memoryStrk20MaturityStore();
    let broadcasts = 0;
    const service = createOfficialStrk20Service({
      maturityStore,
      providerFor,
      sdk,
      async submitInvoke() {
        broadcasts += 1;
        throw new Error(
          "Failed to fetch https://rpc.example with proof UHJvb2ZCbG9iQmFzZTY0ZGF0YQ",
        );
      },
    });

    const firstError = await service.submitActions(request).catch((error: unknown) => error);
    expect(firstError).toBeInstanceOf(WalletError);
    expect((firstError as Error).message).toBe(
      "strk20 services unavailable (submission/transport)",
    );
    expect(await maturityStore.read(scope)).toEqual({ state: "submitting" });
    await expect(service.submitActions(request)).rejects.toThrow("strk20 services unavailable");
    expect(broadcasts).toBe(1);
  });
});
