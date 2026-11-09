/**
 * The revoke transaction hash an allowance record keeps beside its `revoking`
 * mark (issue 647). The allowance log is an unversioned plain store whose
 * policy is "discard invalid rows" (docs/WALLET_STORE.md), so the field is
 * optional: a revoke recorded before it existed must keep loading and keep
 * settling on readings alone, a current record must round-trip, and a
 * malformed hash must cost only that record. Settling on an outcome is pinned
 * here against the persistent store; the message path is covered in
 * tests/background/portfolio/allowance-revoke-outcome.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { isAllowanceView, mergeAllowanceViews } from "@bramble/transactions/allowance-discovery";
import {
  ALLOWANCE_STORE_KEY,
  type AllowanceRecord,
  createAllowanceStore,
  isAllowanceRecord,
} from "@bramble/transactions/allowance-store";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const TOKEN = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x5";
const ID = `${ACCOUNT_ID}:${TOKEN}:${SPENDER}`;
const REVOKE = "0xabc";

const input = (amount: string) => ({
  accountId: ACCOUNT_ID,
  amount,
  networkId: "SN_MAIN" as const,
  spender: SPENDER,
  token: TOKEN,
});

const stored = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...input("1000"),
  id: ID,
  ...overrides,
});

const persisted = async (records: readonly unknown[]) => {
  const kv = createMemoryStore();
  await kv.set(ALLOWANCE_STORE_KEY, records as never);
  return { kv, store: createAllowanceStore({ store: kv }) };
};

describe("revoke hash: stored data", () => {
  test("a legacy pending revoke without a hash still loads and settles on a zero reading", async () => {
    const legacy = stored({ revoking: true });
    expect(isAllowanceRecord(legacy)).toBe(true);
    const { store } = await persisted([legacy]);
    expect(await store.list()).toEqual([legacy as AllowanceRecord]);
    // An outcome cannot reach a record that never named its transaction.
    await store.settleRevocations([], [{ hash: REVOKE, status: "failed" }]);
    expect(await store.list()).toEqual([legacy as AllowanceRecord]);
    await store.settleRevocations([{ amount: "0", id: ID }]);
    expect(await store.list()).toEqual([]);
  });

  test("a current record with a canonical revoke hash round-trips", async () => {
    const current = stored({ revokeHash: REVOKE, revoking: true });
    expect(isAllowanceRecord(current)).toBe(true);
    const { store } = await persisted([current]);
    expect((await store.list())[0]?.revokeHash).toBe(REVOKE);
  });

  test.each([
    ["has no revoking mark", { revokeHash: REVOKE }],
    ["is zero-padded", { revokeHash: "0x0abc", revoking: true }],
    ["is uppercase", { revokeHash: "0xABC", revoking: true }],
    ["is the zero felt", { revokeHash: "0x0", revoking: true }],
    ["is not a felt", { revokeHash: "abc", revoking: true }],
    ["is a number", { revokeHash: 2748, revoking: true }],
  ])("drops a record whose revoke hash %s, keeping its neighbours", async (_name, fields) => {
    const bad = stored({ ...fields, spender: "0x6", id: `${ACCOUNT_ID}:${TOKEN}:0x6` });
    expect(isAllowanceRecord(bad)).toBe(false);
    const { store } = await persisted([stored(), bad]);
    expect((await store.list()).map((record) => record.id)).toEqual([ID]);
  });
});

describe("revoke hash: recording", () => {
  test("a zero approve over a tracked grant keeps the canonical hash of its transaction", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input("1000"), "0x1");
    await store.record(input("0"), "0x0ABC");
    expect(await store.list()).toEqual([
      { ...input("1000"), id: ID, revokeHash: REVOKE, revoking: true },
    ]);
  });

  test("a decrease to zero from an exact base keeps the hash too", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input("1000"));
    await store.applyDelta({
      direction: "subtract",
      input: input("1000"),
      transactionHash: REVOKE,
    });
    expect((await store.list())[0]).toMatchObject({ revokeHash: REVOKE, revoking: true });
  });

  test("a later revoke without a hash drops the earlier revoke's hash", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input("1000"));
    await store.record(input("0"), REVOKE);
    await store.record(input("0"));
    const [record] = await store.list();
    expect(record?.revoking).toBe(true);
    expect(record?.revokeHash).toBeUndefined();
  });

  test("a new grant replaces the pending revoke and its hash", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input("1000"));
    await store.record(input("0"), REVOKE);
    await store.record(input("7"), "0xdef");
    expect(await store.list()).toEqual([{ ...input("7"), id: ID }]);
  });
});

describe("revoke hash: settling on the outcome", () => {
  const pending = async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input("1000"));
    await store.record(input("0"), REVOKE);
    return store;
  };

  test("a failed revoke clears the mark and keeps the grant at its amount", async () => {
    const store = await pending();
    await store.settleRevocations(
      [{ amount: "1000", id: ID }],
      [{ hash: REVOKE, status: "failed" }],
    );
    expect(await store.list()).toEqual([{ ...input("1000"), id: ID }]);
  });

  // An accepted revoke never deletes a record by itself: only a zero reading
  // does. A failed read is not evidence that nothing stands.
  const ACCEPTED = [{ hash: REVOKE, status: "accepted" as const }];

  test("an accepted revoke with no reading keeps the record and its mark", async () => {
    const store = await pending();
    const before = await store.list();
    await store.settleRevocations([], ACCEPTED);
    expect(await store.list()).toEqual(before);
  });

  test("an accepted revoke with a zero reading drops the record", async () => {
    const store = await pending();
    await store.settleRevocations([{ amount: "0", id: ID }], ACCEPTED);
    expect(await store.list()).toEqual([]);
  });

  // Accepted with a non-zero reading: the reading becomes the exact amount and
  // the pending mark stays, so a stale pre-revoke reading cannot outlive the
  // zero reading that follows it.
  const adopted = (amount: string) => ({ ...input(amount), id: ID, revoking: true as const });

  test("an accepted revoke with a non-zero reading adopts it as the exact amount", async () => {
    const store = await pending();
    await store.settleRevocations([{ amount: "5", id: ID }], ACCEPTED);
    expect(await store.list()).toEqual([adopted("5")]);
  });

  test("an accepted revoke read stale as non-zero is dropped by the next zero reading", async () => {
    const store = await pending();
    // A lagging node answers with the pre-revoke figure.
    await store.settleRevocations([{ amount: "1000", id: ID }], ACCEPTED);
    await store.settleRevocations([{ amount: "0", id: ID }]);
    expect(await store.list()).toEqual([]);
  });

  test("a genuine re-grant is kept at its amount, through a later failed read", async () => {
    const store = await pending();
    await store.settleRevocations([{ amount: "250", id: ID }], ACCEPTED);
    // The next round's allowance read fails: no reading at all.
    await store.settleRevocations([], ACCEPTED);
    expect(await store.list()).toEqual([adopted("250")]);
    const views = mergeAllowanceViews({
      account: { id: ACCOUNT_ID },
      external: [],
      inWallet: await store.list(),
      networkId: "SN_MAIN",
      readings: [{ amount: "250", id: ID }],
    });
    expect(views[0]?.amount).toBe("250");
  });

  test("an accepted decrease to zero with an external increase keeps the grant", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input("1000"));
    await store.applyDelta({
      direction: "subtract",
      input: input("1000"),
      transactionHash: REVOKE,
    });
    // A grant made outside the wallet raised the allowance meanwhile.
    await store.settleRevocations([{ amount: "400", id: ID }], ACCEPTED);
    await store.settleRevocations([], ACCEPTED);
    expect(await store.list()).toEqual([adopted("400")]);
  });

  test("conflicting outcomes for one hash resolve to failed", async () => {
    for (const order of [
      ["accepted", "failed"],
      ["failed", "accepted"],
    ] as const) {
      const store = await pending();
      await store.settleRevocations(
        [{ amount: "5", id: ID }],
        order.map((status) => ({ hash: REVOKE, status })),
      );
      expect(await store.list()).toEqual([{ ...input("1000"), id: ID }]);
    }
  });

  test("a malformed non-zero reading is never adopted", async () => {
    const store = await pending();
    const before = await store.list();
    await store.settleRevocations([{ amount: "-5", id: ID }], ACCEPTED);
    expect(await store.list()).toEqual(before);
  });

  test("an outcome for another transaction changes nothing", async () => {
    const store = await pending();
    const before = await store.list();
    await store.settleRevocations([], [{ hash: "0xdef", status: "failed" }]);
    expect(await store.list()).toEqual(before);
  });

  test("a display view never carries the hash", async () => {
    const store = await pending();
    const views = mergeAllowanceViews({
      account: { id: ACCOUNT_ID },
      external: [],
      inWallet: await store.list(),
      networkId: "SN_MAIN",
    });
    expect(views[0]).not.toHaveProperty("revokeHash");
    expect(views[0]?.revoking).toBe(true);
    expect(views.every(isAllowanceView)).toBe(true);
  });
});
