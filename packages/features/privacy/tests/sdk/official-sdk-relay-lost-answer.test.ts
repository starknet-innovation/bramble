/**
 * A relay broadcast answered with a 5xx keeps the maturity scope closed
 * (Sherlock #159).
 *
 * The wallet reaches the relay through the STRK20 gateway, which answers 502
 * or 504 when its own upstream deadline expires or the relay's reply breaks
 * off. The relay may already have forwarded the transaction, so the scope must
 * stay `submitting` and the next private action must be refused rather than
 * prove and broadcast a second time. A 4xx is the relay refusing the request,
 * so the scope is handed back.
 */
import { describe, expect, test } from "bun:test";
import { memoryStrk20MaturityStore } from "@bramble/privacy/maturity";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import type { Strk20SubmissionPlan } from "@bramble/privacy/service";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import {
  STRK20_SDK_ACCOUNT as account,
  officialBuilder as builder,
  executeResult,
  STRK20_POOL_ADDRESS as poolAddress,
  RELAY_WRITE_ONCE_SLOT,
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
const actions = [{ amount: "0x1", recipient: "0x999", token, type: "withdraw" }] as const;

const relayService = (answer: () => Response | Promise<Response>) => {
  let broadcasts = 0;
  const maturityStore = memoryStrk20MaturityStore();
  const service = createOfficialStrk20Service({
    http: async (_url, init) => {
      const method = (JSON.parse(String(init?.body)) as { method?: unknown }).method;
      if (method === "paymaster_executeTransaction") {
        broadcasts += 1;
      }
      return answer();
    },
    maturityStore,
    nowSeconds: () => 1_000,
    providerFor: strk20ProviderFor(),
    sdk: runtime(() => ({
      build: () => builder(),
      discoverNotes: async () => ({ notes: new Map() }),
      executeWithInvocation: async () => executeResult(),
    })),
  });
  return { broadcasts: () => broadcasts, maturityStore, service };
};

describe("a relay broadcast whose answer the gateway lost", () => {
  for (const status of [502, 503, 504]) {
    test(`a ${status} holds the scope and refuses a second broadcast`, async () => {
      const { broadcasts, maturityStore, service } = relayService(
        () => new Response(JSON.stringify({ error: "upstream_unavailable" }), { status }),
      );

      await expect(
        service.submitActions({ ...relayContext, actions: [...actions], plan }),
      ).rejects.toBeInstanceOf(IndeterminateRpcWriteError);
      expect(await maturityStore.read(scope)).toEqual({
        route: "relay",
        state: "submitting",
        writeOnceSlots: [RELAY_WRITE_ONCE_SLOT],
      });

      await expect(
        service.submitActions({ ...relayContext, actions: [...actions], plan }),
      ).rejects.toThrow("may still be in progress");
      expect(broadcasts()).toBe(1);
    });
  }

  test("a dropped connection holds the scope and refuses a second broadcast (audit M1)", async () => {
    // A connection reset or an empty reply after the request was written
    // rejects fetch with a TypeError; the relay may already have forwarded it.
    const { broadcasts, maturityStore, service } = relayService(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );

    await expect(
      service.submitActions({ ...relayContext, actions: [...actions], plan }),
    ).rejects.toBeInstanceOf(IndeterminateRpcWriteError);
    expect(await maturityStore.read(scope)).toEqual({
      route: "relay",
      state: "submitting",
      writeOnceSlots: [RELAY_WRITE_ONCE_SLOT],
    });

    await expect(
      service.submitActions({ ...relayContext, actions: [...actions], plan }),
    ).rejects.toThrow("may still be in progress");
    expect(broadcasts()).toBe(1);
  });

  test("a 4xx refusal hands the scope back", async () => {
    const { maturityStore, service } = relayService(
      () => new Response(JSON.stringify({ error: "upstream_rejected" }), { status: 400 }),
    );

    await expect(
      service.submitActions({ ...relayContext, actions: [...actions], plan }),
    ).rejects.not.toBeInstanceOf(IndeterminateRpcWriteError);
    expect(await maturityStore.read(scope)).toBeNull();
  });
});
