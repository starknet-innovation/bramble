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
    expect(header).toBe(
      "datetime,networkId,accountId,kind,status,amount,token,counterparty,hash,summary",
    );
    expect(row).toContain('"Calls ""swap"", then transfer"');
    expect(row).toContain("0xabc");
  });

  test("renders the timestamp as ISO-8601 and splits structured columns", async () => {
    const log = createActivityLog({ now: () => 1_700_000_000_000, store: createMemoryStore() });
    await log.record({
      accountId: ACCOUNT_ID,
      amount: "1.5",
      counterparty: "0x777abbcc",
      hash: "0xdef",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send 1.5 ETH",
      token: "ETH",
    });

    const [, row] = activityToCsv(await log.list()).split("\n");
    const cells = row?.split(",");
    expect(cells?.[0]).toBe("2023-11-14T22:13:20.000Z");
    expect(cells?.[4]).toBe("pending");
    expect(cells?.[5]).toBe("1.5");
    expect(cells?.[6]).toBe("ETH");
    expect(cells?.[7]).toBe("0x777abbcc");
    expect(cells?.[8]).toBe("0xdef");
  });

  test("exports blank detail cells for entries lacking the optional fields", async () => {
    const store = createMemoryStore();
    await store.set("mc-wallet:activity", [
      {
        accountId: ACCOUNT_ID,
        hash: "0x1",
        kind: "deploy",
        networkId: "SN_MAIN",
        status: "pending",
        submittedAt: 1_700_000_000_000,
        summary: "Deploy account contract",
      },
    ]);
    const log = createActivityLog({ now: () => 5, store });

    const entries = await log.list();
    expect(entries).toHaveLength(1);
    const [, row] = activityToCsv(entries).split("\n");
    const cells = row?.split(",");
    expect(cells?.[0]).toBe("2023-11-14T22:13:20.000Z");
    expect(cells?.[5]).toBe("");
    expect(cells?.[6]).toBe("");
    expect(cells?.[7]).toBe("");
    expect(cells?.[9]).toBe("Deploy account contract");
  });
});
