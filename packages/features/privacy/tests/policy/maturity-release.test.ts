/**
 * When a stranded `submitting` marker is released (mc-wallet #661). The marker
 * is released only when its write provably cannot change pool state: an
 * account-route claim that never gained a signed identity and that no running
 * send owns, a REJECTED hash, or an unknown hash whose nonce another
 * transaction spent in a settled block. A write found on chain is settled
 * through the receipt wait. Everything else stays closed — in particular an
 * unknown hash whose nonce is still unspent, because a signed invoke has no
 * expiry and can still be included at that nonce.
 */

import { describe, expect, test } from "bun:test";
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
const STATUS_UNKNOWN = "may still be in progress";

type Status = "accepted" | "not-found" | "pending" | "reverted";

const notFound = (): Error =>
  Object.assign(new Error("RPC: starknet_getTransactionStatus"), { baseError: { code: 29 } });

// A scripted node that records every read, so a test can prove a released
// unsigned claim never asked the chain anything.
const node = (script: { nonce?: string; statuses?: Status[]; success?: boolean } = {}) => {
  const reads: string[] = [];
  const statuses = [...(script.statuses ?? [])];
  const provider = {
    getBlockNumber: async () => {
      reads.push("block");
      return 100;
    },
    getNonceForAddress: async () => {
      reads.push("nonce");
      return script.nonce ?? "0x5";
    },
    getTransactionStatus: async (hash: string) => {
      reads.push(`status:${hash}`);
      const answer = statuses.shift() ?? "not-found";
      switch (answer) {
        case "accepted":
          return { execution_status: "SUCCEEDED", finality_status: "ACCEPTED_ON_L2" };
        case "reverted":
          return { execution_status: "REVERTED", finality_status: "ACCEPTED_ON_L2" };
        case "pending":
          return { finality_status: "RECEIVED" };
        default:
          throw notFound();
      }
    },
    waitForTransaction: async (hash: string) => {
      reads.push(`wait:${hash}`);
      if (script.statuses?.includes("pending")) {
        throw notFound();
      }
      return { block_number: 50, isSuccess: () => script.success ?? true };
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

// The next privacy action on the scope: a send that journals and lands.
const nextAction = (store: Strk20MaturityStore) =>
  runtimeFor(store).submitAccepted(
    node({ statuses: ["accepted"] }).provider,
    scope,
    "account",
    async () => "prepared",
    async (_prepared, journal) => {
      await journal({ nonce: "0x6", senderAddress: "0xdef", transactionHash: "0x789" });
      return { transactionHash: "0x789" };
    },
  );

describe("releasing a stranded privacy marker", () => {
  test("releases an account claim that was never signed, without asking the node", async () => {
    const store = await seeded({ route: "account", state: "submitting" });
    const { provider, reads } = node();

    await expect(runtimeFor(store).provingBlock(provider, scope)).resolves.toBe(90);

    expect(await store.read(scope)).toBeNull();
    expect(reads).toEqual(["block"]);
    await expect(nextAction(store)).resolves.toEqual({ transactionHash: "0x789" });
  });

  for (const marker of [
    { route: "relay", state: "submitting" },
    { state: "submitting" },
  ] as const) {
    test(`keeps a ${marker.state} claim with route ${String(
      "route" in marker ? marker.route : "unrecorded",
    )} closed`, async () => {
      const store = await seeded(marker);
      const { provider, reads } = node();

      await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(STATUS_UNKNOWN);
      expect(await store.read(scope)).toEqual(marker);
      expect(reads).toEqual([]);
    });
  }

  test("keeps an unsigned account claim closed while its own send is still running", async () => {
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
      "account",
      async () => "prepared",
      async (_prepared, journal) => {
        entered?.();
        // Still estimating: the invoke is not signed yet, but it will be.
        await gate;
        await journal(signed);
        throw new IndeterminateRpcWriteError("lost");
      },
    );
    await broadcasting;

    await expect(runtime.provingBlock(node().provider, scope)).rejects.toThrow(STATUS_UNKNOWN);
    expect(await store.read(scope)).toEqual({ route: "account", state: "submitting" });

    release?.();
    await expect(send).rejects.toThrow("lost");
    expect(await store.read(scope)).toEqual(stuck);
  });

  test("releases an unsigned account claim once its send has settled without signing", async () => {
    const store = memoryStrk20MaturityStore();
    const runtime = runtimeFor(store);
    await expect(
      runtime.submitAccepted(
        node().provider,
        scope,
        "account",
        async () => "prepared",
        async () => {
          throw new IndeterminateRpcWriteError("lost before signing");
        },
      ),
    ).rejects.toThrow("lost before signing");
    expect(await store.read(scope)).toEqual({ route: "account", state: "submitting" });

    await expect(runtime.provingBlock(node().provider, scope)).resolves.toBe(90);
    expect(await store.read(scope)).toBeNull();
  });

  test("never releases a marker a send journaled after the claim was read", async () => {
    const backing = await seeded({ route: "account", state: "submitting" });
    const store: Strk20MaturityStore = {
      ...backing,
      // The send's journal lands between the read and the release.
      releaseUnsigned: async (target) => {
        await backing.write(target, stuck);
        return backing.releaseUnsigned(target);
      },
    };

    await expect(runtimeFor(store).provingBlock(node().provider, scope)).rejects.toThrow(
      STATUS_UNKNOWN,
    );
    expect(await backing.read(scope)).toEqual(stuck);
  });

  test("releases a dropped write whose nonce another transaction spent", async () => {
    const store = await seeded(stuck);
    const { provider } = node({ nonce: "0x6", statuses: ["not-found", "not-found"] });

    await expect(runtimeFor(store).provingBlock(provider, scope)).resolves.toBe(90);
    expect(await store.read(scope)).toBeNull();
    await expect(nextAction(store)).resolves.toEqual({ transactionHash: "0x789" });
  });

  test("keeps an unknown write closed while its nonce is unspent", async () => {
    const store = await seeded(stuck);
    const { provider } = node({ nonce: "0x5", statuses: ["not-found"] });

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(STATUS_UNKNOWN);
    expect(await store.read(scope)).toEqual(stuck);
  });

  test("keeps a pending write's signed marker when it does not reach a receipt", async () => {
    const store = await seeded(stuck);
    const { provider } = node({ statuses: ["pending"] });

    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow();
    expect(await store.read(scope)).toEqual(stuck);
  });

  test("settles an accepted write to its block and proves past it", async () => {
    const store = await seeded(stuck);
    const { provider } = node({ statuses: ["accepted"] });

    await expect(runtimeFor(store).provingBlock(provider, scope)).resolves.toBe(90);
    expect(await store.read(scope)).toEqual({
      acceptedBlock: 50,
      state: "submitted",
      transactionHash: "0x456",
    });
    await expect(nextAction(store)).resolves.toEqual({ transactionHash: "0x789" });
  });

  test("settles a reverted write by releasing it, and the next action proceeds", async () => {
    const store = await seeded(stuck);
    const { provider } = node({ statuses: ["reverted"], success: false });

    // The action that finds the revert reports it once; the scope is free.
    await expect(runtimeFor(store).provingBlock(provider, scope)).rejects.toThrow(
      "strk20 services unavailable",
    );
    expect(await store.read(scope)).toBeNull();
    await expect(runtimeFor(store).provingBlock(node().provider, scope)).resolves.toBe(90);
    await expect(nextAction(store)).resolves.toEqual({ transactionHash: "0x789" });
  });
});
