/**
 * The durable maturity store (#668): relay claims keep their WriteOnce slots,
 * released floors persist, records that still guard a scope are never
 * evicted, and each release acts only on the marker it was asked about.
 */

import { describe, expect, test } from "bun:test";
import { createStrk20MaturityStore } from "@bramble/privacy/maturity-store";
import { createMemoryStore } from "@bramble/store/kv";

const KEY = "bramble:strk20-maturity";
const scope = {
  accountId: "SN_SEPOLIA:0xabc",
  networkId: "SN_SEPOLIA" as const,
  poolAddress: "0x123",
};
const other = { ...scope, accountId: "SN_SEPOLIA:0xdef" };
const claim = { route: "relay" as const, state: "submitting" as const, writeOnceSlots: ["0x51"] };

describe("relay claim slots in storage", () => {
  test("round-trips a relay claim with its slots", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    await store.write(scope, { ...claim, writeOnceSlots: ["0x51", "0x52"] });
    expect(await store.read(scope)).toEqual({ ...claim, writeOnceSlots: ["0x51", "0x52"] });
  });

  test("drops a row whose slots are malformed, unsorted, or on the wrong claim", async () => {
    for (const row of [
      { ...claim, writeOnceSlots: [] },
      { ...claim, writeOnceSlots: ["0x52", "0x51"] },
      { ...claim, writeOnceSlots: ["0x51", "0x51"] },
      { ...claim, writeOnceSlots: ["0x0"] },
      { ...claim, writeOnceSlots: ["0X51"] },
      { ...claim, writeOnceSlots: "0x51" },
      { ...claim, route: "account" },
      { state: "submitting", writeOnceSlots: ["0x51"] },
      {
        nonce: "0x1",
        senderAddress: "0xabc",
        state: "submitting",
        transactionHash: "0x9",
        writeOnceSlots: ["0x51"],
      },
      { state: "submitted", transactionHash: "0x9", writeOnceSlots: ["0x51"] },
    ]) {
      const backing = createMemoryStore();
      await backing.set(KEY, [{ ...scope, ...row }]);
      expect(await createStrk20MaturityStore(backing).read(scope), JSON.stringify(row)).toBeNull();
    }
  });
});

describe("eviction", () => {
  test("drops the oldest submitted records but never a submitting marker", async () => {
    const backing = createMemoryStore();
    const store = createStrk20MaturityStore(backing);
    await store.write(scope, claim);
    for (let index = 0; index < 120; index += 1) {
      await store.write(
        { ...scope, accountId: `SN_SEPOLIA:0x${(index + 1000).toString(16)}` },
        { acceptedBlock: 1, state: "submitted", transactionHash: `0x${(index + 1).toString(16)}` },
      );
    }
    expect(await store.read(scope)).toEqual(claim);
    const rows = (await backing.get(KEY)) as readonly unknown[];
    expect(rows).toHaveLength(100);
  });
});

describe("released floors", () => {
  test("round-trips a released floor and drops a malformed one", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    await store.write(scope, { acceptedBlock: 42, state: "released" });
    expect(await store.read(scope)).toEqual({ acceptedBlock: 42, state: "released" });
    for (const row of [
      { state: "released" },
      { acceptedBlock: -1, state: "released" },
      { acceptedBlock: 4, state: "released", transactionHash: "0x9" },
      { acceptedBlock: 4, route: "relay", state: "released" },
    ]) {
      const backing = createMemoryStore();
      await backing.set(KEY, [{ ...scope, ...row }]);
      expect(await createStrk20MaturityStore(backing).read(scope), JSON.stringify(row)).toBeNull();
    }
  });

  test("eviction keeps floors and receipts still pending", async () => {
    const backing = createMemoryStore();
    const store = createStrk20MaturityStore(backing);
    await store.write(scope, { acceptedBlock: 7, state: "released" });
    await store.write(other, { state: "submitted", transactionHash: "0x9" });
    for (let index = 0; index < 120; index += 1) {
      await store.write(
        { ...scope, accountId: `SN_SEPOLIA:0x${(index + 1000).toString(16)}` },
        { acceptedBlock: 1, state: "submitted", transactionHash: `0x${(index + 1).toString(16)}` },
      );
    }
    expect(await store.read(scope)).toEqual({ acceptedBlock: 7, state: "released" });
    expect(await store.read(other)).toEqual({ state: "submitted", transactionHash: "0x9" });
  });
});

describe("conditional releases", () => {
  test("releaseRelayClaim replaces only the claim with exactly those slots, by a floor", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    await store.write(scope, { ...claim, writeOnceSlots: ["0x51", "0x52"] });
    expect(await store.releaseRelayClaim(scope, ["0x51"], 9)).toBe(false);
    expect(await store.releaseRelayClaim(scope, ["0x51", "0x53"], 9)).toBe(false);
    expect(await store.read(scope)).toEqual({ ...claim, writeOnceSlots: ["0x51", "0x52"] });
    expect(await store.releaseRelayClaim(scope, ["0x51", "0x52"], 9)).toBe(true);
    expect(await store.read(scope)).toEqual({ acceptedBlock: 9, state: "released" });
  });

  test("releaseRelayClaim never clears a newer send's marker", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    await store.write(scope, {
      nonce: "0x1",
      senderAddress: "0xabc",
      state: "submitting",
      transactionHash: "0x9",
    });
    expect(await store.releaseRelayClaim(scope, ["0x51"], 9)).toBe(false);
    expect(await store.read(scope)).toMatchObject({ transactionHash: "0x9" });
  });

  test("releaseSubmitting clears only the very marker the user acted on", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    await store.write(scope, claim);
    const newer = { ...claim, writeOnceSlots: ["0x77"] };
    expect(await store.releaseSubmitting(scope, newer)).toBe(false);
    expect(await store.read(scope)).toEqual(claim);
    expect(await store.releaseSubmitting(scope, { ...claim })).toBe(true);
    expect(await store.read(scope)).toBeNull();
    await store.write(other, { state: "submitted", transactionHash: "0x9" });
    expect(
      await store.releaseSubmitting(other, { state: "submitted", transactionHash: "0x9" }),
    ).toBe(false);
    expect(await store.read(other)).toEqual({ state: "submitted", transactionHash: "0x9" });
  });
});
