/**
 * Activity log checks: recording, status updates, ordering, capping, and CSV
 * export stay validated and deterministic.
 */
import { describe, expect, test } from "bun:test";
import {
  activityForScope,
  activityToCsv,
  createActivityLog,
  memoryActivityLog,
} from "../../src/storage/activity-store";
import { createMemoryStore } from "../../src/storage/kv";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const OTHER_ACCOUNT_ID =
  "SN_MAIN:0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

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
    const updated = await log.updateStatuses(
      { "0x1": { status: "accepted" }, "0x9": { status: "reverted" } },
      { accountId: ACCOUNT_ID, networkId: "SN_MAIN" },
    );

    expect(updated[0]?.status).toBe("accepted");
    expect(updated).toHaveLength(1);
  });

  test("partitions duplicate hashes and status updates by account and network", async () => {
    const log = makeLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x01",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "First account send",
    });
    await log.record({
      accountId: OTHER_ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Second account send",
    });
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_SEPOLIA",
      summary: "Other network send",
    });

    const scope = { accountId: ACCOUNT_ID, networkId: "SN_MAIN" as const };
    const updated = await log.updateStatuses({ "0x1": { status: "accepted" } }, scope);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.summary).toBe("First account send");
    expect(updated[0]?.status).toBe("accepted");

    const all = await log.list();
    expect(all).toHaveLength(3);
    expect(
      activityForScope(all, { accountId: OTHER_ACCOUNT_ID, networkId: "SN_MAIN" })[0]?.status,
    ).toBe("pending");
    expect(
      activityForScope(all, { accountId: ACCOUNT_ID, networkId: "SN_SEPOLIA" })[0]?.status,
    ).toBe("pending");
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

describe("provisional status and tracking fields", () => {
  test("stores preconfirmed as its own status and records L1 finality separately", async () => {
    const log = makeLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send",
    });
    const scope = { accountId: ACCOUNT_ID, networkId: "SN_MAIN" as const };

    const provisional = await log.updateStatuses({ "0x1": { status: "preconfirmed" } }, scope);
    expect(provisional[0]?.status).toBe("preconfirmed");
    expect(provisional[0]?.finalizedOnL1).toBeUndefined();

    // L1 finality never becomes a visible status of its own.
    const final = await log.updateStatuses(
      { "0x1": { finalizedOnL1: true, status: "accepted" } },
      scope,
    );
    expect(final[0]?.status).toBe("accepted");
    expect(final[0]?.finalizedOnL1).toBe(true);
  });

  test("hands each failure notice out exactly once", async () => {
    const log = makeLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send",
    });
    await log.updateStatuses(
      { "0x1": { failureNotice: "pending", status: "reverted" } },
      { accountId: ACCOUNT_ID, networkId: "SN_MAIN" },
    );

    const first = await log.takeFailureNotices();
    expect(first.map((entry) => entry.hash)).toEqual(["0x1"]);
    expect(await log.takeFailureNotices()).toEqual([]);
    // The terminal status survives delivery: the record is the durable truth.
    expect((await log.list())[0]?.status).toBe("reverted");
    expect((await log.list())[0]?.failureNotice).toBe("delivered");
  });

  test("keeps the entry unchanged when an outcome would not revalidate", async () => {
    const log = makeLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send",
    });
    const updated = await log.updateStatuses(
      { "0x1": { notFoundCount: -3, status: "rejected" } },
      { accountId: ACCOUNT_ID, networkId: "SN_MAIN" },
    );
    expect(updated[0]?.status).toBe("pending");
    expect(updated[0]?.notFoundCount).toBeUndefined();
  });

  test("the in-memory double drains notices with the same once-only contract", async () => {
    const log = memoryActivityLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send",
    });
    await log.updateStatuses(
      { "0x1": { failureNotice: "pending", status: "reverted" } },
      { accountId: ACCOUNT_ID, networkId: "SN_MAIN" },
    );
    expect(await log.takeFailureNotices()).toHaveLength(1);
    expect(await log.takeFailureNotices()).toEqual([]);
  });

  test("loads entries stored before the tracking fields existed", async () => {
    const store = createMemoryStore();
    await store.set("mc-wallet:activity", [
      {
        accountId: ACCOUNT_ID,
        hash: "0x1",
        kind: "transfer",
        networkId: "SN_MAIN",
        status: "pending",
        submittedAt: 1,
        summary: "Old entry",
      },
    ]);
    const log = createActivityLog({ now: () => 5, store });
    expect((await log.list())[0]?.summary).toBe("Old entry");
  });

  test("rejects stored entries with a malformed tracking field", async () => {
    const store = createMemoryStore();
    await store.set("mc-wallet:activity", [
      {
        accountId: ACCOUNT_ID,
        failureNotice: "shown",
        hash: "0x1",
        kind: "transfer",
        networkId: "SN_MAIN",
        status: "pending",
        submittedAt: 1,
        summary: "Bad notice",
      },
      {
        accountId: ACCOUNT_ID,
        hash: "0x2",
        kind: "transfer",
        networkId: "SN_MAIN",
        notFoundCount: -1,
        status: "pending",
        submittedAt: 1,
        summary: "Bad tally",
      },
      {
        accountId: ACCOUNT_ID,
        finalizedOnL1: "yes",
        hash: "0x3",
        kind: "transfer",
        networkId: "SN_MAIN",
        status: "pending",
        submittedAt: 1,
        summary: "Bad finality",
      },
    ]);
    expect(await createActivityLog({ now: () => 5, store }).list()).toEqual([]);
  });
});
