/**
 * Session-backed privacy maturity records remain partitioned by account,
 * network, and pool and reject malformed persisted values.
 */

import { describe, expect, test } from "bun:test";
import { createStrk20MaturityStore } from "@bramble/privacy/maturity-store";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";

const scope = {
  accountId: "SN_SEPOLIA:0xabc",
  networkId: "SN_SEPOLIA" as const,
  poolAddress: "0x123",
};

describe("STRK20 maturity store", () => {
  test("isolates records and clears only the requested scope", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    const other = { ...scope, accountId: "SN_SEPOLIA:0xdef" };
    await store.write(scope, {
      acceptedBlock: 20,
      state: "submitted",
      transactionHash: "0x456",
    });
    await store.write(other, { state: "submitting" });

    expect(await store.read(scope)).toEqual({
      acceptedBlock: 20,
      state: "submitted",
      transactionHash: "0x456",
    });
    expect(await store.read(other)).toEqual({ state: "submitting" });

    await store.write(scope, null);
    expect(await store.read(scope)).toBeNull();
    expect(await store.read(other)).toEqual({ state: "submitting" });
  });

  test("ignores malformed storage rows", async () => {
    const backing = createMemoryStore();
    await backing.set("bramble:strk20-maturity", [
      { ...scope, acceptedBlock: -1, transactionHash: "not-a-hash" },
      { ...scope, state: "submitting", transactionHash: "0x456" },
      { ...scope, networkId: "SN_MAIN", state: "submitting" },
    ]);
    const store = createStrk20MaturityStore(backing);

    expect(await store.read(scope)).toBeNull();
  });

  test("round-trips the signed identity of a submitting write", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    const signed = {
      nonce: "0x0",
      senderAddress: "0xabc",
      state: "submitting" as const,
      transactionHash: "0x456",
    };
    await store.write(scope, signed);

    expect(await store.read(scope)).toEqual(signed);
  });

  test("drops a signed identity that is partial, malformed, or on a submitted row", async () => {
    const backing = createMemoryStore();
    const store = createStrk20MaturityStore(backing);
    for (const row of [
      // Hash and nonce without the sender that proves a spent nonce.
      { ...scope, nonce: "0x1", state: "submitting", transactionHash: "0x456" },
      // A nonce that is not a canonical field element.
      {
        ...scope,
        nonce: "1",
        senderAddress: "0xabc",
        state: "submitting",
        transactionHash: "0x456",
      },
      // A zero hash names no transaction.
      {
        ...scope,
        nonce: "0x1",
        senderAddress: "0xabc",
        state: "submitting",
        transactionHash: "0x0",
      },
      // Identity fields belong to the submitting marker only.
      {
        ...scope,
        nonce: "0x1",
        senderAddress: "0xabc",
        state: "submitted",
        transactionHash: "0x456",
      },
    ]) {
      await backing.set("bramble:strk20-maturity", [row]);
      expect(await store.read(scope)).toBeNull();
    }
  });

  test("replaces a marker only while it still names the resolved hash", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    const stuck = {
      nonce: "0x5",
      senderAddress: "0xdef",
      state: "submitting" as const,
      transactionHash: "0x456",
    };
    await store.write(scope, stuck);

    expect(await store.replaceIfCurrentHash(scope, "0x111", null)).toBe(false);
    expect(await store.read(scope)).toEqual(stuck);
    expect(
      await store.replaceIfCurrentHash(scope, "0x456", {
        state: "submitted",
        transactionHash: "0x456",
      }),
    ).toBe(true);
    expect(await store.read(scope)).toEqual({ state: "submitted", transactionHash: "0x456" });
  });

  test("a queued write lands before a replacement that was already requested", async () => {
    const backing = createMemoryStore();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let parked = (): void => undefined;
    const waiting = new Promise<void>((resolve) => {
      parked = resolve;
    });
    let pauseNextSet = false;
    const delayed: KeyValueStore = {
      get: (key) => backing.get(key),
      remove: (key) => backing.remove(key),
      set: async (key, value) => {
        if (pauseNextSet) {
          pauseNextSet = false;
          parked();
          await gate;
        }
        await backing.set(key, value);
      },
    };
    const store = createStrk20MaturityStore(delayed);
    const stuck = {
      nonce: "0x5",
      senderAddress: "0xdef",
      state: "submitting" as const,
      transactionHash: "0x456",
    };
    const newer = {
      nonce: "0x9",
      senderAddress: "0xdef",
      state: "submitting" as const,
      transactionHash: "0x789",
    };
    await store.write(scope, stuck);
    pauseNextSet = true;
    const writing = store.write(scope, newer);
    await waiting;
    const replacing = store.replaceIfCurrentHash(scope, "0x456", null);
    release();

    expect(await writing).toBeUndefined();
    expect(await replacing).toBe(false);
    expect(await store.read(scope)).toEqual(newer);
  });

  test("round-trips the route of an unsigned claim and drops an unknown one", async () => {
    const backing = createMemoryStore();
    const store = createStrk20MaturityStore(backing);
    for (const route of ["account", "relay"] as const) {
      await store.write(scope, { route, state: "submitting" });
      expect(await store.read(scope)).toEqual({ route, state: "submitting" });
    }
    for (const row of [
      { ...scope, route: "paymaster", state: "submitting" },
      // A signed write is always the account's and names no route.
      {
        ...scope,
        nonce: "0x1",
        route: "account",
        senderAddress: "0xabc",
        state: "submitting",
        transactionHash: "0x456",
      },
      { ...scope, route: "account", state: "submitted", transactionHash: "0x456" },
    ]) {
      await backing.set("bramble:strk20-maturity", [row]);
      expect(await store.read(scope)).toBeNull();
    }
  });

  test("releases only an unsigned account claim, inside the mutation queue", async () => {
    const store = createStrk20MaturityStore(createMemoryStore());
    const signed = {
      nonce: "0x1",
      senderAddress: "0xabc",
      state: "submitting" as const,
      transactionHash: "0x456",
    };
    for (const kept of [
      signed,
      { route: "relay" as const, state: "submitting" as const },
      { state: "submitting" as const },
      { state: "submitted" as const, transactionHash: "0x456" },
    ]) {
      await store.write(scope, kept);
      expect(await store.releaseUnsigned(scope)).toBe(false);
      expect(await store.read(scope)).toEqual(kept);
    }

    await store.write(scope, { route: "account", state: "submitting" });
    // A journal queued first wins: the release then finds a signed write.
    const journaled = store.write(scope, signed);
    const released = store.releaseUnsigned(scope);
    await journaled;
    expect(await released).toBe(false);
    expect(await store.read(scope)).toEqual(signed);

    await store.write(scope, { route: "account", state: "submitting" });
    expect(await store.releaseUnsigned(scope)).toBe(true);
    expect(await store.read(scope)).toBeNull();
  });

  test("round-trips a proof base block and releases an unsigned claim only at that block", async () => {
    const backing = createMemoryStore();
    const store = createStrk20MaturityStore(backing);
    const relay = { proofBaseBlock: 100, route: "relay" as const, state: "submitting" as const };
    await store.write(scope, relay);
    expect(await store.read(scope)).toEqual(relay);
    const submitted = {
      proofBaseBlock: 100,
      state: "submitted" as const,
      transactionHash: "0x456",
    };
    await store.write(scope, submitted);
    expect(await store.read(scope)).toEqual(submitted);
    expect(await store.releaseUnsignedProvedAt(scope, 100)).toBe(false);

    await store.write(scope, relay);
    expect(await store.releaseUnsignedProvedAt(scope, 99)).toBe(false);
    expect(await store.read(scope)).toEqual(relay);
    expect(await store.releaseUnsignedProvedAt(scope, 100)).toBe(true);
    expect(await store.read(scope)).toBeNull();

    for (const proofBaseBlock of [-1, 1.5, "100"]) {
      await backing.set("bramble:strk20-maturity", [{ ...scope, ...relay, proofBaseBlock }]);
      expect(await store.read(scope)).toBeNull();
    }
  });
});
