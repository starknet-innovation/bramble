/**
 * What the review rounds of mc-wallet #661 settled (M1, L1, L3, and the
 * independent reviews of the proof-window attempt).
 *
 * - The pool's proof window is governance-set, so it proves nothing about a
 *   write: a signed write the node does not know while its nonce is unspent
 *   stays checkable however old its proof is, and nothing reads the window.
 * - A relay claim (or one with no recorded route) that names no hash has
 *   nothing the chain can be asked about. It is stranded: the refusal names
 *   the browser restart instead of a check that cannot succeed.
 * - A prior write whose receipt wait fails keeps the "may still be in
 *   progress" refusal (L1).
 * - A conditional release that finds the scope already clean proceeds (L3).
 */

import { describe, expect, test } from "bun:test";
import {
  memoryStrk20MaturityStore,
  STRK20_PRIOR_WRITE_STRANDED,
  STRK20_PRIOR_WRITE_UNRESOLVED,
  type Strk20MaturityRecord,
  type Strk20MaturityStore,
} from "@bramble/privacy/maturity";
import { createStrk20MaturityRuntime } from "@bramble/privacy/official-sdk-maturity";
import type { RpcProvider } from "starknet";

const scope = {
  accountId: "SN_SEPOLIA:0xabc",
  networkId: "SN_SEPOLIA" as const,
  poolAddress: "0x123",
};
const signed = { nonce: "0x5", senderAddress: "0xdef", transactionHash: "0x456" };
const stuck: Strk20MaturityRecord = { ...signed, state: "submitting" };

const notFound = (): Error =>
  Object.assign(new Error("RPC: starknet_getTransactionStatus"), { baseError: { code: 29 } });

type Script = {
  readonly nonce?: string;
  readonly status?: "not-found" | "pending" | "rejected";
};

const node = (script: Script = {}) => {
  const reads: string[] = [];
  const provider = {
    callContract: async (call: { entrypoint: string }) => {
      reads.push(`call:${call.entrypoint}`);
      return ["0x1"];
    },
    // Far past any proof window a pool could set.
    getBlockNumber: async () => {
      reads.push("block");
      return 10_000_000;
    },
    getNonceForAddress: async () => {
      reads.push("nonce");
      return script.nonce ?? "0x5";
    },
    getTransactionStatus: async () => {
      reads.push("status");
      if (script.status === "pending") return { finality_status: "RECEIVED" };
      if (script.status === "rejected") return { finality_status: "REJECTED" };
      throw notFound();
    },
    waitForTransaction: async () => {
      reads.push("wait");
      throw notFound();
    },
  };
  return { provider: provider as unknown as RpcProvider, reads };
};

const seeded = async (record: Strk20MaturityRecord): Promise<Strk20MaturityStore> => {
  const store = memoryStrk20MaturityStore();
  await store.write(scope, record);
  return store;
};

const runtimeFor = (store: Strk20MaturityStore) =>
  createStrk20MaturityRuntime({ pause: async () => undefined, store });

const outcome = (store: Strk20MaturityStore, script: Script = {}): Promise<string> =>
  runtimeFor(store)
    .provingBlock(node(script).provider, scope)
    .then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

describe("a signed write the node does not know, nonce unspent (M1)", () => {
  test("stays checkable however old its proof is, and the pool window is never read", async () => {
    const store = await seeded(stuck);
    const { provider, reads } = node();

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(
      STRK20_PRIOR_WRITE_UNRESOLVED,
    );
    expect(await store.read(scope)).toEqual(stuck);
    expect(reads.some((read) => read.startsWith("call:"))).toBe(false);
  });
});

describe("a relay claim with no hash (M1)", () => {
  test("is stranded, names the restart, and asks the chain nothing", async () => {
    for (const marker of [
      { route: "relay", state: "submitting" },
      { state: "submitting" },
    ] as const) {
      const store = await seeded(marker);
      const { provider, reads } = node();
      await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(
        STRK20_PRIOR_WRITE_STRANDED,
      );
      expect(await store.read(scope)).toEqual(marker);
      expect(reads).toEqual([]);
    }
  });
});

describe("a pending earlier write that misses its receipt (L1)", () => {
  test("keeps the may-still-be-in-progress refusal, not a generic one", async () => {
    const store = await seeded(stuck);
    expect(await outcome(store, { status: "pending" })).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await store.read(scope)).toEqual(stuck);
  });

  test("a submitted write that never confirms keeps that refusal and its marker", async () => {
    const submitted: Strk20MaturityRecord = { state: "submitted", transactionHash: "0x456" };
    const store = await seeded(submitted);
    expect(await outcome(store)).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await store.read(scope)).toEqual(submitted);
  });
});

describe("two checks at once (L3)", () => {
  test("proceeds when the other check already released the unsigned claim", async () => {
    const backing = await seeded({ route: "account", state: "submitting" });
    const store: Strk20MaturityStore = {
      ...backing,
      releaseUnsigned: async (target) => {
        // The other panel's check wins the queue.
        await backing.releaseUnsigned(target);
        return backing.releaseUnsigned(target);
      },
    };
    expect(await outcome(store)).toBe("resolved");
  });

  test("still refuses when a different marker took the unsigned claim's place", async () => {
    const backing = await seeded({ route: "account", state: "submitting" });
    const store: Strk20MaturityStore = {
      ...backing,
      releaseUnsigned: async (target) => {
        await backing.write(target, stuck);
        return backing.releaseUnsigned(target);
      },
    };
    expect(await outcome(store)).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
  });

  test("proceeds when the other check already released a rejected signed write", async () => {
    const backing = await seeded(stuck);
    const store: Strk20MaturityStore = {
      ...backing,
      replaceIfCurrentHash: async (target, hash, record) => {
        await backing.write(target, null);
        return backing.replaceIfCurrentHash(target, hash, record);
      },
    };
    expect(await outcome(store, { status: "rejected" })).toBe("resolved");
  });
});
