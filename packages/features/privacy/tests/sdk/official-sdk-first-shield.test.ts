/**
 * A first shield that registers in the same `apply_actions` (#789). The batch
 * must put the registration in front of the deposits, accept only a
 * self-credit, and wait for both the account and the deposited balance at the
 * proof base before proving.
 */
import { describe, expect, test } from "bun:test";
import { historicalReadiness } from "@bramble/privacy/official-sdk-preparation";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { STRK20_PRIVACY_LEAK } from "@bramble/privacy/service";
import type { RpcProvider } from "starknet";
import {
  STRK20_SDK_CONTEXT as context,
  executeResult,
  type OfficialBuilder,
  officialBuilder,
  providerFor,
  sdkRuntime,
  STRK20_SDK_TOKEN as token,
} from "../support/official-sdk";

const DEPOSIT = { amount: "0x10", token, type: "deposit" as const };

// Records the order the adapter drives the builder in.
const recordingService = () => {
  const steps: string[] = [];
  const builder = (): OfficialBuilder => {
    const base = officialBuilder() as unknown as Record<string, unknown>;
    const self: Record<string, unknown> = {
      ...base,
      register: () => {
        steps.push("register");
        return self;
      },
      with: () => ({
        deposit: () => {
          steps.push("deposit");
          return { done: () => self };
        },
      }),
    };
    return self as unknown as OfficialBuilder;
  };
  const sdk = sdkRuntime(() => ({
    build: () => builder(),
    async discoverNotes() {
      return { notes: new Map() };
    },
    executeWithInvocation: async () => executeResult(),
  }));
  return { service: createOfficialStrk20Service({ providerFor, sdk }), steps };
};

describe("official STRK20 SDK first shield", () => {
  test("registers ahead of the deposit in one batch when asked to activate", async () => {
    const { service, steps } = recordingService();
    const prepared = await service.prepareAccountActions?.({
      ...context,
      actions: [DEPOSIT],
      activate: true,
      poolFeeFri: "0x0",
    });
    expect(steps).toEqual(["register", "deposit"]);
    // One `apply_actions`: one pool fee for both halves.
    expect(prepared?.calls.filter((call) => call.entrypoint === "apply_actions")).toHaveLength(1);
  });

  test("a plain shield never registers", async () => {
    const { service, steps } = recordingService();
    await service.prepareAccountActions?.({ ...context, actions: [DEPOSIT], poolFeeFri: "0x0" });
    expect(steps).toEqual(["deposit"]);
  });

  test("refuses to register inside a deposit that credits someone else", async () => {
    // Registration opens the self channel; a third-party credit would open a
    // second one in the same batch and link the two.
    const { service, steps } = recordingService();
    await expect(
      service.prepareAccountActions?.({
        ...context,
        actions: [{ ...DEPOSIT, recipient: "0x5" }],
        activate: true,
        poolFeeFri: "0x0",
      }),
    ).rejects.toThrow(STRK20_PRIVACY_LEAK);
    expect(steps).toEqual([]);
  });

  test("a first shield waits for the account and the deposit at the proof base", async () => {
    let deployed = false;
    let balance = "0x0";
    const provider = {
      async callContract() {
        return [balance, "0x0"];
      },
      async getClassHashAt() {
        if (!deployed) throw new Error("contract not found");
        return "0x123";
      },
    } as unknown as RpcProvider;
    const ready = historicalReadiness("first-shield", provider, {
      ...context,
      actions: [DEPOSIT],
      simulate: false,
    });
    if (!ready) throw new Error("expected a readiness check");

    balance = "0x10";
    await expect(ready(42)).resolves.toBe(false);
    deployed = true;
    balance = "0x0";
    await expect(ready(42)).resolves.toBe(false);
    balance = "0x10";
    await expect(ready(42)).resolves.toBe(true);
  });
});
