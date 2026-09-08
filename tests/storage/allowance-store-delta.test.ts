/**
 * MCW-V09-108: ERC20's relative allowance changes are applied INSIDE the
 * allowance store, as one serialized read-modify-write, and a change applied on
 * top of a base the wallet never saw is recorded as a lower bound rather than as
 * a total. These are the invariants that keep the log equal to the standing
 * allowance — or honestly short of it — after any sequence of writes, including
 * concurrent ones.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import {
  ALLOWANCE_LIMITS,
  type AllowanceInput,
  createAllowanceStore,
  memoryAllowanceStore,
} from "@bramble/transactions/allowance-store";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x05";
const UINT_256_MAX = ((1n << 256n) - 1n).toString();

const input = (amount: string, spender = SPENDER): AllowanceInput => ({
  accountId: ACCOUNT_ID,
  amount,
  networkId: "SN_MAIN",
  spender,
  token: TOKEN,
});

describe("allowance store deltas", () => {
  test("two concurrent increases both land", async () => {
    // The lost update this replaces: reading with `list` and writing with
    // `record` at a caller straddles the mutation queue, because `list` is a
    // concurrent read by design. Two dapp invokes handled at once then both
    // read the same base and the second overwrites the first, understating the
    // standing allowance by a whole grant.
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input("100"));
    await Promise.all([
      store.applyDelta({ direction: "add", input: input("100") }),
      store.applyDelta({ direction: "add", input: input("100") }),
    ]);

    expect((await store.list()).map((entry) => entry.amount)).toEqual(["300"]);
  });

  test("concurrent increases and decreases settle on the net total", async () => {
    const store = createAllowanceStore({ store: createMemoryStore() });
    await store.record(input("1000"));
    await Promise.all([
      store.applyDelta({ direction: "add", input: input("500") }),
      store.applyDelta({ direction: "subtract", input: input("200") }),
      store.applyDelta({ direction: "add", input: input("700") }),
    ]);

    expect((await store.list()).map((entry) => entry.amount)).toEqual(["2000"]);
  });

  test("an increase with no tracked base is a lower bound, not a total", async () => {
    const store = memoryAllowanceStore();
    await store.applyDelta({ direction: "add", input: input("1") });

    expect((await store.list())[0]).toMatchObject({ amount: "1", lowerBound: true });
  });

  test("a record evicted by the retention cap is not re-established as an exact total", async () => {
    // Ordinary churn evicts the oldest record in a scope. A later increase then
    // finds no base — and must not rewrite a standing unlimited grant down to
    // the increment, which is what made a 1-wei top-up display as "1".
    const store = memoryAllowanceStore();
    const unlimited = ((1n << 128n) + 5n).toString();
    await store.record(input(unlimited));
    for (let index = 0; index < ALLOWANCE_LIMITS.entriesPerScope; index += 1) {
      await store.record(input("5", `0x${(index + 100).toString(16)}`));
    }
    expect((await store.list()).some((entry) => entry.amount === unlimited)).toBe(false);

    await store.applyDelta({ direction: "add", input: input("1") });
    const revived = (await store.list()).find((entry) => entry.spender === "0x5");
    expect(revived).toMatchObject({ amount: "1", lowerBound: true });
  });

  test("an increase saturates at the uint256 ceiling instead of overflowing", async () => {
    const store = memoryAllowanceStore();
    await store.record(input(UINT_256_MAX));
    await store.applyDelta({ direction: "add", input: input("1000") });

    const [entry] = await store.list();
    // Still a storable amount: the ceiling is exactly the longest amount the
    // record validator accepts, so a saturated total is not silently dropped.
    expect(entry?.amount).toBe(UINT_256_MAX);
  });

  test("a decrease floors at zero, which clears an EXACT entry", async () => {
    // The base was stated by an `approve` this wallet saw, so 100 - 400 really
    // is a standing allowance of zero and the entry is spent.
    const store = memoryAllowanceStore();
    await store.record(input("100"));
    await store.applyDelta({ direction: "subtract", input: input("400") });

    expect(await store.list()).toEqual([]);
  });

  // MCW-V09-108: lower-bound erasure. A bound of zero bounds nothing, so
  // flooring one must not be read as "the allowance is now zero" — the base the
  // wallet never saw may still stand, and deleting the record removes the only
  // row the manager could revoke it from (and the only pair a live
  // `allowance(owner, spender)` reading would be taken for).
  test("a decrease that floors a LOWER BOUND keeps the pair as an unknown amount", async () => {
    const store = memoryAllowanceStore();
    await store.applyDelta({ direction: "add", input: input("100") });
    await store.applyDelta({ direction: "subtract", input: input("100") });

    expect(await store.list()).toMatchObject([{ amount: "0", lowerBound: true }]);
  });

  test("a decrease with no tracked base records an unknown remainder, not nothing", async () => {
    const store = memoryAllowanceStore();
    await store.applyDelta({ direction: "subtract", input: input("400") });

    expect(await store.list()).toMatchObject([{ amount: "0", lowerBound: true }]);
  });

  test("an unknown remainder is corrected upward by a later increase", async () => {
    // The zero bound is a floor, not a total: a subsequent grant adds to it and
    // the record stays honest about still being a bound.
    const store = memoryAllowanceStore();
    await store.applyDelta({ direction: "subtract", input: input("400") });
    expect(await store.list()).toMatchObject([{ amount: "0", lowerBound: true }]);

    await store.applyDelta({ direction: "add", input: input("25") });
    expect(await store.list()).toMatchObject([{ amount: "25", lowerBound: true }]);
  });

  test("a malformed delta is ignored rather than stored", async () => {
    const store = memoryAllowanceStore();
    await store.applyDelta({ direction: "add", input: input("not-a-number") });
    await store.applyDelta({ direction: "add", input: { ...input("5"), token: "nope" } });

    expect(await store.list()).toEqual([]);
  });

  test("the persistent and in-memory stores apply identical semantics", async () => {
    const persistent = createAllowanceStore({ store: createMemoryStore() });
    const memory = memoryAllowanceStore();
    for (const store of [persistent, memory]) {
      await store.applyDelta({ direction: "add", input: input("7") });
      await store.applyDelta({ direction: "add", input: input("3") });
      await store.applyDelta({ direction: "subtract", input: input("4") });
    }

    expect(await persistent.list()).toEqual([...(await memory.list())]);
    expect((await persistent.list())[0]).toMatchObject({ amount: "6", lowerBound: true });
  });
});
