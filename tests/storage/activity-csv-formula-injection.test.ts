/**
 * MCW-V09-123: the activity CSV export carries text this wallet never controls
 * (a dapp-supplied token symbol or origin reaches the summary and counterparty),
 * so no exported cell may open a spreadsheet formula and no cell may break out
 * of its row.
 */
import { describe, expect, test } from "bun:test";
import {
  type ActivityEntry,
  activityToCsv,
  memoryActivityLog,
} from "@mc-wallet/transactions/activity";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const entry = (fields: Partial<ActivityEntry>): ActivityEntry => ({
  accountId: ACCOUNT_ID,
  hash: "0x1",
  kind: "invoke",
  networkId: "SN_MAIN",
  status: "pending",
  submittedAt: 1_700_000_000_000,
  summary: "Approve spender",
  ...fields,
});

const dataCells = (entries: readonly ActivityEntry[]): readonly string[] => {
  const rows = activityToCsv(entries).split("\n");
  return (rows[1] ?? "").split(",");
};

describe("activityToCsv formula-injection neutralization", () => {
  const leads: readonly (readonly [string, string])[] = [
    ["equals", "=1+1"],
    ["plus", "+1+1"],
    ["minus", "-2+3"],
    ["at", "@SUM(A1:A9)"],
    ["tab", "\t=1+1"],
    ["carriage return", "\r=1+1"],
  ];

  for (const [lead, summary] of leads) {
    test(`neutralizes a summary opening with ${lead}`, () => {
      const cells = dataCells([entry({ summary })]);
      expect(cells[9]).toBe(`"'${summary}"`);
    });
  }

  // Padding an importer may skip before deciding the cell is a formula. The
  // summary is the last column, so the whole row is asserted to end with the
  // neutralized cell — a padded line feed must not break the row either.
  const padded: readonly (readonly [string, string])[] = [
    ["space", " =1+1"],
    ["line feed", "\n=1+1"],
    ["vertical tab", "\v=1+1"],
    ["no-break space", "\u00a0=1+1"],
    ["byte-order mark", "\ufeff=1+1"],
    ["NUL", "\u0000=1+1"],
    ["delete", "\u007f=1+1"],
    ["mixed padding", " \t  @SUM(A1:A9)"],
  ];

  for (const [padding, summary] of padded) {
    test(`neutralizes a formula hidden behind ${padding} padding`, () => {
      const csv = activityToCsv([entry({ summary })]);
      expect(csv.endsWith(`"'${summary}"`)).toBe(true);
    });
  }

  test("does not prefix ordinary text that merely starts with padding", () => {
    const cells = dataCells([entry({ summary: " Send 1.5 ETH" })]);
    expect(cells[9]).toBe('" Send 1.5 ETH"');
  });

  test("neutralizes attacker text reaching the token and counterparty columns", () => {
    const cells = dataCells([
      entry({ counterparty: "@evil.example", summary: "Send", token: "=cmd|'/c calc'!A1" }),
    ]);
    expect(cells[6]).toBe("\"'=cmd|'/c calc'!A1\"");
    expect(cells[7]).toBe('"\'@evil.example"');
  });

  test("leaves ordinary text untouched apart from the surrounding quotes", () => {
    const cells = dataCells([entry({ summary: "Send 1.5 ETH", token: "ETH" })]);
    expect(cells[6]).toBe('"ETH"');
    expect(cells[9]).toBe('"Send 1.5 ETH"');
  });

  test("quotes every column so a delimiter or quote cannot break the row", () => {
    const csv = activityToCsv([entry({ summary: 'Calls "swap", then transfer' })]);
    const rows = csv.split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.startsWith('"2023-11-14T22:13:20.000Z","SN_MAIN",')).toBe(true);
    expect(rows[1]?.endsWith('"Calls ""swap"", then transfer"')).toBe(true);
  });

  test("keeps a comma-bearing formula inside a single quoted cell", () => {
    const summary = '=HYPERLINK("https://evil.example","claim")';
    const rows = activityToCsv([entry({ summary })]).split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.endsWith('"\'=HYPERLINK(""https://evil.example"",""claim"")"')).toBe(true);
  });

  test("neutralizes a recorded summary end to end through the log", async () => {
    const log = memoryActivityLog(() => 1_700_000_000_000);
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x2",
      kind: "invoke",
      networkId: "SN_MAIN",
      summary: "=1+1",
    });

    const [, row] = activityToCsv(await log.list()).split("\n");
    expect(row).toContain('"\'=1+1"');
    expect(row).not.toContain(",=1+1");
  });
});
