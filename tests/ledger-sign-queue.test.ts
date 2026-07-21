/**
 * Ledger sign-queue checks: a background request parks until the panel settles
 * or rejects it, pending intents are visible to the panel, and settling an
 * unknown id is a no-op rather than resolving the wrong request.
 */
import { describe, expect, test } from "bun:test";
import { createLedgerSignQueue } from "../src/background/ledger-sign-queue";

const request = { accountId: "SN_MAIN:0x1", messageHash: "0x2", path: "m/2645'/0'/0'/0'/0'/0" };

describe("createLedgerSignQueue", () => {
  test("parks a request, exposes it as pending, and resolves it on settle", async () => {
    let notified = 0;
    const queue = createLedgerSignQueue(() => {
      notified += 1;
    });
    const pendingSignature = queue.request(request);

    const pending = queue.pending();
    expect(notified).toBe(1);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject(request);
    const id = pending[0]?.id ?? "";

    expect(queue.settle(id, { r: "0x9", s: "0xa" })).toBe(true);
    await expect(pendingSignature).resolves.toEqual({ r: "0x9", s: "0xa" });
    expect(queue.pending()).toHaveLength(0);
  });

  test("rejects a parked request with a typed error", async () => {
    const queue = createLedgerSignQueue();
    const pendingSignature = queue.request(request);
    const id = queue.pending()[0]?.id ?? "";

    expect(queue.reject(id, "rejected-on-device")).toBe(true);
    await expect(pendingSignature).rejects.toThrow("rejected-on-device");
    expect(queue.pending()).toHaveLength(0);
  });

  test("settling or rejecting an unknown id is a no-op", () => {
    const queue = createLedgerSignQueue();
    expect(queue.settle("ledger-sign-999", { r: "0x1", s: "0x2" })).toBe(false);
    expect(queue.reject("ledger-sign-999", "gone")).toBe(false);
  });

  test("assigns distinct ids to concurrent requests", () => {
    const queue = createLedgerSignQueue();
    void queue.request(request);
    void queue.request(request);
    const ids = queue.pending().map((intent) => intent.id);
    expect(new Set(ids).size).toBe(2);
  });
});
