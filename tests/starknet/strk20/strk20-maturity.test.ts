/**
 * Privacy proof maturity keeps accepted writes behind the historical proving
 * block and persists pending hashes before waiting for a receipt.
 */

import { describe, expect, test } from "bun:test";
import type { RpcProvider } from "starknet";
import { memoryStrk20MaturityStore } from "../../../src/starknet/strk20/maturity";
import { createStrk20MaturityRuntime } from "../../../src/starknet/strk20/official-sdk-maturity";

const scope = {
  accountId: "SN_SEPOLIA:0xabc",
  networkId: "SN_SEPOLIA" as const,
  poolAddress: "0x123",
};

const providerWith = (blocks: number[]): RpcProvider =>
  ({
    getBlockNumber: async () => blocks.shift() ?? 30,
  }) as unknown as RpcProvider;

describe("STRK20 proof maturity", () => {
  test("records a pending hash before waiting for an accepted receipt", async () => {
    const store = memoryStrk20MaturityStore();
    let pendingSeen = false;
    const runtime = createStrk20MaturityRuntime({
      store,
      waitForAccepted: async () => {
        pendingSeen = (await store.read(scope))?.state === "submitted";
        return 20;
      },
    });

    await runtime.recordSubmission(providerWith([]), scope, "0x456");

    expect(pendingSeen).toBe(true);
    expect(await store.read(scope)).toEqual({
      acceptedBlock: 20,
      state: "submitted",
      transactionHash: "0x456",
    });
  });

  test("waits until the prior accepted block is older than the proving block", async () => {
    const store = memoryStrk20MaturityStore();
    await store.write(scope, {
      acceptedBlock: 20,
      state: "submitted",
      transactionHash: "0x456",
    });
    let pauses = 0;
    const runtime = createStrk20MaturityRuntime({
      pause: async () => {
        pauses += 1;
      },
      store,
    });

    await expect(runtime.provingBlock(providerWith([29, 30, 31]), scope)).resolves.toBe(21);
    expect(pauses).toBe(2);
  });

  test("recovers a pending receipt after a runtime restart", async () => {
    const store = memoryStrk20MaturityStore();
    await store.write(scope, { state: "submitted", transactionHash: "0x456" });
    const runtime = createStrk20MaturityRuntime({
      store,
      waitForAccepted: async (_provider, hash) => {
        expect(hash).toBe("0x456");
        return 20;
      },
    });

    await expect(runtime.provingBlock(providerWith([31]), scope)).resolves.toBe(21);
    expect(await store.read(scope)).toEqual({
      acceptedBlock: 20,
      state: "submitted",
      transactionHash: "0x456",
    });
  });

  test("waits until transparent state is visible at the historical proof base", async () => {
    let checks = 0;
    let pauses = 0;
    const runtime = createStrk20MaturityRuntime({
      pause: async () => {
        pauses += 1;
      },
    });

    await expect(
      runtime.provingBlock(providerWith([30, 31]), scope, async (block) => {
        checks += 1;
        return block === 21;
      }),
    ).resolves.toBe(21);
    expect(checks).toBe(2);
    expect(pauses).toBe(1);
  });

  test("preserves a pending hash when receipt status is indeterminate", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = createStrk20MaturityRuntime({
      store,
      waitForAccepted: async () => {
        throw new Error("reverted");
      },
    });

    await expect(runtime.recordSubmission(providerWith([]), scope, "0x456")).rejects.toThrow(
      "strk20 services unavailable",
    );
    expect(await store.read(scope)).toEqual({
      state: "submitted",
      transactionHash: "0x456",
    });
  });

  test("clears a receipt only after the provider proves rejection", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = createStrk20MaturityRuntime({ store });
    const provider = {
      async waitForTransaction() {
        return { block_number: 20, isSuccess: () => false };
      },
    } as unknown as RpcProvider;

    await expect(runtime.recordSubmission(provider, scope, "0x456")).rejects.toThrow(
      "strk20 services unavailable",
    );
    expect(await store.read(scope)).toBeNull();
  });

  test("serializes the complete submission and acceptance lifecycle per scope", async () => {
    const store = memoryStrk20MaturityStore();
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstBroadcastStarted: (() => void) | undefined;
    const firstBroadcastStarted = new Promise<void>((resolve) => {
      markFirstBroadcastStarted = resolve;
    });
    const started: string[] = [];
    const runtime = createStrk20MaturityRuntime({
      store,
      waitForAccepted: async () => 20,
    });
    const first = runtime.submitAccepted(
      providerWith([]),
      scope,
      async () => {
        started.push("prepare first");
        return "first";
      },
      async () => {
        started.push("broadcast first");
        markFirstBroadcastStarted?.();
        await firstGate;
        return { transactionHash: "0x456" };
      },
    );
    const second = runtime.submitAccepted(
      providerWith([]),
      scope,
      async () => {
        started.push("prepare second");
        return "second";
      },
      async () => {
        started.push("broadcast second");
        return { transactionHash: "0x789" };
      },
    );

    await firstBroadcastStarted;
    expect(started).toEqual(["prepare first", "broadcast first"]);
    expect(await store.read(scope)).toEqual({ state: "submitting" });
    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { transactionHash: "0x456" },
      { transactionHash: "0x789" },
    ]);
    expect(started).toEqual([
      "prepare first",
      "broadcast first",
      "prepare second",
      "broadcast second",
    ]);
    expect(await store.read(scope)).toEqual({
      acceptedBlock: 20,
      state: "submitted",
      transactionHash: "0x789",
    });
  });

  test("fails closed across a crash or indeterminate error at the broadcast boundary", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = createStrk20MaturityRuntime({ store });

    await expect(
      runtime.submitAccepted(
        providerWith([]),
        scope,
        async () => "prepared",
        async () => {
          expect(await store.read(scope)).toEqual({ state: "submitting" });
          throw new Error("worker terminated after broadcast");
        },
      ),
    ).rejects.toThrow("worker terminated after broadcast");

    expect(await store.read(scope)).toEqual({ state: "submitting" });
    await expect(runtime.provingBlock(providerWith([30]), scope)).rejects.toThrow(
      "strk20 services unavailable",
    );
  });

  test("uses the built-in receipt wait when no override is injected", async () => {
    const store = memoryStrk20MaturityStore();
    const receiptFor = (receipt: { block_number: unknown; isSuccess: () => boolean }) =>
      ({
        getBlockNumber: async () => 30,
        waitForTransaction: async () => receipt,
      }) as unknown as RpcProvider;

    // Accepted receipt: the default wait reads the block straight off it.
    await createStrk20MaturityRuntime({ store }).recordSubmission(
      receiptFor({ block_number: 12, isSuccess: () => true }),
      scope,
      "0x456",
    );
    expect(await store.read(scope)).toEqual({
      acceptedBlock: 12,
      state: "submitted",
      transactionHash: "0x456",
    });

    // A reverted receipt clears the scope so a retry is not blocked by it.
    await expect(
      createStrk20MaturityRuntime({ store }).recordSubmission(
        receiptFor({ block_number: 12, isSuccess: () => false }),
        scope,
        "0x789",
      ),
    ).rejects.toThrow("strk20 services unavailable");
    expect(await store.read(scope)).toBeNull();

    // An unusable block number fails closed rather than being trusted.
    await expect(
      createStrk20MaturityRuntime({ store }).recordSubmission(
        receiptFor({ block_number: Number.NaN, isSuccess: () => true }),
        scope,
        "0xabc",
      ),
    ).rejects.toThrow("strk20 services unavailable");
  });

  test("rejects a submission hash that is not a non-zero field element", async () => {
    const runtime = createStrk20MaturityRuntime({ store: memoryStrk20MaturityStore() });
    await expect(runtime.recordSubmission(providerWith([]), scope, "0x0")).rejects.toThrow(
      "strk20 services unavailable",
    );
  });

  test("releases the scope when the sequencer determinately rejects the broadcast", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = createStrk20MaturityRuntime({ store });
    const rejected = Object.assign(new Error("RPC: starknet_addInvokeTransaction"), {
      baseError: { code: 41, data: { execution_error: "argent/invalid-owner-sig" }, message: "x" },
    });

    await expect(
      runtime.submitAccepted(
        providerWith([]),
        scope,
        async () => "prepared",
        async () => {
          throw rejected;
        },
      ),
      // The maturity layer rethrows untouched; the service adapter is what maps
      // the rejection into a staged, sanitized wallet error.
    ).rejects.toThrow("RPC: starknet_addInvokeTransaction");

    // The scope must not stay stuck on `submitting`, or every later retry would
    // report a stale guard instead of the actual rejection.
    expect(await store.read(scope)).toBeNull();
    await expect(runtime.provingBlock(providerWith([30]), scope)).resolves.toBe(20);
  });

  test("keeps an earlier accepted write when a later broadcast is rejected", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = createStrk20MaturityRuntime({
      store,
      waitForAccepted: async () => 25,
    });
    await runtime.recordSubmission(providerWith([]), scope, "0x456");

    await expect(
      runtime.submitAccepted(
        providerWith([]),
        scope,
        async () => "prepared",
        async () => {
          throw Object.assign(new Error("rejected"), {
            baseError: { code: 55, data: "insufficient max fee", message: "y" },
          });
        },
      ),
    ).rejects.toThrow("rejected");

    // Releasing the scope must not forget the write a later proof has to age
    // past, so the prior accepted record is restored rather than cleared.
    expect(await store.read(scope)).toEqual({
      acceptedBlock: 25,
      state: "submitted",
      transactionHash: "0x456",
    });
  });
});
