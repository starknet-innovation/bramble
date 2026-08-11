/**
 * Signature-waiter checks prove deduped requests sharing one approval id all
 * settle: an overwriting registry would orphan the earlier request forever.
 */
import { describe, expect, test } from "bun:test";
import { createSignatureWaiters } from "../../../apps/extension/src/background/approvals/signature-waiters";

describe("createSignatureWaiters", () => {
  test("settles a registered waiter exactly once", async () => {
    const waiters = createSignatureWaiters();
    const held = waiters.register("approval-1");
    expect(waiters.pending()).toBe(1);

    waiters.settle("approval-1", { ok: true });
    await expect(held).resolves.toEqual({ ok: true });
    expect(waiters.pending()).toBe(0);

    // A second settle for the same id is a no-op, not a crash.
    waiters.settle("approval-1", { error: "late" });
  });

  test("resolves every waiter registered against a deduped approval id", async () => {
    const waiters = createSignatureWaiters();
    // Two tabs of the same origin connect: the second request dedupes onto
    // the first approval id, and both held responses must settle.
    const firstTab = waiters.register("approval-1");
    const secondTab = waiters.register("approval-1");
    // pending() counts held responses, not approval ids: both tabs are memory
    // this registry is holding.
    expect(waiters.pending()).toBe(2);

    waiters.settle("approval-1", { accounts: [], ok: true });
    await expect(firstTab).resolves.toEqual({ accounts: [], ok: true });
    await expect(secondTab).resolves.toEqual({ accounts: [], ok: true });
  });

  test("keeps unrelated approval ids independent", async () => {
    const waiters = createSignatureWaiters();
    const first = waiters.register("approval-1");
    const second = waiters.register("approval-2");

    waiters.settle("approval-2", { error: "denied" });
    await expect(second).resolves.toEqual({ error: "denied" });
    expect(waiters.pending()).toBe(1);

    waiters.settle("approval-1", { ok: true });
    await expect(first).resolves.toEqual({ ok: true });
  });
});
