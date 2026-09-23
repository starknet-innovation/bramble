/**
 * Session-backed privacy maturity records remain partitioned by account,
 * network, and pool and reject malformed persisted values.
 */

import { describe, expect, test } from "bun:test";
import { createStrk20MaturityStore } from "@bramble/privacy/maturity-store";
import { createMemoryStore } from "@bramble/store/kv";

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
});
