/**
 * A lock during proving stops a relayed private transfer or withdrawal
 * (Sherlock #175).
 *
 * The signer and viewing-key thunks are consumed while the SDK builds the proof
 * invocation; proving then runs for up to minutes with no session check. The
 * relay branch of `submitActions` must forward the unlock guard so a lock in
 * that window refuses the broadcast, and the refusal must hand the maturity
 * scope back rather than leave it `submitting`.
 */
import { describe, expect, test } from "bun:test";
import { memoryStrk20MaturityStore } from "@bramble/privacy/maturity";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import type { Strk20SubmissionPlan } from "@bramble/privacy/service";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import {
  STRK20_SDK_ACCOUNT as account,
  officialBuilder as builder,
  executeResult,
  STRK20_POOL_ADDRESS as poolAddress,
  STRK20_RELAY_CONTEXT as relayContext,
  sdkRuntime as runtime,
  strk20ProviderFor,
  STRK20_SDK_TOKEN as token,
} from "../support/official-sdk";

const plan: Strk20SubmissionPlan = {
  feeAction: { amount: "0x2a", recipient: "0x4", token: STRK_TOKEN_ADDRESS, type: "withdraw" },
  mode: "private-relay",
};
const scope = { accountId: account.id, networkId: account.networkId, poolAddress };

const relayService = (onProve: () => void) => {
  const methods: string[] = [];
  const maturityStore = memoryStrk20MaturityStore();
  const service = createOfficialStrk20Service({
    http: async (_url, init) => {
      methods.push(String((JSON.parse(String(init?.body)) as { method?: unknown }).method));
      return Response.json({
        id: "bramble-strk20",
        jsonrpc: "2.0",
        result: { transaction_hash: "0xabc" },
      });
    },
    maturityStore,
    nowSeconds: () => 1_000,
    providerFor: strk20ProviderFor(),
    sdk: runtime(() => ({
      build: () => builder(),
      discoverNotes: async () => ({ notes: new Map() }),
      async executeWithInvocation() {
        onProve();
        return executeResult();
      },
    })),
  });
  return { maturityStore, methods, service };
};

describe("relayed private submission honours a lock during proving", () => {
  for (const action of [
    { amount: "0x1", recipient: "0x999", token, type: "withdraw" },
    { amount: "0x1", recipient: "0x999", token, type: "transfer" },
  ] as const) {
    test(`a ${action.type} locked while proving is refused before the relay`, async () => {
      let authorized = true;
      const { maturityStore, methods, service } = relayService(() => {
        authorized = false;
      });

      await expect(
        service.submitActions({
          ...relayContext,
          actions: [action],
          isAuthorized: () => authorized,
          plan,
        }),
      ).rejects.toThrow("wallet locked");
      expect(methods).not.toContain("paymaster_executeTransaction");
      // Nothing went out, so the scope is released, not wedged `submitting`.
      expect(await maturityStore.read(scope)).toBeNull();
    });
  }

  test("an unlocked session still relays and records the hash", async () => {
    const { maturityStore, methods, service } = relayService(() => undefined);

    await expect(
      service.submitActions({
        ...relayContext,
        actions: [{ amount: "0x1", recipient: "0x999", token, type: "withdraw" }],
        plan,
      }),
    ).resolves.toMatchObject({ transactionHash: "0xabc" });
    expect(methods).toEqual(["paymaster_executeTransaction"]);
    expect(await maturityStore.read(scope)).not.toBeNull();
  });
});
