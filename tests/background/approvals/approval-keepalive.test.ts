/**
 * A pending decision has to hold Firefox's non-persistent event page open
 * (#350).
 *
 * The approval queue and the signature-waiter registry are in-memory only, so a
 * Firefox event page suspended on its idle timer loses an unanswered prompt and
 * every parked dapp response with it. The remedy Firefox's lifecycle describes
 * is a parent API call on an interval while a decision is pending. A true
 * suspension cannot be driven in a unit runner, so these checks assert the
 * behaviour that prevents one: the keepalive fires on every cadence step across
 * a window longer than the idle timeout with the prompt still queued, and stops
 * once the prompt is decided, so no timer outlives the state it protects.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import {
  APPROVAL_KEEPALIVE_MS,
  createApprovalKeepAlive,
} from "../../../apps/extension/src/background/approvals/approval-keepalive";
import { setApprovalNotifier } from "../../../apps/extension/src/background/approvals/approval-notifier";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createSignatureWaiters } from "../../../apps/extension/src/background/approvals/signature-waiters";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
  testExtension,
} from "../../support/background-wallet-stub";
import { flushHeld } from "../../support/held";

// The idle window both Chromium and Firefox use to tear a worker down; the
// keepalive cadence has to fire inside it with room to spare.
const WORKER_IDLE_TIMEOUT_MS = 30_000;

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

/**
 * An injected interval scheduler. `tick` runs the most recently scheduled
 * callback once, standing in for the idle window elapsing; `cancelled` counts
 * how many times the controller released the interval.
 */
const scheduler = () => {
  const scheduled: (() => void)[] = [];
  let cancelled = 0;
  return {
    cancelled: () => cancelled,
    schedule: (tick: () => void): (() => void) => {
      scheduled.push(tick);
      return () => {
        cancelled += 1;
      };
    },
    scheduledCount: () => scheduled.length,
    tick: () => {
      scheduled.at(-1)?.();
    },
  };
};

const metadataRpc = (): RuntimeRpc => ({
  async estimateInvokeFee() {
    throw new Error("unused");
  },
  async getDeploymentStatus() {
    return true;
  },
  async getNftOwner() {
    return "0x1";
  },
  async getTokenBalances() {
    return [];
  },
  async getTokenMetadata(input) {
    return input.address === USDC
      ? { decimals: 6, name: "USD Coin", symbol: "USDC" }
      : { decimals: 18, name: "Token", symbol: "TKN" };
  },
  async getTransactionStatuses() {
    return {};
  },
  async submitAccountDeployment() {
    throw new Error("unused");
  },
  async submitDeclareTransaction() {
    return { classHash: "0x1", transactionHash: "0x1" };
  },
  async submitErc20Transfer() {
    throw new Error("unused");
  },
  async submitInvokeTransaction() {
    throw new Error("unused");
  },
});

// The entrypoint clears the shared notifier sink on unload; leaving this test's
// sink installed would leak into any later file in the same runner.
afterAll(() => {
  setApprovalNotifier(() => undefined);
});

describe("createApprovalKeepAlive", () => {
  const setup = (pending: () => boolean) => {
    const sched = scheduler();
    let calls = 0;
    const keepAlive = createApprovalKeepAlive({
      intervalMs: APPROVAL_KEEPALIVE_MS,
      isPending: pending,
      keepAlive: () => {
        calls += 1;
      },
      schedule: sched.schedule,
    });
    return { calls: () => calls, keepAlive, sched };
  };

  test("schedules nothing while no decision is pending", () => {
    const { keepAlive, sched } = setup(() => false);
    keepAlive.sync();
    expect(keepAlive.active()).toBe(false);
    expect(sched.scheduledCount()).toBe(0);
  });

  test("runs the keepalive on every cadence step while a decision is pending", () => {
    const { calls, keepAlive, sched } = setup(() => true);
    keepAlive.sync();
    expect(keepAlive.active()).toBe(true);
    // sync is idempotent: a second approval change must not stack intervals.
    keepAlive.sync();
    expect(sched.scheduledCount()).toBe(1);

    const steps = Math.ceil(WORKER_IDLE_TIMEOUT_MS / APPROVAL_KEEPALIVE_MS) + 2;
    for (let step = 0; step < steps; step += 1) {
      sched.tick();
    }
    expect(calls()).toBe(steps);
  });

  test("stops on the first tick that finds nothing pending", () => {
    let pending = true;
    const { calls, keepAlive, sched } = setup(() => pending);
    keepAlive.sync();
    sched.tick();
    expect(calls()).toBe(1);

    pending = false;
    sched.tick();
    expect(keepAlive.active()).toBe(false);
    expect(calls()).toBe(1);
    expect(sched.cancelled()).toBe(1);
  });

  test("stops immediately when the decision is already settled", () => {
    let pending = true;
    const { calls, keepAlive, sched } = setup(() => pending);
    keepAlive.sync();
    pending = false;
    keepAlive.sync();
    expect(keepAlive.active()).toBe(false);
    sched.tick();
    expect(calls()).toBe(0);
  });

  test("restarts for a later prompt once the previous one is settled", () => {
    let pending = false;
    const { calls, keepAlive, sched } = setup(() => pending);
    keepAlive.sync();
    pending = true;
    keepAlive.sync();
    expect(keepAlive.active()).toBe(true);
    sched.tick();
    expect(calls()).toBe(1);
  });

  test("never schedules without a keepalive call", () => {
    const sched = scheduler();
    const keepAlive = createApprovalKeepAlive({
      isPending: () => true,
      schedule: sched.schedule,
    });
    keepAlive.sync();
    expect(keepAlive.active()).toBe(false);
    expect(sched.scheduledCount()).toBe(0);
  });
});

describe("pending approval worker keepalive (#350)", () => {
  // The queue, the waiters, and the keepalive wired as the entrypoint wires
  // them, including the notifier that starts and stops the interval.
  const setup = () => {
    const approvals = createApprovalQueue();
    const waiters = createSignatureWaiters();
    const sched = scheduler();
    let calls = 0;
    const keepAlive = createApprovalKeepAlive({
      intervalMs: APPROVAL_KEEPALIVE_MS,
      isPending: () => approvals.list().length > 0 || waiters.pending() > 0,
      keepAlive: () => {
        calls += 1;
      },
      schedule: sched.schedule,
    });
    setApprovalNotifier(() => keepAlive.sync());
    return { approvals, calls: () => calls, keepAlive, sched, waiters };
  };

  const handlerFor = (
    approvals: ReturnType<typeof createApprovalQueue>,
    waiters: ReturnType<typeof createSignatureWaiters>,
  ) =>
    createMessageHandler(createWallet(), testExtension, {
      approvals,
      preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
      runtimeRpc: metadataRpc(),
      session: createUnlockSession(),
      waiters,
    });

  test("holds the page open until an unanswered prompt is decided", async () => {
    const { approvals, calls, keepAlive, sched, waiters } = setup();
    const handler = handlerFor(approvals, waiters);

    // A dapp request that queues a prompt and holds its response.
    const held = handler(
      { asset: { address: USDC }, origin: grantedOrigin, type: "wallet.watchAsset" },
      contentSender,
    );
    await flushHeld();
    expect(keepAlive.active()).toBe(true);

    // Elapse a window four times the idle timeout in cadence steps: the
    // keepalive fires on each one, so the page never reaches its idle timer.
    const steps = Math.ceil((WORKER_IDLE_TIMEOUT_MS * 4) / APPROVAL_KEEPALIVE_MS);
    for (let step = 0; step < steps; step += 1) {
      sched.tick();
    }
    expect(calls()).toBe(steps);

    // The prompt is still answerable after that window, not lost to the timer.
    const listed = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
      readonly pending: readonly { readonly id: string }[];
    };
    expect(listed.pending).toHaveLength(1);
    const id = listed.pending[0]?.id ?? "";
    expect(id).not.toBe("");

    // Deny it: the entrypoint's approvals-changed broadcast releases the
    // interval, and the held response settles with the decision.
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    keepAlive.sync();
    expect(keepAlive.active()).toBe(false);
    expect(await held).toEqual({ error: "request rejected" });
  });

  test("a parked signature waiter alone keeps the keepalive running until it settles", async () => {
    const { approvals, keepAlive, sched, waiters } = setup();
    const approval = approvals.request(grantedOrigin);
    keepAlive.sync();
    expect(keepAlive.active()).toBe(true);

    const held = waiters.register(approval.id);
    sched.tick();
    expect(keepAlive.active()).toBe(true);

    // Settling the parked response and claiming the approval leaves nothing
    // pending, so the interval stops.
    waiters.settle(approval.id, { ok: true });
    approvals.claim(approval.id);
    keepAlive.sync();
    expect(keepAlive.active()).toBe(false);
    await expect(held).resolves.toEqual({ ok: true });
  });
});
