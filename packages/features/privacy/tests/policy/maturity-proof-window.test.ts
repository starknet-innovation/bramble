/**
 * What the review rounds of mc-wallet #661 settled (M1, L1, L3, and the
 * second review's counterexamples).
 *
 * - A signed write whose nonce is still unspent at the tip is released once
 *   the pool would refuse its proof in every later block: the settled block
 *   is past base + `get_proof_validity_blocks()`. The tip-nonce read is what
 *   keeps a window LOWERED after the write applied from hiding that inclusion.
 * - A relay claim (or one with no recorded route) that names no hash has
 *   nothing the chain can be asked about, and the pool window cannot bound it
 *   for the same reason, so it is stranded: the refusal names the restart.
 * - A prior write whose receipt wait fails keeps the "may still be in
 *   progress" refusal and is never released by the window (L1).
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
const stuck: Strk20MaturityRecord = { ...signed, proofBaseBlock: BASE, state: "submitting" };

const notFound = (): Error =>
  Object.assign(new Error("RPC: starknet_getTransactionStatus"), { baseError: { code: 29 } });

type Script = {
  readonly tip?: number;
  readonly validity?: "fail" | string;
  // Sender nonce at the settled block, then at the tip.
  readonly settledNonce?: string;
  readonly tipNonce?: string;
  readonly status?: "not-found" | "pending" | "transport";
};

const node = (script: Script = {}) => {
  const reads: string[] = [];
  const tip = script.tip ?? CLOSED_TIP;
  const provider = {
    callContract: async (call: { entrypoint: string; contractAddress: string }) => {
      reads.push(`call:${call.entrypoint}@${call.contractAddress}`);
      if (script.validity === "fail") throw new Error("socket hang up");
      return [script.validity ?? "0x1c2"];
    },
    getBlockNumber: async () => {
      reads.push("block");
      return tip;
    },
    getNonceForAddress: async (_address: string, block: unknown) => {
      reads.push(`nonce@${String(block)}`);
      return block === tip ? (script.tipNonce ?? "0x5") : (script.settledNonce ?? "0x5");
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

const outcome = (store: Strk20MaturityStore, script: Script): Promise<string> =>
  runtimeFor(store)
    .provingBlock(node(script).provider, scope)
    .then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

describe("a signed write the node does not know, nonce unspent", () => {
  test("is released once the pool refuses its proof in every later block", async () => {
    const store = await seeded(stuck);
    const { provider, reads } = node({ tip: CLOSED_TIP });

    await expect(runtimeFor(store).provingBlock(provider, scope)).resolves.toBe(CLOSED_TIP - 10);
    expect(await store.read(scope)).toBeNull();
    expect(reads).toContain("call:get_proof_validity_blocks@0x123");
    expect(reads).toContain(`nonce@${CLOSED_TIP}`);
  });

  test("stays checkable while the window is open", async () => {
    const store = await seeded(stuck);
    expect(await outcome(store, { tip: OPEN_TIP })).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await store.read(scope)).toEqual(stuck);
  });

  test("is kept when the tip shows its nonce spent: it may have applied while the window allowed", async () => {
    // Review round 2: a window lowered after the write applied would make it
    // look expired. The tip nonce shows the inclusion.
    const store = await seeded(stuck);
    expect(await outcome(store, { tip: CLOSED_TIP, tipNonce: "0x6" })).toBe(
      STRK20_PRIOR_WRITE_UNRESOLVED,
    );
    expect(await store.read(scope)).toEqual(stuck);
  });

  test("is kept when the pool's window cannot be read or is not a u64", async () => {
    for (const validity of ["fail", `0x${"f".repeat(17)}`]) {
      const store = await seeded(stuck);
      expect(await outcome(store, { validity })).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
      expect(await store.read(scope)).toEqual(stuck);
    }
  });

  test("with no proof base block stays checkable rather than stranded", async () => {
    // Another transaction can still spend its nonce, which resolves it.
    const legacy: Strk20MaturityRecord = { ...signed, state: "submitting" };
    const store = await seeded(legacy);
    expect(await outcome(store, {})).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await store.read(scope)).toEqual(legacy);
  });

  test("whose status read failed is never released by the window", async () => {
    const store = await seeded(stuck);
    expect(await outcome(store, { status: "transport" })).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
    expect(await store.read(scope)).toEqual(stuck);
  });

  test("owned by a live send is never released by the window", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = runtimeFor(store);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let journaled: (() => void) | undefined;
    const signedNow = new Promise<void>((resolve) => {
      journaled = resolve;
    });
    const send = runtime.submitAccepted(
      node().provider,
      scope,
      "account",
      async () => "prepared",
      async (_prepared, journal) => {
        await journal(signed);
        journaled?.();
        await gate;
        throw new IndeterminateRpcWriteError("lost");
      },
      () => BASE,
    );
    await signedNow;

    await expect(runtime.provingBlock(node().provider, scope)).rejects.toThrow(
      STRK20_PRIOR_WRITE_UNRESOLVED,
    );
    expect(await store.read(scope)).toEqual(stuck);
    release?.();
    await expect(send).rejects.toThrow("lost");
    expect(await store.read(scope)).toEqual(stuck);
  });
});

describe("a relay claim with no hash", () => {
  test("is stranded even when its proof window has closed", async () => {
    // Review round 2: a window lowered after the relayed write applied would
    // make it look expired while it sits past the next proof's block.
    for (const marker of [
      { proofBaseBlock: BASE, route: "relay", state: "submitting" },
      { route: "relay", state: "submitting" },
      { state: "submitting" },
    ] as const) {
      const store = await seeded(marker);
      const { provider, reads } = node({ tip: CLOSED_TIP });
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
    expect(await outcome(store, { tip: CLOSED_TIP })).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
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
    expect(await outcome(store, {})).toBe("resolved");
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
    expect(await outcome(store, {})).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
  });

  test("proceeds when another check already released an expired signed write", async () => {
    const backing = await seeded(stuck);
    const store: Strk20MaturityStore = {
      ...backing,
      replaceIfCurrentHash: async (target, hash, record) => {
        await backing.write(target, null);
        return backing.replaceIfCurrentHash(target, hash, record);
      },
    };
    expect(await outcome(store, {})).toBe("resolved");
  });
});

describe("recording the proof base block", () => {
  test("reads the base block from the pool's proof-facts layout", () => {
    expect(strk20ProofBaseBlock(["0x1", "0x2", "0x3", "0x4", "0x64", "0xabc"])).toBe(100);
    expect(strk20ProofBaseBlock(["0x1"])).toBeNull();
    expect(strk20ProofBaseBlock(["0x1", "0x2", "0x3", "0x4", "-1"])).toBeNull();
    expect(strk20ProofBaseBlock(["0x1", "0x2", "0x3", "0x4", `0x${"f".repeat(20)}`])).toBeNull();
  });

  test("keeps it on the claim and on the journaled identity", async () => {
    const store = memoryStrk20MaturityStore();
    const seen: unknown[] = [];
    await runtimeFor(store).submitAccepted(
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
