/**
 * #299: the activity store journals a locally signed OutsideExecution as an
 * accepted "relay-signed" row keyed by its message hash. The write is
 * deduplicated by that hash, survives a reload from the same store, and a
 * detail without a message hash is refused so a chain row can never be planted
 * as something this wallet signed.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { createActivityLog, memoryActivityLog } from "@bramble/transactions/activity";

const ACCOUNT = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const HASH = "0x5c1d";

const record = (hash: string, messageHash: string | undefined) => ({
  accountId: ACCOUNT,
  hash,
  networkId: "SN_MAIN" as const,
  snip9:
    messageHash === undefined
      ? { callCount: 1, caller: "0x2", nonce: "0x7", revision: "2" as const }
      : { callCount: 1, caller: "0x2", messageHash, nonce: "0x7", revision: "2" as const },
  summary: "Signed for relay",
});

describe("recordRelaySignature (persistent store)", () => {
  test("writes an accepted relay-signed row and dedups by message hash", async () => {
    const store = createMemoryStore();
    const activity = createActivityLog({ now: () => 100, store });
    await activity.recordRelaySignature?.(record(HASH, HASH));
    await activity.recordRelaySignature?.(record(HASH, HASH));
    const rows = await activity.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "relay-signed", status: "accepted", submittedAt: 100 });
    expect(rows[0]?.origin).toBeUndefined();
    expect(rows[0]?.snip9?.messageHash).toBe(HASH);
  });

  test("persists across a reload from the same store", async () => {
    const store = createMemoryStore();
    await createActivityLog({ now: () => 100, store }).recordRelaySignature?.(record(HASH, HASH));
    const reopened = await createActivityLog({ now: () => 100, store }).list();
    expect(reopened.map((row) => row.kind)).toEqual(["relay-signed"]);
  });

  test("refuses a detail without the message hash", async () => {
    const activity = createActivityLog({ now: () => 100, store: createMemoryStore() });
    await activity.recordRelaySignature?.(record(HASH, undefined));
    expect(await activity.list()).toEqual([]);
  });
});

describe("recordRelaySignature (in-memory default)", () => {
  test("records an accepted row and keeps one per message hash", async () => {
    const activity = memoryActivityLog(() => 5);
    await activity.recordRelaySignature?.(record(HASH, HASH));
    await activity.recordRelaySignature?.(record(HASH, HASH));
    const rows = await activity.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "relay-signed", status: "accepted" });
  });
});
