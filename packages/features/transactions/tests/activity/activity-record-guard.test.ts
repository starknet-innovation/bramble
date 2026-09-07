/**
 * Activity log record() boundary guard: a malformed entry (one that fails
 * isActivityEntry after the status/timestamp are stamped) is dropped rather than
 * persisted, and the dedup/cap filter drops an earlier entry sharing a hash.
 * Complements activity-store.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { createActivityLog } from "@bramble/transactions/activity";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const validEntry = () => ({
  accountId: ACCOUNT_ID,
  hash: "0x1",
  kind: "transfer" as const,
  networkId: "SN_MAIN" as const,
  summary: "Send 1 ETH",
});

describe("createActivityLog record guard", () => {
  test("drops an entry whose hash is not a valid field element", async () => {
    const store = createMemoryStore();
    const log = createActivityLog({ now: () => 5, store });

    // hash "not-a-felt" makes isActivityEntry(next) false -> record returns early.
    await log.record({ ...validEntry(), hash: "not-a-felt" } as unknown as ReturnType<
      typeof validEntry
    >);

    expect(await log.list()).toEqual([]);
    expect(await store.get("bramble:activity")).toBeUndefined();
  });

  test("drops an entry with an unknown transaction kind", async () => {
    const store = createMemoryStore();
    const log = createActivityLog({ now: () => 5, store });

    await log.record({ ...validEntry(), kind: "bogus" } as unknown as ReturnType<
      typeof validEntry
    >);

    expect(await log.list()).toEqual([]);
  });

  test("keeps a valid entry recorded after a dropped malformed one", async () => {
    const store = createMemoryStore();
    const log = createActivityLog({ now: () => 5, store });

    await log.record({ ...validEntry(), summary: "" } as unknown as ReturnType<typeof validEntry>);
    await log.record(validEntry());

    const entries = await log.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.hash).toBe("0x1");
    expect(entries[0]?.status).toBe("pending");
  });

  test("re-recording the same hash replaces the earlier entry (dedup filter)", async () => {
    const store = createMemoryStore();
    let tick = 0;
    const log = createActivityLog({
      now: () => {
        tick += 1000;
        return tick;
      },
      store,
    });

    await log.record({ ...validEntry(), summary: "first" });
    await log.record({ ...validEntry(), summary: "second" });

    const entries = await log.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.summary).toBe("second");
    expect(entries[0]?.submittedAt).toBe(2000);
  });
});
