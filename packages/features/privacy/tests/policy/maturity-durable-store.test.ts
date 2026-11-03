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

const accountScope = (accountIndex: number) => ({
  ...scope,
  accountId: `SN_SEPOLIA:0x${(accountIndex + 1000).toString(16)}`,
});

describe("eviction", () => {
  test("keeps a settled write when every other row still guards", async () => {
    // #729: at the cap, that write is the only settled row, so it was the one dropped.
    const backing = createMemoryStore();
    const rows = [];
    for (let index = 0; index < 100; index += 1) {
      rows.push({ ...accountScope(index), state: "submitting" as const });
    }
    await backing.set(KEY, rows);
    const store = createStrk20MaturityStore(backing);
    const written = { acceptedBlock: 40, state: "submitted" as const, transactionHash: "0x456" };
    await store.write(scope, written);

    expect(await store.read(scope)).toEqual(written);
    expect(await store.read(accountScope(0))).toEqual({ state: "submitting" });
    expect((await backing.get(KEY)) as readonly unknown[]).toHaveLength(101);
  });

  test("evicts other scopes' earliest-written settled rows and keeps the write", async () => {
    // Written order, not block height: the write's block is older than all of them.
    const backing = createMemoryStore();
    const rows = [];
    for (let index = 0; index < 90; index += 1) {
      rows.push({ ...accountScope(index), state: "submitting" as const });
    }
    for (let index = 0; index < 15; index += 1) {
      const accountIndex = index + 90;
      rows.push({
        ...accountScope(accountIndex),
        acceptedBlock: 100 - index,
        state: "submitted" as const,
        transactionHash: `0x${(accountIndex + 1).toString(16)}`,
      });
    }
    await backing.set(KEY, rows);
    const store = createStrk20MaturityStore(backing);
    const written = { acceptedBlock: 1, state: "submitted" as const, transactionHash: "0x456" };
    await store.write(scope, written);

    expect(await store.read(scope)).toEqual(written);
    // The first six settled rows written go; later ones stay.
    for (let accountIndex = 90; accountIndex <= 95; accountIndex += 1) {
      expect(await store.read(accountScope(accountIndex))).toBeNull();
    }
    for (let accountIndex = 96; accountIndex <= 104; accountIndex += 1) {
      expect(await store.read(accountScope(accountIndex))).toEqual({
        acceptedBlock: 100 - (accountIndex - 90),
        state: "submitted",
        transactionHash: `0x${(accountIndex + 1).toString(16)}`,
      });
    }
    expect(await store.read(accountScope(0))).toEqual({ state: "submitting" });
    expect((await backing.get(KEY)) as readonly unknown[]).toHaveLength(100);
  });

  test("keeps another network's just-settled row over an older one at a higher block", async () => {
    // Mainnet heights run above Sepolia's, so comparing blocks would drop the newest row.
    const mainnet = (accountIndex: number) => ({
      accountId: `SN_MAIN:0x${(accountIndex + 1000).toString(16)}`,
      networkId: "SN_MAIN" as const,
      poolAddress: "0x123",
    });
    const backing = createMemoryStore();
    const rows = [];
    for (let index = 0; index < 99; index += 1) {
      rows.push({
        ...mainnet(index),
        acceptedBlock: 2_000_000 + index,
        state: "submitted" as const,
        transactionHash: `0x${(index + 1).toString(16)}`,
      });
    }
    const sepolia = {
      acceptedBlock: 900_000,
      state: "submitted" as const,
      transactionHash: "0xabc",
    };
    rows.push({ ...accountScope(0), ...sepolia });
    await backing.set(KEY, rows);
    const store = createStrk20MaturityStore(backing);
    await store.write(mainnet(500), {
      acceptedBlock: 2_100_000,
      state: "submitted",
      transactionHash: "0x999",
    });

    expect(await store.read(accountScope(0))).toEqual(sepolia);
    expect(await store.read(mainnet(0))).toBeNull();
    expect((await backing.get(KEY)) as readonly unknown[]).toHaveLength(100);
  });

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
