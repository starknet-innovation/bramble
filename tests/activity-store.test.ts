/**
 * Activity log checks: recording, status updates, ordering, capping, and CSV
 * export stay validated and deterministic.
 */
import { describe, expect, test } from "bun:test";
import { activityToCsv, createActivityLog } from "../src/storage/activity-store";
import { createMemoryStore } from "../src/storage/kv";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const makeLog = () => {
  let tick = 0;
  return createActivityLog({
    now: () => {
      tick += 1000;
      return tick;
    },
    store: createMemoryStore(),
  });
};

describe("createActivityLog", () => {
  test("records submissions as pending and lists newest first", async () => {
    const log = makeLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send 1.5 ETH to 0x777a…bbcc",
    });
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x2",
      kind: "deploy",
      networkId: "SN_MAIN",
      summary: "Deploy account contract",
    });

    const entries = await log.list();
    expect(entries.map((entry) => entry.hash)).toEqual(["0x2", "0x1"]);
    expect(entries.every((entry) => entry.status === "pending")).toBe(true);
  });

  test("updates only known pending statuses", async () => {
    const log = makeLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send",
    });
    const updated = await log.updateStatuses({ "0x1": "accepted", "0x9": "reverted" });

    expect(updated[0]?.status).toBe("accepted");
    expect(updated).toHaveLength(1);
  });

  test("drops malformed stored entries instead of trusting them", async () => {
    const store = createMemoryStore();
    await store.set("mc-wallet:activity", [
      {
        accountId: ACCOUNT_ID,
        hash: "0x1",
        kind: "transfer",
        networkId: "SN_MAIN",
        status: "pending",
        submittedAt: 1,
        summary: "ok",
      },
      { hash: "0x2", nefarious: true },
    ]);
    const log = createActivityLog({ now: () => 5, store });

    const entries = await log.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.hash).toBe("0x1");
  });
});

describe("activityToCsv", () => {
  test("serializes rows and escapes embedded quotes and commas", async () => {
    const log = makeLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0xabc",
      kind: "invoke",
      networkId: "SN_MAIN",
      summary: 'Calls "swap", then transfer',
    });

    const csv = activityToCsv(await log.list());
    const [header, row] = csv.split("\n");
    expect(header).toBe("submittedAtMs,networkId,accountId,kind,status,hash,summary");
    expect(row).toContain('"Calls ""swap"", then transfer"');
    expect(row).toContain("0xabc");
  });
});
