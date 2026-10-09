/**
 * CSV export checks: the column shape, the UTC date-time, the plain account
 * address, the explorer link, and the rebuilt transfer summary.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { activityToCsv, createActivityLog } from "@bramble/transactions/activity";

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
      "datetimeUtc,networkId,accountAddress,kind,status,amount,token,counterparty,transactionHash,explorerUrl,summary",
    );
    expect(row).toContain('"Calls ""swap"", then transfer"');
    expect(row).toContain('"0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde"');
    expect(row).toContain('"https://starkscan.co/tx/0xabc"');
  });

  test("renders the UTC date-time and splits structured columns", async () => {
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
    expect(cells?.[0]).toBe('"2023-11-14 22:13:20"');
    expect(cells?.[2]).toBe('"0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde"');
    expect(cells?.[4]).toBe('"pending"');
    expect(cells?.[5]).toBe('"1.5"');
    expect(cells?.[6]).toBe('"ETH"');
    expect(cells?.[7]).toBe('"0x777abbcc"');
    expect(cells?.[8]).toBe('"0xdef"');
    expect(cells?.[9]).toBe('"https://starkscan.co/tx/0xdef"');
    expect(cells?.[10]).toBe('"Sent 1.5 ETH to 0x777abbcc"');
  });

  test("rebuilds a transfer summary with the full counterparty and one verb", () => {
    const base = {
      accountId: ACCOUNT_ID,
      amount: "2",
      counterparty: "0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8",
      hash: "0x2",
      kind: "transfer",
      networkId: "SN_MAIN",
      status: "accepted",
      submittedAt: 1_700_000_000_000,
      token: "STRK",
    };
    const [outgoing, incoming] = activityToCsv([
      { ...base, summary: "Send 2 STRK to 0x1176…f3d8" },
      { ...base, summary: "Received 2 STRK from 0x1176…f3d8" },
    ])
      .split("\n")
      .slice(1);
    expect(
      outgoing?.endsWith(
        '"Sent 2 STRK to 0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8"',
      ),
    ).toBe(true);
    expect(
      incoming?.endsWith(
        '"Received 2 STRK from 0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8"',
      ),
    ).toBe(true);
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
    expect(cells?.[0]).toBe('"2023-11-14 22:13:20"');
    expect(cells?.[5]).toBe('""');
    expect(cells?.[6]).toBe('""');
    expect(cells?.[7]).toBe('""');
    expect(cells?.[9]).toBe('"https://starkscan.co/tx/0x1"');
    expect(cells?.[10]).toBe('"Deploy account contract"');
  });
});
