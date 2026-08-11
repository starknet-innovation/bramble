/**
 * Regression checks for MCW-V09-115: held dapp responses accumulated without
 * bound behind a deduplicated approval, and the only counter reported approval
 * ids rather than held responses — so an unconnected page with a locked wallet
 * could grow the privileged worker's heap while `pending()` still read 1.
 *
 * Every registered response is settled before a test ends: a parked promise is
 * exactly the leak under test, so leaving one behind would leak it into the
 * runner too.
 */
import { describe, expect, test } from "bun:test";
import {
  createSignatureWaiters,
  MAX_WAITERS_PER_APPROVAL,
  type SignatureWaiters,
} from "../../src/background/signature-waiters";

// Fills one approval id to capacity and hands back the held responses.
const saturate = (waiters: SignatureWaiters, id: string): Promise<unknown>[] => {
  const held: Promise<unknown>[] = [];
  for (let index = 0; index < MAX_WAITERS_PER_APPROVAL; index += 1) {
    held.push(waiters.register(id));
  }
  return held;
};

describe("signature waiter bounds (MCW-V09-115)", () => {
  test("pending() counts held responses, not approval ids", async () => {
    const waiters = createSignatureWaiters();
    const first = [waiters.register("approval-1"), waiters.register("approval-1")];
    const second = waiters.register("approval-2");

    expect(waiters.pending()).toBe(3);

    waiters.settle("approval-1", { ok: true });
    waiters.settle("approval-2", { ok: true });
    await Promise.all([...first, second]);
    expect(waiters.pending()).toBe(0);
  });

  test("caps the resolvers held behind one deduplicated approval id", async () => {
    const waiters = createSignatureWaiters();
    const held = saturate(waiters, "approval-1");

    expect(() => waiters.register("approval-1")).toThrow("Too many pending approvals");
    expect(waiters.pending()).toBe(MAX_WAITERS_PER_APPROVAL);

    // A refused registration must not have parked a resolver of its own.
    waiters.settle("approval-1", { ok: true });
    await Promise.all(held);
    expect(waiters.pending()).toBe(0);
  });

  test("keeps the cap per approval id rather than registry-wide", async () => {
    const waiters = createSignatureWaiters();
    const held = saturate(waiters, "approval-1");

    // A different approval is a different user decision and must still queue.
    const other = waiters.register("approval-2");
    expect(waiters.pending()).toBe(MAX_WAITERS_PER_APPROVAL + 1);

    waiters.settle("approval-1", { ok: true });
    waiters.settle("approval-2", { error: "denied" });
    await Promise.all(held);
    await expect(other).resolves.toEqual({ error: "denied" });
  });

  test("settling a saturated id frees its capacity and resolves every waiter", async () => {
    const waiters = createSignatureWaiters();
    const held = saturate(waiters, "approval-1");

    waiters.settle("approval-1", { ok: true });
    expect(await Promise.all(held)).toEqual(held.map(() => ({ ok: true })));
    expect(waiters.pending()).toBe(0);

    const reused = waiters.register("approval-1");
    expect(waiters.pending()).toBe(1);
    waiters.settle("approval-1", { error: "denied" });
    await expect(reused).resolves.toEqual({ error: "denied" });
  });

  test("repeated refusals never grow the held-response count", async () => {
    const waiters = createSignatureWaiters();
    const held = saturate(waiters, "approval-1");

    for (let index = 0; index < 100; index += 1) {
      expect(() => waiters.register("approval-1")).toThrow("Too many pending approvals");
    }
    expect(waiters.pending()).toBe(MAX_WAITERS_PER_APPROVAL);

    waiters.settle("approval-1", { ok: true });
    await Promise.all(held);
  });
});
