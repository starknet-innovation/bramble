/**
 * The durable maturity store (#668): relay claims keep their WriteOnce slots,
 * session markers from earlier builds are carried into local storage before
 * any read, `submitting` markers are never evicted, and each release clears
 * only the marker it was asked about.
 */

import { describe, expect, test } from "bun:test";
import { createStrk20MaturityStore } from "@bramble/privacy/maturity-store";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";

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
        { state: "submitted", transactionHash: `0x${(index + 1).toString(16)}` },
      );
    }
    expect(await store.read(scope)).toEqual(claim);
    const rows = (await backing.get(KEY)) as readonly unknown[];
    expect(rows).toHaveLength(100);
  });
});

describe("carrying session markers from earlier builds", () => {
  test("moves a session marker into local storage before the first read", async () => {
    const local = createMemoryStore();
    const session = createMemoryStore();
    await session.set(KEY, [{ ...scope, route: "relay", state: "submitting" }]);
    const store = createStrk20MaturityStore(local, session);

    expect(await store.read(scope)).toEqual({ route: "relay", state: "submitting" });
    expect(await session.get(KEY)).toBeUndefined();
    // A later build starting over the same local storage still sees it.
    expect(await createStrk20MaturityStore(local).read(scope)).toEqual({
      route: "relay",
      state: "submitting",
    });
  });

  test("keeps the durable marker when both stores name the same scope", async () => {
    const local = createMemoryStore();
    const session = createMemoryStore();
    await local.set(KEY, [{ ...scope, ...claim }]);
    await session.set(KEY, [
      { ...scope, route: "relay", state: "submitting" },
      { ...other, state: "submitted", transactionHash: "0x9" },
    ]);
    const store = createStrk20MaturityStore(local, session);

    expect(await store.read(scope)).toEqual(claim);
    expect(await store.read(other)).toEqual({ state: "submitted", transactionHash: "0x9" });
  });

  test("fails every call closed when the carry cannot run", async () => {
    const broken: KeyValueStore = {
      get: async () => {
        throw new Error("session storage unavailable");
      },
      remove: async () => undefined,
      set: async () => undefined,
    };
    const store = createStrk20MaturityStore(createMemoryStore(), broken);
    await expect(store.read(scope)).rejects.toThrow("session storage unavailable");
    await expect(store.write(scope, claim)).rejects.toThrow("session storage unavailable");
  });
});

describe("conditional releases", () => {
  test("releaseRelayClaim clears only the claim with exactly those slots", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    await store.write(scope, { ...claim, writeOnceSlots: ["0x51", "0x52"] });
    expect(await store.releaseRelayClaim(scope, ["0x51"])).toBe(false);
    expect(await store.releaseRelayClaim(scope, ["0x51", "0x53"])).toBe(false);
    expect(await store.read(scope)).not.toBeNull();
    expect(await store.releaseRelayClaim(scope, ["0x51", "0x52"])).toBe(true);
    expect(await store.read(scope)).toBeNull();
  });

  test("releaseRelayClaim never clears a newer send's marker", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    await store.write(scope, {
      nonce: "0x1",
      senderAddress: "0xabc",
      state: "submitting",
      transactionHash: "0x9",
    });
    expect(await store.releaseRelayClaim(scope, ["0x51"])).toBe(false);
    expect(await store.read(scope)).toMatchObject({ transactionHash: "0x9" });
  });

  test("releaseSubmitting clears any submitting marker and leaves a submitted record", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    await store.write(scope, claim);
    await store.write(other, { state: "submitted", transactionHash: "0x9" });
    expect(await store.releaseSubmitting(scope)).toBe(true);
    expect(await store.releaseSubmitting(scope)).toBe(false);
    expect(await store.releaseSubmitting(other)).toBe(false);
    expect(await store.read(other)).toEqual({ state: "submitted", transactionHash: "0x9" });
  });
});
