/**
 * Activity log checks: recording, status updates, ordering, capping, and CSV
 * export stay validated and deterministic.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import {
  activityForScope,
  activityToCsv,
  createActivityLog,
  memoryActivityLog,
} from "@bramble/transactions/activity";
import { MAX_TRANSACTION_ALERTS_PER_DRAIN } from "@bramble/transactions/alerts";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const OTHER_ACCOUNT_ID =
  "SN_MAIN:0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const SEPOLIA_ACCOUNT_ID =
  "SN_SEPOLIA:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const MAIN_SCOPE = { accountId: ACCOUNT_ID, networkId: "SN_MAIN" as const };

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
  test("persists history attempt state by account scope", async () => {
    const store = createMemoryStore();
    const log = createActivityLog({ store });
    await log.markHistorySynced?.(MAIN_SCOPE, 42, true);

    expect(await createActivityLog({ store }).historySync?.(MAIN_SCOPE)).toEqual({
      syncedAt: 42,
      unavailable: true,
    });
    expect(
      await createActivityLog({ store }).historySync?.({
        accountId: OTHER_ACCOUNT_ID,
        networkId: "SN_MAIN",
      }),
    ).toBeNull();
  });

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
      accountId: SEPOLIA_ACCOUNT_ID,
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
      activityForScope(all, { accountId: SEPOLIA_ACCOUNT_ID, networkId: "SN_SEPOLIA" })[0]?.status,
    ).toBe("pending");
  });

  test("drops malformed stored entries instead of trusting them", async () => {
    const store = createMemoryStore();
    await store.set("bramble:activity", [
      {
        accountId: ACCOUNT_ID,
        hash: "0x1",
        kind: "transfer",
        networkId: "SN_MAIN",
        status: "pending",
        submittedAt: 1,
        summary: "ok",
      },
      {
        accountId: ACCOUNT_ID,
        hash: "0x3",
        kind: "transfer",
        networkId: "SN_SEPOLIA",
        status: "pending",
        submittedAt: 2,
        summary: "contradictory account scope",
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
    expect(cells?.[0]).toBe('"2023-11-14T22:13:20.000Z"');
    expect(cells?.[4]).toBe('"pending"');
    expect(cells?.[5]).toBe('"1.5"');
    expect(cells?.[6]).toBe('"ETH"');
    expect(cells?.[7]).toBe('"0x777abbcc"');
    expect(cells?.[8]).toBe('"0xdef"');
  });

  test("exports blank detail cells for entries lacking the optional fields", async () => {
    const store = createMemoryStore();
    await store.set("bramble:activity", [
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
    expect(cells?.[0]).toBe('"2023-11-14T22:13:20.000Z"');
    expect(cells?.[5]).toBe('""');
    expect(cells?.[6]).toBe('""');
    expect(cells?.[7]).toBe('""');
    expect(cells?.[9]).toBe('"Deploy account contract"');
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

    const first = await log.takeFailureNotices(MAIN_SCOPE);
    expect(first.map((entry) => entry.hash)).toEqual(["0x1"]);
    expect(await log.takeFailureNotices(MAIN_SCOPE)).toEqual([]);
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
    expect(await log.takeFailureNotices(MAIN_SCOPE)).toHaveLength(1);
    expect(await log.takeFailureNotices(MAIN_SCOPE)).toEqual([]);
  });

  test("scopes and bounds each failure-notice drain", async () => {
    const log = makeLog();
    for (let index = 1; index <= MAX_TRANSACTION_ALERTS_PER_DRAIN + 2; index += 1) {
      const hash = `0x${index.toString(16)}`;
      await log.record({
        accountId: ACCOUNT_ID,
        hash,
        kind: "transfer",
        networkId: "SN_MAIN",
        summary: `Send ${index}`,
      });
      await log.updateStatuses(
        { [hash]: { failureNotice: "pending", status: "reverted" } },
        MAIN_SCOPE,
      );
    }
    await log.record({
      accountId: OTHER_ACCOUNT_ID,
      hash: "0xff",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Other account send",
    });
    const otherScope = { accountId: OTHER_ACCOUNT_ID, networkId: "SN_MAIN" as const };
    await log.updateStatuses(
      { "0xff": { failureNotice: "pending", status: "reverted" } },
      otherScope,
    );

    expect(await log.takeFailureNotices(MAIN_SCOPE)).toHaveLength(MAX_TRANSACTION_ALERTS_PER_DRAIN);
    expect(await log.takeFailureNotices(MAIN_SCOPE)).toHaveLength(2);
    expect((await log.takeFailureNotices(otherScope)).map((entry) => entry.hash)).toEqual(["0xff"]);
  });

  test("keeps terminal progress, L1 finality, and delivered notices monotonic", async () => {
    const log = makeLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send",
    });
    await log.updateStatuses(
      { "0x1": { failureNotice: "pending", finalizedOnL1: true, status: "reverted" } },
      MAIN_SCOPE,
    );
    expect(await log.takeFailureNotices(MAIN_SCOPE)).toHaveLength(1);
    const [stored] = await log.updateStatuses(
      { "0x1": { failureNotice: "pending", finalizedOnL1: false, status: "accepted" } },
      MAIN_SCOPE,
    );
    expect(stored).toMatchObject({
      failureNotice: "delivered",
      finalizedOnL1: true,
      status: "reverted",
    });
    expect(await log.takeFailureNotices(MAIN_SCOPE)).toEqual([]);
  });

  test("never demotes accepted or pre-confirmed progress", async () => {
    const log = makeLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Accepted send",
    });
    await log.updateStatuses({ "0x1": { status: "accepted" } }, MAIN_SCOPE);
    expect(
      (await log.updateStatuses({ "0x1": { status: "preconfirmed" } }, MAIN_SCOPE))[0]?.status,
    ).toBe("accepted");

    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x2",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Pre-confirmed send",
    });
    await log.updateStatuses({ "0x2": { status: "preconfirmed" } }, MAIN_SCOPE);
    const next = await log.updateStatuses({ "0x2": { status: "pending" } }, MAIN_SCOPE);
    expect(next.find((entry) => entry.hash === "0x2")?.status).toBe("preconfirmed");
  });

  test("loads entries stored before the tracking fields existed", async () => {
    const store = createMemoryStore();
    await store.set("bramble:activity", [
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
    await store.set("bramble:activity", [
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

// Audit #247: the sighting flag decides whether repeated not-found answers can
// reject a transaction, so it must validate strictly and never be lost.
describe("seenOnChain tracking flag", () => {
  const stored = (seenOnChain: boolean | string) => ({
    accountId: ACCOUNT_ID,
    hash: "0x1",
    kind: "transfer",
    networkId: "SN_MAIN",
    seenOnChain,
    status: "pending",
    submittedAt: 1,
    summary: "Send",
  });

  test("accepts a boolean flag and rejects any other value", async () => {
    const store = createMemoryStore();
    await store.set("bramble:activity", [stored(true)]);
    expect((await createActivityLog({ store }).list())[0]?.seenOnChain).toBe(true);
    await store.set("bramble:activity", [stored("yes")]);
    expect(await createActivityLog({ store }).list()).toEqual([]);
  });

  test("never clears a recorded sighting", async () => {
    const log = makeLog();
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send",
    });
    await log.updateStatuses({ "0x1": { seenOnChain: true, status: "pending" } }, MAIN_SCOPE);
    const after = await log.updateStatuses(
      { "0x1": { notFoundCount: 1, seenOnChain: false, status: "pending" } },
      MAIN_SCOPE,
    );
    expect(after[0]?.seenOnChain).toBe(true);
    expect(after[0]?.notFoundCount).toBe(1);
  });
});
