/**
 * The pool's proof window releases what nothing else can (mc-wallet #661
 * review M1, L1, L3). The pool applies a proof only in a block at most
 * `get_proof_validity_blocks()` past its base block, so once the settled block
 * (tip minus 10) is past base + validity, a relay claim or a signed write
 * whose nonce is unspent can no longer change pool state and is released. A
 * marker that names no base block and that nothing else resolves refuses with
 * the stranded sentence, which names the browser restart instead of a check
 * that cannot succeed.
 */

import { describe, expect, test } from "bun:test";
import {
  memoryStrk20MaturityStore,
  STRK20_PRIOR_WRITE_STRANDED,
  STRK20_PRIOR_WRITE_UNRESOLVED,
  type Strk20MaturityRecord,
  type Strk20MaturityStore,
} from "@bramble/privacy/maturity";
import {
  createStrk20MaturityRuntime,
  strk20ProofBaseBlock,
} from "@bramble/privacy/official-sdk-maturity";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import type { RpcProvider } from "starknet";

const scope = {
  accountId: "SN_SEPOLIA:0xabc",
  networkId: "SN_SEPOLIA" as const,
  poolAddress: "0x123",
};
const signed = { nonce: "0x5", senderAddress: "0xdef", transactionHash: "0x456" };
// Proved at block 100 with a 450-block window: the pool applies it at block
// 550 at the latest, so a settled block of 551 (tip 561) closes the window.
const BASE = 100;
const CLOSED_TIP = 561;
const OPEN_TIP = 560;

const notFound = (): Error =>
  Object.assign(new Error("RPC: starknet_getTransactionStatus"), { baseError: { code: 29 } });

type Script = {
  readonly tip?: number;
  readonly validity?: "fail" | string;
  readonly nonce?: string;
  readonly status?: "not-found" | "pending" | "transport";
};

const node = (script: Script = {}) => {
  const reads: string[] = [];
  const provider = {
    callContract: async (call: { entrypoint: string; contractAddress: string }) => {
      reads.push(`call:${call.entrypoint}@${call.contractAddress}`);
      if (script.validity === "fail") throw new Error("socket hang up");
      return [script.validity ?? "0x1c2"];
    },
    getBlockNumber: async () => {
      reads.push("block");
      return script.tip ?? CLOSED_TIP;
    },
    getNonceForAddress: async () => {
      reads.push("nonce");
      return script.nonce ?? "0x5";
    },
    getTransactionStatus: async () => {
      reads.push("status");
      if (script.status === "pending") return { finality_status: "RECEIVED" };
      throw script.status === "transport" ? new Error("socket hang up") : notFound();
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

const refusal = async (store: Strk20MaturityStore, script: Script): Promise<string> => {
  const rejected = await runtimeFor(store)
    .provingBlock(node(script).provider, scope)
    .then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
  return rejected;
};

describe("a relay claim (M1a)", () => {
  const relay: Strk20MaturityRecord = { proofBaseBlock: BASE, route: "relay", state: "submitting" };

  test("is released once a settled block is past its proof window", async () => {
    const store = await seeded(relay);
    const { provider, reads } = node({ tip: CLOSED_TIP });

    await expect(runtimeFor(store).provingBlock(provider, scope)).resolves.toBe(CLOSED_TIP - 10);
    expect(await store.read(scope)).toBeNull();
    expect(reads).toContain("call:get_proof_validity_blocks@0x123");
  });

  test("stays closed, and checkable, while the window is open", async () => {
    const store = await seeded(relay);
    expect(await refusal(store, { tip: OPEN_TIP })).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await store.read(scope)).toEqual(relay);
  });

  test("stays closed when the pool's window cannot be read or is not a u64", async () => {
    for (const validity of ["fail", `0x${"f".repeat(17)}`]) {
      const store = await seeded(relay);
      expect(await refusal(store, { validity })).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
      expect(await store.read(scope)).toEqual(relay);
    }
  });

  test("with no proof base block is stranded and names the restart", async () => {
    for (const marker of [
      { route: "relay", state: "submitting" },
      { state: "submitting" },
    ] as const) {
      const store = await seeded(marker);
      expect(await refusal(store, {})).toBe(STRK20_PRIOR_WRITE_STRANDED);
      expect(await store.read(scope)).toEqual(marker);
    }
  });

  test("owned by a live send stays closed even with its window closed", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = runtimeFor(store);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: (() => void) | undefined;
    const broadcasting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const send = runtime.submitAccepted(
      node().provider,
      scope,
      "relay",
      async () => "prepared",
      async () => {
        entered?.();
        await gate;
        throw new IndeterminateRpcWriteError("lost");
      },
      () => BASE,
    );
    await broadcasting;

    await expect(runtime.provingBlock(node().provider, scope)).rejects.toThrow(
      STRK20_PRIOR_WRITE_UNRESOLVED,
    );
    release?.();
    await expect(send).rejects.toThrow("lost");
    expect(await store.read(scope)).toEqual(relay);
  });

  test("never releases a newer claim proved at another block", async () => {
    const backing = await seeded(relay);
    const newer: Strk20MaturityRecord = {
      proofBaseBlock: 540,
      route: "relay",
      state: "submitting",
    };
    const store: Strk20MaturityStore = {
      ...backing,
      releaseUnsignedProvedAt: async (target, block) => {
        await backing.write(target, newer);
        return backing.releaseUnsignedProvedAt(target, block);
      },
    };
    expect(await refusal(store, {})).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await backing.read(scope)).toEqual(newer);
  });
});

describe("a signed write the chain cannot settle (M1)", () => {
  const stuck: Strk20MaturityRecord = { ...signed, proofBaseBlock: BASE, state: "submitting" };

  test("with its nonce unspent is released once its proof window has closed", async () => {
    const store = await seeded(stuck);
    expect(await refusal(store, { tip: CLOSED_TIP })).toBe("resolved");
    expect(await store.read(scope)).toBeNull();
  });

  test("with its nonce unspent stays checkable while the window is open", async () => {
    const store = await seeded(stuck);
    expect(await refusal(store, { tip: OPEN_TIP })).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await store.read(scope)).toEqual(stuck);
  });

  test("with no proof base block and an unspent nonce is stranded", async () => {
    const legacy: Strk20MaturityRecord = { ...signed, state: "submitting" };
    const store = await seeded(legacy);
    expect(await refusal(store, {})).toBe(STRK20_PRIOR_WRITE_STRANDED);
    expect(await store.read(scope)).toEqual(legacy);
  });

  test("whose status read failed stays checkable rather than stranded", async () => {
    const legacy: Strk20MaturityRecord = { ...signed, state: "submitting" };
    const store = await seeded(legacy);
    expect(await refusal(store, { status: "transport" })).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
  });
});

describe("a pending earlier write that misses its receipt (L1)", () => {
  test("keeps the may-still-be-in-progress refusal, not a generic one", async () => {
    const store = await seeded({ ...signed, state: "submitting" });
    expect(await refusal(store, { status: "pending", tip: OPEN_TIP })).toBe(
      STRK20_PRIOR_WRITE_UNRESOLVED,
    );
    expect(await store.read(scope)).toEqual({ ...signed, state: "submitting" });
  });

  test("a submitted write that never confirms is released after its proof window", async () => {
    const store = await seeded({
      proofBaseBlock: BASE,
      state: "submitted",
      transactionHash: "0x456",
    });
    expect(await refusal(store, { tip: OPEN_TIP })).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await refusal(store, { tip: CLOSED_TIP })).toBe("resolved");
    expect(await store.read(scope)).toBeNull();
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
    expect(await refusal(store, {})).toBe("resolved");
  });

  test("still refuses when a different marker took its place", async () => {
    const backing = await seeded({ route: "account", state: "submitting" });
    const store: Strk20MaturityStore = {
      ...backing,
      releaseUnsigned: async (target) => {
        await backing.write(target, { ...signed, state: "submitting" });
        return backing.releaseUnsigned(target);
      },
    };
    expect(await refusal(store, {})).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
  });
});

describe("recording the proof base block", () => {
  test("reads the base block from the pool's proof-facts layout", () => {
    expect(strk20ProofBaseBlock(["0x1", "0x2", "0x3", "0x4", "0x64", "0xabc"])).toBe(100);
    expect(strk20ProofBaseBlock(["0x1"])).toBeNull();
    expect(strk20ProofBaseBlock(["0x1", "0x2", "0x3", "0x4", "100"])).toBe(100);
    expect(strk20ProofBaseBlock(["0x1", "0x2", "0x3", "0x4", "-1"])).toBeNull();
    expect(strk20ProofBaseBlock(["0x1", "0x2", "0x3", "0x4", `0x${"f".repeat(20)}`])).toBeNull();
  });

  test("keeps it on the claim, the journaled identity, and the submitted record", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = runtimeFor(store);
    const seen: unknown[] = [];
    await runtime.submitAccepted(
      node().provider,
      scope,
      "account",
      async () => "prepared",
      async (_prepared, journal) => {
        seen.push(await store.read(scope));
        await journal(signed);
        seen.push(await store.read(scope));
        return { transactionHash: "0x456" };
      },
      () => BASE,
    );
    expect(seen).toEqual([
      { proofBaseBlock: BASE, route: "account", state: "submitting" },
      { ...signed, proofBaseBlock: BASE, state: "submitting" },
    ]);
  });
});
