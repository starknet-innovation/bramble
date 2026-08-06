/**
 * Session-backed privacy maturity records remain partitioned by account,
 * network, and pool and reject malformed persisted values.
 */

import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../../src/storage/kv";
import { createStrk20MaturityStore } from "../../src/storage/strk20-maturity-store";

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
    await backing.set("mc-wallet:strk20-maturity", [
      { ...scope, acceptedBlock: -1, transactionHash: "not-a-hash" },
      { ...scope, state: "submitting", transactionHash: "0x456" },
    ]);
    const store = createStrk20MaturityStore(backing);

    expect(await store.read(scope)).toBeNull();
  });
});
