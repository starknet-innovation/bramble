/**
 * A relay claim is resolved from chain evidence (#668): once any WriteOnce
 * slot its call writes reads non-zero PROVING_BLOCK_DEPTH below the tip, the
 * call can never apply and the claim is released; the next proof then targets
 * a block past that one. Anything less keeps it closed. A relay send that
 * cannot name its slots never leaves, and "Unlock anyway" clears a marker only
 * when no send on the scope is running.
 */

import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  memoryStrk20MaturityStore,
  STRK20_PRIOR_WRITE_STRANDED,
  STRK20_PRIOR_WRITE_UNRESOLVED,
} from "@bramble/privacy/maturity";
import { createStrk20MaturityRuntime } from "@bramble/privacy/official-sdk-maturity";
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

// A node whose tip starts at `tip` and advances by `step` each read, whose
// storage answers come from `values` per slot.
const chain = (tip: number, values: Readonly<Record<string, unknown>>, step = 0) => {
  const reads: StorageRead[] = [];
  let head = tip - step;
  const provider = {
    getBlockNumber: async () => {
      head += step;
      return head;
    },
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

describe("resolving a relay claim from its WriteOnce slots", () => {
  test("releases once a slot is set, and proves only past the block it was seen in", async () => {
    const store = await seeded();
    const { provider, reads } = chain(100, { "0x52": "0x1" }, 1);
    const settled = 100 - PROVING_BLOCK_DEPTH;

    const block = await createStrk20MaturityRuntime({
      pause: async () => undefined,
      store,
    }).provingBlock(provider, scope);

    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read).toMatchObject({ block: settled, contract: scope.poolAddress });
    }
    expect(await store.read(scope)).toBeNull();
    // The floor is the block the slot was seen set in, so the proof targets a
    // strictly later one, which includes whatever the relayed call wrote.
    expect(block).toBeGreaterThan(settled);
  });

  test("does not prove at the very block the slot was seen set in", async () => {
    const store = await seeded();
    const { provider } = chain(100, { "0x51": "0x1" });
    await expect(
      createStrk20MaturityRuntime({
        maturityBudgetMs: 50,
        pause: async () => undefined,
        store,
      }).provingBlock(provider, scope),
    ).rejects.toThrow();
    expect(await store.read(scope)).toBeNull();
  });

  test("stays closed while every slot still reads zero", async () => {
    const store = await seeded();
    const { provider } = chain(100, {});
    await expect(
      createStrk20MaturityRuntime({ store }).provingBlock(provider, scope),
    ).rejects.toThrow(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await store.read(scope)).toEqual(claim);
  });

  test("stays closed on a failed or malformed storage read", async () => {
    for (const answer of [new Error("node down"), 7, "not-a-felt", null]) {
      const store = await seeded();
      const { provider } = chain(100, { "0x51": answer });
      await expect(
        createStrk20MaturityRuntime({ store }).provingBlock(provider, scope),
      ).rejects.toThrow(STRK20_PRIOR_WRITE_UNRESOLVED);
      expect(await store.read(scope), String(answer)).toEqual(claim);
    }
  });

  test("stays closed while the chain is shallower than the safety depth", async () => {
    const store = await seeded();
    const { provider, reads } = chain(PROVING_BLOCK_DEPTH - 1, { "0x51": "0x1" });
    await expect(
      createStrk20MaturityRuntime({ store }).provingBlock(provider, scope),
    ).rejects.toThrow(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(reads).toEqual([]);
    expect(await store.read(scope)).toEqual(claim);
  });

  test("a relay claim from an earlier build, with no slots, stays stranded", async () => {
    const store = memoryStrk20MaturityStore();
    await store.write(scope, { route: "relay", state: "submitting" });
    const { provider, reads } = chain(100, { "0x51": "0x1" });
    await expect(
      createStrk20MaturityRuntime({ store }).provingBlock(provider, scope),
    ).rejects.toThrow(STRK20_PRIOR_WRITE_STRANDED);
    expect(reads).toEqual([]);
  });
});

describe("recording a relay claim", () => {
  test("records the slots on the claim before the call is handed to the relay", async () => {
    const store = memoryStrk20MaturityStore();
    let seen: unknown = null;
    await createStrk20MaturityRuntime({ store, waitForAccepted: async () => 5 }).submitAccepted(
      chain(100, {}).provider,
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
          chain(100, {}).provider,
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
  test("clears a paused marker and reports whether one was cleared", async () => {
    const store = await seeded();
    const runtime = createStrk20MaturityRuntime({ store });
    expect(await runtime.releasePendingWrite(scope)).toBe(true);
    expect(await store.read(scope)).toBeNull();
    expect(await runtime.releasePendingWrite(scope)).toBe(false);
  });

  test("waits for a running send and then clears only what is still paused", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = createStrk20MaturityRuntime({ store, waitForAccepted: async () => 5 });
    let finish: () => void = () => undefined;
    const send = runtime.submitAccepted(
      chain(100, {}).provider,
      scope,
      "relay",
      async () => "prepared",
      () =>
        new Promise<{ readonly transactionHash: string }>((resolve) => {
          finish = () => resolve({ transactionHash: "0x77" });
        }),
      () => SLOTS,
    );
    const unlock = runtime.releasePendingWrite(scope);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await store.read(scope)).toEqual(claim);
    finish();
    await send;
    // The send settled with a hash, so nothing is paused any more.
    expect(await unlock).toBe(false);
    expect(await store.read(scope)).toEqual({
      acceptedBlock: 5,
      state: "submitted",
      transactionHash: "0x77",
    });
  });
});
