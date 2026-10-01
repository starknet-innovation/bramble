/**
 * A privacy write whose send lost its answer keeps its scope closed, but once
 * the write's signed identity is journaled the next action resolves it
 * on-chain instead of waiting for the browser session to end. The rules pinned
 * here are the safety argument: any status answer means the write reached the
 * network and is followed like any submitted write, except REJECTED, which
 * releases the scope because that hash will not be included; "not found"
 * releases the scope only when the sender's nonce is a field element provably
 * spent past the write in a settled block and a second lookup still misses;
 * everything else stays closed, exactly as before.
 */

import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  memoryStrk20MaturityStore,
  type Strk20MaturityRecord,
  type Strk20MaturityStore,
} from "@bramble/privacy/maturity";
import { createStrk20MaturityRuntime } from "@bramble/privacy/official-sdk-maturity";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import type { RpcProvider } from "starknet";

const scope = {
  accountId: "SN_SEPOLIA:0xabc",
  networkId: "SN_SEPOLIA" as const,
  poolAddress: "0x123",
};
const signed = { nonce: "0x5", senderAddress: "0xdef", transactionHash: "0x456" };
const stuck: Strk20MaturityRecord = { ...signed, state: "submitting" };
const STATUS_UNKNOWN = "close every browser window and reopen the browser to recover";

const notFound = (): Error =>
  Object.assign(new Error("RPC: starknet_getTransactionStatus"), { baseError: { code: 29 } });

type NodeScript = {
  readonly blocks?: number[];
  readonly nonce?: unknown;
  readonly statuses?: Array<"found" | "not-found" | "rejected" | "transport">;
  readonly receipt?: { readonly block_number: number; readonly success: boolean };
};

// A scripted node: each status lookup consumes the next scripted answer, and
// every read is recorded so a test can prove what was (and was not) asked.
const node = (script: NodeScript) => {
  const reads: string[] = [];
  const statuses = [...(script.statuses ?? [])];
  const blocks = [...(script.blocks ?? [])];
  const provider = {
    getBlockNumber: async () => {
      reads.push("block");
      return blocks.shift() ?? 100;
    },
    getNonceForAddress: async (address: string, block: unknown) => {
      reads.push(`nonce:${address}@${String(block)}`);
      return script.nonce ?? "0x5";
    },
    getTransactionStatus: async (hash: string) => {
      reads.push(`status:${hash}`);
      const answer = statuses.shift() ?? "not-found";
      if (answer === "found") {
        return { execution_status: "SUCCEEDED", finality_status: "ACCEPTED_ON_L2" };
      }
      if (answer === "rejected") {
        return { finality_status: "REJECTED" };
      }
      throw answer === "transport" ? new Error("socket hang up") : notFound();
    },
    waitForTransaction: async (hash: string) => {
      reads.push(`wait:${hash}`);
      return {
        block_number: script.receipt?.block_number ?? 50,
        isSuccess: () => script.receipt?.success ?? true,
      };
    },
  };
  return { provider: provider as unknown as RpcProvider, reads };
};

const seeded = async (record: Strk20MaturityRecord | null = stuck) => {
  const store = memoryStrk20MaturityStore();
  if (record) {
    await store.write(scope, record);
  }
  return store;
};

const runtimeFor = (store: Strk20MaturityStore) =>
  createStrk20MaturityRuntime({ pause: async () => undefined, store });

describe("journaling a signed privacy write", () => {
  test("persists the canonical identity before the send can lose its answer", async () => {
    const store = await seeded(null);
    const runtime = runtimeFor(store);

    await expect(
      runtime.submitAccepted(
        node({}).provider,
        scope,
        async () => "prepared",
        async (_prepared, journal) => {
          await journal({ nonce: "0x05", senderAddress: "0x0DEF", transactionHash: "0x0456" });
          throw new IndeterminateRpcWriteError("status unknown");
        },
      ),
    ).rejects.toThrow("status unknown");

    expect(await store.read(scope)).toEqual(stuck);
  });

  test("refuses a malformed identity, which aborts the send and releases the scope", async () => {
    const store = await seeded(null);
    const runtime = runtimeFor(store);

    const rejected = await runtime
      .submitAccepted(
        node({}).provider,
        scope,
        async () => "prepared",
        async (_prepared, journal) => {
          await journal({ ...signed, transactionHash: "0x0" });
          return { transactionHash: "0x456" };
        },
      )
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(rejected).toBeInstanceOf(WalletError);
    expect(rejected).not.toBeInstanceOf(IndeterminateRpcWriteError);
    // Nothing was sent, so the scope must not stay closed.
    expect(await store.read(scope)).toBeNull();
  });
});

describe("resolving a stuck privacy write", () => {
  test("follows a write the node knows to its accepted block, then proves past it", async () => {
    const store = await seeded();
    const { provider, reads } = node({ blocks: [100], statuses: ["found"] });

    await expect(runtimeFor(store).provingBlock(provider, scope)).resolves.toBe(90);

    expect(await store.read(scope)).toEqual({
      acceptedBlock: 50,
      state: "submitted",
      transactionHash: "0x456",
    });
    // A found write is never checked against the nonce: it reached the network.
    expect(reads.some((read) => read.startsWith("nonce:"))).toBe(false);
  });

  test("releases through the existing rejection path when the found write reverted", async () => {
    const store = await seeded();
    const { provider } = node({
      receipt: { block_number: 50, success: false },
      statuses: ["found"],
    });

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(WalletError);
    expect(await store.read(scope)).toBeNull();
  });

  test("releases a write the node does not know once its nonce is spent in a settled block", async () => {
    const store = await seeded();
    const { provider, reads } = node({
      blocks: [100, 100],
      nonce: "0x6",
      statuses: ["not-found", "not-found"],
    });

    await expect(runtimeFor(store).provingBlock(provider, scope)).resolves.toBe(90);

    expect(await store.read(scope)).toBeNull();
    // The nonce is read PROVING_BLOCK_DEPTH below the tip, and the hash is
    // looked up again only after it.
    expect(reads.slice(0, 4)).toEqual(["status:0x456", "block", "nonce:0xdef@90", "status:0x456"]);
  });

  test("keeps the scope closed while the write's nonce is still unspent", async () => {
    const store = await seeded();
    const { provider } = node({ nonce: "0x5", statuses: ["not-found"] });

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(STATUS_UNKNOWN);
    expect(await store.read(scope)).toEqual(stuck);
  });

  test("never releases a write that a lagging first lookup missed", async () => {
    const store = await seeded();
    const { provider } = node({
      blocks: [100, 100],
      nonce: "0x6",
      statuses: ["not-found", "found"],
    });

    await expect(runtimeFor(store).provingBlock(provider, scope)).resolves.toBe(90);
    // The second lookup found it, so it is followed as a submitted write.
    expect(await store.read(scope)).toEqual({
      acceptedBlock: 50,
      state: "submitted",
      transactionHash: "0x456",
    });
  });

  test("keeps the scope closed when the node cannot be asked", async () => {
    const store = await seeded();
    const { provider, reads } = node({ statuses: ["transport"] });

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(STATUS_UNKNOWN);
    expect(await store.read(scope)).toEqual(stuck);
    expect(reads).toEqual(["status:0x456"]);
  });

  test("keeps the scope closed on a chain too young to have a settled block", async () => {
    const store = await seeded();
    const { provider } = node({ blocks: [5], nonce: "0x6", statuses: ["not-found"] });

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(STATUS_UNKNOWN);
    expect(await store.read(scope)).toEqual(stuck);
  });

  test("still refuses a marker that names no signed write, without asking the node", async () => {
    const store = await seeded({ state: "submitting" });
    const { provider, reads } = node({ statuses: ["found"] });

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(STATUS_UNKNOWN);
    expect(reads).toEqual([]);
  });

  test("releases a rejected write without following it or dropping its nonce first", async () => {
    const store = await seeded();
    const { provider, reads } = node({ statuses: ["rejected"] });

    await expect(runtimeFor(store).provingBlock(provider, scope)).resolves.toBe(90);

    expect(await store.read(scope)).toBeNull();
    expect(reads).toEqual(["status:0x456", "block"]);
  });

  test("keeps the scope closed when the chain nonce is not a field element", async () => {
    const store = await seeded();
    const { provider, reads } = node({
      nonce: `0x${"f".repeat(64)}`,
      statuses: ["not-found"],
    });

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(STATUS_UNKNOWN);
    expect(await store.read(scope)).toEqual(stuck);
    expect(reads.filter((read) => read.startsWith("status:"))).toEqual(["status:0x456"]);
  });

  test("treats a decimal chain nonce as spent once it canonicalizes to a field element", async () => {
    const store = await seeded();
    const { provider } = node({
      nonce: "6",
      statuses: ["not-found", "not-found"],
    });

    await expect(runtimeFor(store).provingBlock(provider, scope)).resolves.toBe(90);
    expect(await store.read(scope)).toBeNull();
  });

  test("stops when the store refuses to replace a marker a newer send already owns", async () => {
    const backing = await seeded();
    const newer: Strk20MaturityRecord = {
      nonce: "0x9",
      senderAddress: "0xdef",
      state: "submitting",
      transactionHash: "0x789",
    };
    const writes: unknown[] = [];
    const store: Strk20MaturityStore = {
      read: (target) => backing.read(target),
      replaceIfCurrentHash: async () => {
        await backing.write(scope, newer);
        return false;
      },
      write: async (target, record) => {
        writes.push(record);
        await backing.write(target, record);
      },
    };
    const { provider, reads } = node({
      blocks: [100],
      nonce: "0x6",
      statuses: ["not-found", "not-found"],
    });

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(STATUS_UNKNOWN);
    expect(writes).toEqual([]);
    expect(await backing.read(scope)).toEqual(newer);
    expect(reads.some((read) => read.startsWith("wait:"))).toBe(false);
  });

  test("fails closed when a newer send replaces the marker during the receipt wait", async () => {
    const store = await seeded({ state: "submitted", transactionHash: "0x456" });
    const newer: Strk20MaturityRecord = { state: "submitted", transactionHash: "0x789" };
    const { provider: base } = node({
      blocks: [100],
      receipt: { block_number: 50, success: true },
    });
    const provider = Object.assign(Object.create(base) as RpcProvider, {
      waitForTransaction: async () => {
        // A serialized submission moves the scope to its own transaction
        // while this caller is still waiting on the old one.
        await store.write(scope, newer);
        return { block_number: 50, isSuccess: () => true };
      },
    });

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(STATUS_UNKNOWN);
    expect(await store.read(scope)).toEqual(newer);
  });
});
