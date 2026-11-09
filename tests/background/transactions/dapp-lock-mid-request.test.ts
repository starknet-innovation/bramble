/**
 * A lock that lands while a dapp request is in flight admits no card
 * (Sherlock 166). `wallet.signTypedData`, `wallet.switchChain` and
 * `wallet.addDeclareTransaction` capture the session authorization before
 * their first read and re-check it after every await, like the executors in
 * the same files, so a user who locks mid-request never sees a prompt queued
 * under the unlock they just revoked.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { createMemoryStore } from "@bramble/store/kv";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const FEE: FeeEstimate = { overallFee: "1000", unit: "FRI" };

const typedData = {
  domain: { chainId: "0x534e5f5345504f4c4941", name: "Lock", version: "1" },
  message: { note: "0x1" },
  primaryType: "Note",
  types: {
    Note: [{ name: "note", type: "felt" }],
    StarkNetDomain: [
      { name: "name", type: "felt" },
      { name: "version", type: "felt" },
      { name: "chainId", type: "felt" },
    ],
  },
};

const declare = {
  classHash: "0x5abc",
  compiledClassHash: "0x6def",
  contractClass: { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] },
};

// `lockDuring` names the await the lock lands in: the grant read, or (for a
// declare) the fee estimate that follows it. `readsAfterLock` counts every
// wallet call and fee estimate that starts after the lock, so each re-check is
// pinned on its own, not only by the last one before the card is queued.
const harness = async (lockDuring: "grants" | "after-grants" | "estimate" | "never") => {
  const session = createUnlockSession();
  let locked = false;
  let granted = false;
  let readsAfterLock = 0;
  const lock = () => {
    session.lock();
    locked = true;
  };
  const inner = createWallet();
  const wallet = new Proxy(inner, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        if (locked) readsAfterLock += 1;
        if (granted && lockDuring === "after-grants" && !locked) lock();
        const result = await value.apply(target, args);
        if (key === "getGrantedAccounts") {
          granted = true;
          if (lockDuring === "grants") lock();
        }
        return result;
      };
    },
  });
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  const handler = createMessageHandler(wallet, testExtension, {
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({
      async estimateDeclareFee() {
        if (locked) readsAfterLock += 1;
        if (lockDuring === "estimate") lock();
        return FEE;
      },
      async getDeploymentStatus() {
        return true;
      },
    }),
    session,
  });
  session.unlock(vaultPassphrase);
  const pending = async () =>
    (
      (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
        readonly pending: readonly unknown[];
      }
    ).pending;
  return { handler, pending, readsAfterLock: () => readsAfterLock };
};

// A request that queues a card is held until the user decides, so a test
// expecting a refusal races it against a short timer instead of hanging.
const settle = (response: Promise<unknown>): Promise<unknown> =>
  Promise.race([
    response,
    new Promise((resolve) => setTimeout(() => resolve("held for a decision"), 200)),
  ]);

const signRequest = { origin: grantedOrigin, type: "wallet.signTypedData", typedData };
const switchRequest = {
  chainId: "0x534e5f4d41494e",
  origin: grantedOrigin,
  type: "wallet.switchChain",
};
const declareRequest = { declare, origin: grantedOrigin, type: "wallet.addDeclareTransaction" };

describe("a lock during a dapp request", () => {
  test("signTypedData queues nothing when the lock lands during the grant read", async () => {
    const { handler, pending, readsAfterLock } = await harness("grants");
    await expect(settle(handler(signRequest, contentSender))).resolves.toEqual({
      error: "wallet locked",
    });
    expect(readsAfterLock()).toBe(0);
    expect(await pending()).toEqual([]);
  });

  test("signTypedData queues nothing when the lock lands after the grant read", async () => {
    const { handler, pending } = await harness("after-grants");
    await expect(settle(handler(signRequest, contentSender))).resolves.toEqual({
      error: "wallet locked",
    });
    expect(await pending()).toEqual([]);
  });

  test("switchChain queues nothing when the lock lands during the grant read", async () => {
    const { handler, pending } = await harness("grants");
    await expect(settle(handler(switchRequest, contentSender))).resolves.toEqual({
      error: "origin not connected",
    });
    expect(await pending()).toEqual([]);
  });

  test("a declare queues nothing when the lock lands during the grant read", async () => {
    const { handler, pending, readsAfterLock } = await harness("grants");
    await expect(settle(handler(declareRequest, contentSender))).resolves.toEqual({
      error: "wallet locked",
    });
    expect(readsAfterLock()).toBe(0);
    expect(await pending()).toEqual([]);
  });

  test("a declare queues nothing when the lock lands during its fee estimate", async () => {
    const { handler, pending } = await harness("estimate");
    await expect(settle(handler(declareRequest, contentSender))).resolves.toEqual({
      error: "wallet locked",
    });
    expect(await pending()).toEqual([]);
  });

  test("with no lock, each request still queues its card", async () => {
    const { handler, pending } = await harness("never");
    const settled: unknown[] = [];
    for (const request of [signRequest, switchRequest, declareRequest]) {
      void handler(request, contentSender).then((response) => settled.push(response));
    }
    for (let attempt = 0; attempt < 50 && (await pending()).length < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(settled).toEqual([]);
    expect(await pending()).toHaveLength(3);
  });
});
