/**
 * A relay claim is resolved from chain evidence (#668): once any WriteOnce
 * slot its call writes reads non-zero in a block the node reports
 * ACCEPTED_ON_L1, read at that block's hash, the call can never apply. The
 * claim is replaced by a durable floor at that block, so every later proof
 * targets a block past it. Depth alone never releases it, since Starknet has
 * reorganized deeper than PROVING_BLOCK_DEPTH. A relay send that cannot name
 * its slots never leaves, and "Unlock anyway" clears only the marker the user
 * acted on, never one a send still running leaves behind.
 */

import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  memoryStrk20MaturityStore,
  STRK20_PRIOR_WRITE_STRANDED,
  STRK20_PRIOR_WRITE_UNRESOLVED,
} from "@bramble/privacy/maturity";
import { createStrk20MaturityRuntime } from "@bramble/privacy/official-sdk-maturity";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import type { RpcProvider } from "starknet";
import { PROVING_BLOCK_DEPTH } from "../../src/sdk/official-sdk-maturity-resolution";

const scope = {
  accountId: "SN_SEPOLIA:0xabc",
  networkId: "SN_SEPOLIA" as const,
  poolAddress: "0x123",
};
const SLOTS = ["0x51", "0x52"];
const claim = { route: "relay" as const, state: "submitting" as const, writeOnceSlots: SLOTS };

type StorageRead = { readonly block: unknown; readonly contract: string; readonly slot: string };

const hashOf = (block: number): string => `0x${(0xb000 + block).toString(16)}`;

// A node whose tip starts at `tip` and advances by `step` per read, whose
// blocks up to `l1` are ACCEPTED_ON_L1, and whose storage (read by block hash)
// answers from `values` per slot.
const chain = (options: {
  readonly l1: number;
  readonly step?: number;
  readonly tip: number;
  readonly values?: Readonly<Record<string, unknown>>;
}) => {
  const { l1, step = 0, tip, values = {} } = options;
  const reads: StorageRead[] = [];
  let head = tip - step;
  const provider = {
    getBlockNumber: async () => {
      head += step;
      return head;
    },
    getBlockWithTxHashes: async (number: number) => ({
      block_hash: hashOf(number),
      block_number: number,
      status: number <= l1 ? "ACCEPTED_ON_L1" : "ACCEPTED_ON_L2",
    }),
    getStorageAt: async (contract: string, slot: string, block: unknown) => {
      reads.push({ block, contract, slot });
      const value = values[slot];
      if (value instanceof Error) throw value;
      return value ?? "0x0";
    },
  } as unknown as RpcProvider;
  return { provider, reads };
};

const seeded = async () => {
  const store = memoryStrk20MaturityStore();
  await store.write(scope, claim);
  return store;
};

const quick = (store: ReturnType<typeof memoryStrk20MaturityStore>) =>
  createStrk20MaturityRuntime({ maturityBudgetMs: 50, pause: async () => undefined, store });

describe("resolving a relay claim from its WriteOnce slots", () => {
  test("releases on an L1-finalized slot, read at that block's hash, and keeps the floor", async () => {
    const store = await seeded();
    const { provider, reads } = chain({ l1: 60, step: 1, tip: 100, values: { "0x52": "0x1" } });

    const block = await quick(store).provingBlock(provider, scope);

    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read).toMatchObject({ block: hashOf(60), contract: scope.poolAddress });
    }
    expect(await store.read(scope)).toEqual({ acceptedBlock: 60, state: "released" });
    expect(block).toBeGreaterThan(60);
  });

  test("the floor survives a failed wait and binds a later proof on a lagging node", async () => {
    const store = await seeded();
    // The tip sits at 70, so the candidate (60) is not past the floor.
    await expect(
      quick(store).provingBlock(
        chain({ l1: 60, tip: 70, values: { "0x51": "0x1" } }).provider,
        scope,
      ),
    ).rejects.toThrow();
    expect(await store.read(scope)).toEqual({ acceptedBlock: 60, state: "released" });
    // A fresh worker on a node lagging further still cannot prove at or below it.
    await expect(
      quick(store).provingBlock(chain({ l1: 50, tip: 65 }).provider, scope),
    ).rejects.toThrow();
    const later = await quick(store).provingBlock(chain({ l1: 60, tip: 90 }).provider, scope);
    expect(later).toBeGreaterThan(60);
  });

  test("a slot set only in blocks not yet final on L1 keeps the claim closed", async () => {
    const store = await seeded();
    const { provider, reads } = chain({ l1: -1, tip: 100, values: { "0x51": "0x1" } });
    await expect(quick(store).provingBlock(provider, scope)).rejects.toThrow(
      STRK20_PRIOR_WRITE_UNRESOLVED,
    );
    expect(reads).toEqual([]);
    expect(await store.read(scope)).toEqual(claim);
  });

  test("stays closed while every slot reads zero at the finalized block", async () => {
    const store = await seeded();
    await expect(
      quick(store).provingBlock(chain({ l1: 60, tip: 100 }).provider, scope),
    ).rejects.toThrow(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await store.read(scope)).toEqual(claim);
  });

  test("stays closed on a failed or malformed storage or block read", async () => {
    for (const answer of [new Error("node down"), 7, "not-a-felt", null]) {
      const store = await seeded();
      const { provider } = chain({ l1: 60, tip: 100, values: { "0x51": answer } });
      await expect(quick(store).provingBlock(provider, scope)).rejects.toThrow(
        STRK20_PRIOR_WRITE_UNRESOLVED,
      );
      expect(await store.read(scope), String(answer)).toEqual(claim);
    }
    const store = await seeded();
    const malformedBlock = {
      getBlockNumber: async () => 100,
      getBlockWithTxHashes: async (number: number) => ({
        block_hash: "nope",
        block_number: number,
        status: "ACCEPTED_ON_L1",
      }),
      getStorageAt: async () => "0x1",
    } as unknown as RpcProvider;
    await expect(quick(store).provingBlock(malformedBlock, scope)).rejects.toThrow(
      STRK20_PRIOR_WRITE_UNRESOLVED,
    );
    expect(await store.read(scope)).toEqual(claim);
  });

  test("stays closed while the chain is shallower than the safety depth", async () => {
    const store = await seeded();
    const shallow = chain({ l1: 0, tip: PROVING_BLOCK_DEPTH - 1, values: { "0x51": "0x1" } });
    await expect(quick(store).provingBlock(shallow.provider, scope)).rejects.toThrow(
      STRK20_PRIOR_WRITE_UNRESOLVED,
    );
    expect(shallow.reads).toEqual([]);
  });

  test("a relay claim from an earlier build, with no slots, stays stranded", async () => {
    const store = memoryStrk20MaturityStore();
    await store.write(scope, { route: "relay", state: "submitting" });
    const { provider, reads } = chain({ l1: 60, tip: 100, values: { "0x51": "0x1" } });
    await expect(quick(store).provingBlock(provider, scope)).rejects.toThrow(
      STRK20_PRIOR_WRITE_STRANDED,
    );
    expect(reads).toEqual([]);
  });
});

describe("recording a relay claim", () => {
  test("records the slots on the claim before the call is handed to the relay", async () => {
    const store = memoryStrk20MaturityStore();
    let seen: unknown = null;
    await createStrk20MaturityRuntime({ store, waitForAccepted: async () => 5 }).submitAccepted(
      chain({ l1: 0, tip: 100 }).provider,
      scope,
      "relay",
      async () => "prepared",
      async () => {
        seen = await store.read(scope);
        return { transactionHash: "0x77" };
      },
      () => SLOTS,
    );
    expect(seen).toEqual(claim);
  });

  test("refuses a relay send that names no slots before anything is claimed or sent", async () => {
    for (const relaySlots of [undefined, () => null]) {
      const store = memoryStrk20MaturityStore();
      let broadcasts = 0;
      await expect(
        createStrk20MaturityRuntime({ store }).submitAccepted(
          chain({ l1: 0, tip: 100 }).provider,
          scope,
          "relay",
          async () => "prepared",
          async () => {
            broadcasts += 1;
            return { transactionHash: "0x77" };
          },
          relaySlots,
        ),
      ).rejects.toBeInstanceOf(WalletError);
      expect(broadcasts).toBe(0);
      expect(await store.read(scope)).toBeNull();
    }
  });
});

describe("unlock anyway", () => {
  test("clears the paused marker and reports whether one was cleared", async () => {
    const store = await seeded();
    const runtime = createStrk20MaturityRuntime({ store });
    expect(await runtime.releasePendingWrite(scope)).toBe(true);
    expect(await store.read(scope)).toBeNull();
    expect(await runtime.releasePendingWrite(scope)).toBe(false);
  });

  test("never clears a floor", async () => {
    const store = memoryStrk20MaturityStore();
    await store.write(scope, { acceptedBlock: 9, state: "released" });
    expect(await createStrk20MaturityRuntime({ store }).releasePendingWrite(scope)).toBe(false);
    expect(await store.read(scope)).toEqual({ acceptedBlock: 9, state: "released" });
  });

  test("refuses while a send is running, so a marker its lost answer leaves stays", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = createStrk20MaturityRuntime({ store });
    let fail: () => void = () => undefined;
    const send = runtime.submitAccepted(
      chain({ l1: 0, tip: 100 }).provider,
      scope,
      "relay",
      async () => "prepared",
      () =>
        new Promise<{ readonly transactionHash: string }>((_, reject) => {
          fail = () => reject(new IndeterminateRpcWriteError("relay reply lost"));
        }),
      () => SLOTS,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(runtime.releasePendingWrite(scope)).rejects.toThrow(STRK20_PRIOR_WRITE_UNRESOLVED);
    fail();
    await expect(send).rejects.toBeInstanceOf(IndeterminateRpcWriteError);
    expect(await store.read(scope)).toEqual(claim);
  });

  test("leaves a marker that changed after the user saw it", async () => {
    const store = await seeded();
    const original = store.releaseSubmitting;
    const runtime = createStrk20MaturityRuntime({
      store: {
        ...store,
        releaseSubmitting: async (target, expected) => {
          // A newer claim lands between the user's look and the clear.
          await store.write(target, { ...claim, writeOnceSlots: ["0x99"] });
          return original(target, expected);
        },
      },
    });
    expect(await runtime.releasePendingWrite(scope)).toBe(false);
    expect(await store.read(scope)).toEqual({ ...claim, writeOnceSlots: ["0x99"] });
  });
});
