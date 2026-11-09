/**
 * Regression checks for MCW-V09-115: the queue's TTL sweep freed an origin's
 * admission slots without settling the dapp responses parked behind the dropped
 * ids, so the growth the caps exist to bound simply moved from the queue to the
 * waiter registry — and became invisible, because `ApprovalQueue.list()` read
 * empty the whole time.
 *
 * These drive the queue and the registry together (each module alone looks
 * bounded) and then through the real runtime router, which is where the two are
 * wired. Every registered response is settled before a test ends: a parked
 * promise is the leak under test, so leaving one behind would leak it into the
 * runner too.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { errorForMessage, userRefusedOp } from "@bramble/wallet-protocol/rpc-errors";
import {
  APPROVAL_TTL_MS,
  createApprovalQueue,
  MAX_PENDING_APPROVALS,
  MAX_PENDING_APPROVALS_PER_ORIGIN,
} from "../../apps/extension/src/background/approvals/approvals";
import {
  createSignatureWaiters,
  DROPPED_APPROVAL_RESPONSE,
  MAX_WAITERS_PER_APPROVAL,
  releaseWaitersOnApprovalDrop,
  type SignatureWaiters,
} from "../../apps/extension/src/background/approvals/signature-waiters";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
  testExtension,
} from "../support/background-wallet-stub";
import { flushHeld } from "../support/held";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const ATTACKER = "https://evil.example";
const START = 1_700_000_000_000;

const token = (index: number) => ({
  address: `0x${(index + 1).toString(16)}`,
  decimals: 18,
  name: `Token ${index}`,
  networkId: "SN_MAIN" as const,
  symbol: `TK${index}`,
});

// The queue and registry wired exactly as the router context wires them, over a
// clock the test advances. `changes` counts the surface repaints expiry asks
// for, so a swept card cannot stay on screen unanswerable.
const boundRegistry = () => {
  const clock = { now: START };
  const approvals = createApprovalQueue({ now: () => clock.now });
  const waiters = createSignatureWaiters();
  const changes: number[] = [];
  releaseWaitersOnApprovalDrop(approvals, waiters, () => changes.push(clock.now));
  return { approvals, changes, clock, waiters };
};

// One round of the flood: request watch-asset prompts for distinct tokens (the
// dedupe-defeating vector) and park a held response behind each admitted one.
// Refusals past the per-origin cap are the expected steady state.
const floodRound = (
  approvals: ReturnType<typeof createApprovalQueue>,
  waiters: SignatureWaiters,
  origin: string,
  offset: number,
): readonly Promise<unknown>[] => {
  const held: Promise<unknown>[] = [];
  for (let attempt = 0; attempt < MAX_WAITERS_PER_APPROVAL; attempt += 1) {
    try {
      const approval = approvals.requestWatchAsset({ origin, token: token(offset + attempt) });
      held.push(waiters.register(approval.id));
    } catch {
      // Admission refused: the cap is doing its job for this round.
    }
  }
  return held;
};

describe("approval expiry releases parked dapp responses (MCW-V09-115)", () => {
  test("capacity replacement rejects the evicted request and releases its waiter", async () => {
    const { approvals, changes, waiters } = boundRegistry();
    for (let site = 0; site < MAX_PENDING_APPROVALS / MAX_PENDING_APPROVALS_PER_ORIGIN; site += 1) {
      for (let slot = 0; slot < MAX_PENDING_APPROVALS_PER_ORIGIN; slot += 1) {
        approvals.requestWatchAsset({
          origin: `https://site-${site}.example`,
          token: token(site * MAX_PENDING_APPROVALS_PER_ORIGIN + slot),
        });
      }
    }
    const oldest = approvals.list()[0];
    if (!oldest) {
      throw new Error("full approval queue fixture unavailable");
    }
    const held = waiters.register(oldest.id);

    const admitted = approvals.request("https://late.example");

    expect(approvals.list()).toHaveLength(MAX_PENDING_APPROVALS);
    expect(approvals.get(oldest.id)).toBeNull();
    expect(approvals.get(admitted.id)).toEqual(admitted);
    expect(waiters.pending()).toBe(0);
    expect(changes).toHaveLength(1);
    await expect(held).resolves.toEqual(DROPPED_APPROVAL_RESPONSE);
  });

  test("an ignored flood does not grow the registry across TTL periods", async () => {
    const { approvals, clock, waiters } = boundRegistry();
    const held: Promise<unknown>[] = [];

    for (let round = 0; round < 12; round += 1) {
      held.push(...floodRound(approvals, waiters, ATTACKER, round * MAX_WAITERS_PER_APPROVAL));
      clock.now += APPROVAL_TTL_MS;
      // Any read sweeps. The queue reading empty is exactly what made the old
      // leak invisible, so assert the registry alongside it, not instead of it.
      expect(approvals.list()).toEqual([]);
      expect(waiters.pending()).toBe(0);
    }

    expect(held.length).toBeGreaterThan(0);
    for (const response of await Promise.all(held)) {
      expect(response).toEqual(DROPPED_APPROVAL_RESPONSE);
    }
  });

  test("an expired request reaches the dapp as USER_REFUSED_OP, never as a hang", async () => {
    const { approvals, clock, waiters } = boundRegistry();
    const approval = approvals.request(ATTACKER);
    const held = waiters.register(approval.id);

    clock.now += APPROVAL_TTL_MS;
    expect(approvals.list()).toEqual([]);

    await expect(held).resolves.toEqual({ error: "request rejected" });
    // The wallet RPC surface has no expiry code; the truthful outcome is that
    // the user never consented, which the bridge must map to spec code 113.
    expect(errorForMessage("request rejected")).toEqual(userRefusedOp());
    expect(userRefusedOp().code).toBe(113);
  });

  test("signals open surfaces only when a sweep actually drops entries", async () => {
    const { approvals, changes, clock, waiters } = boundRegistry();
    const approval = approvals.request(ATTACKER);
    const held = waiters.register(approval.id);

    clock.now += APPROVAL_TTL_MS - 1;
    expect(approvals.list()).toHaveLength(1);
    expect(changes).toEqual([]);

    clock.now += 1;
    expect(approvals.list()).toEqual([]);
    expect(changes).toEqual([START + APPROVAL_TTL_MS]);
    // A second read finds nothing left to drop and must not re-signal.
    expect(approvals.list()).toEqual([]);
    expect(changes).toHaveLength(1);
    await held;
  });

  test("expiry frees the per-approval waiter allowance a retry loop consumed", async () => {
    const { approvals, clock, waiters } = boundRegistry();
    // Repeated connect attempts from one origin dedupe onto a single approval,
    // so one tab's retry loop can spend the whole allowance for that origin.
    const approval = approvals.request(ATTACKER);
    const held: Promise<unknown>[] = [];
    for (let attempt = 0; attempt < MAX_WAITERS_PER_APPROVAL; attempt += 1) {
      held.push(waiters.register(approvals.request(ATTACKER).id));
    }
    expect(() => waiters.register(approval.id)).toThrow("Too many pending approvals");

    clock.now += APPROVAL_TTL_MS;
    expect(approvals.list()).toEqual([]);
    expect(waiters.pending()).toBe(0);
    expect(await Promise.all(held)).toEqual(held.map(() => DROPPED_APPROVAL_RESPONSE));

    // The lockout is bounded by the TTL: the origin can prompt again afterwards.
    const next = approvals.request(ATTACKER);
    expect(next.id).not.toBe(approval.id);
    const retried = waiters.register(next.id);
    waiters.settle(next.id, { ok: true });
    await expect(retried).resolves.toEqual({ ok: true });
  });
});

describe("the router context binds expiry to the queue it is given", () => {
  test("held dapp requests settle when their approval expires", async () => {
    const clock = { now: START };
    const approvals = createApprovalQueue({ now: () => clock.now });
    const handler = createMessageHandler(createWallet(), testExtension, {
      approvals,
      preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
      runtimeRpc: makeRuntimeRpc(),
      session: createUnlockSession(),
    });

    // Fire without awaiting: a watch-asset request holds until a decision.
    const held = [
      handler(
        { asset: { address: token(0).address }, origin: grantedOrigin, type: "wallet.watchAsset" },
        contentSender,
      ),
      handler(
        { asset: { address: token(1).address }, origin: grantedOrigin, type: "wallet.watchAsset" },
        contentSender,
      ),
    ];
    await flushHeld();
    expect(approvals.list()).toHaveLength(2);

    clock.now += APPROVAL_TTL_MS;
    // The panel polling the queue is enough to sweep — no timer runs in the
    // service worker — and the sweep must settle both held dapp promises.
    await expect(handler({ type: "wallet.pendingApprovals" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    expect(await Promise.all(held)).toEqual([DROPPED_APPROVAL_RESPONSE, DROPPED_APPROVAL_RESPONSE]);
  });
});
