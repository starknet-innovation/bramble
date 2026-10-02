/**
 * Relay activity rows: a local "signed for relay" authorisation and the
 * on-chain execution a scan found for it. The signed row keeps its message hash
 * but offers no explorer link or copy control, the execution keeps both, and the
 * two only pair when the match is unambiguous.
 */
import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import {
  activityAppearance,
  activityRowModel,
} from "../../../../src/sidepanel/journeys/portfolio/activity-format";
import { relayLinks } from "../../../../src/sidepanel/journeys/portfolio/activity-links";
import {
  transactionGroups,
  transactionRow,
} from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import { accountLabel } from "../../../../src/sidepanel/shared/parts";

const MESSAGE_HASH = `0x09f1a${"0".repeat(58)}`;
const EXECUTION_HASH = `0x09f2b${"0".repeat(58)}`;
const RELAYER = "0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8";
const ACCOUNT_ID = "SN_MAIN:0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";

const signedRow = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  accountId: ACCOUNT_ID,
  hash: MESSAGE_HASH,
  kind: "relay-signed",
  networkId: "SN_MAIN",
  snip9: {
    callCount: 1,
    caller: "0x0",
    dappOrigin: "https://app.example",
    messageHash: MESSAGE_HASH,
    nonce: "0x2a",
    revision: "2",
  },
  status: "accepted",
  submittedAt: 1_700_000_000_000,
  summary: "Signed for relay",
  ...overrides,
});

const executionRow = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  accountId: ACCOUNT_ID,
  counterparty: RELAYER,
  hash: EXECUTION_HASH,
  kind: "invoke",
  networkId: "SN_MAIN",
  origin: "relay",
  snip9: { callCount: 1, caller: "0x0", nonce: "0x2a", revision: "2" },
  status: "accepted",
  submittedAt: 1_700_000_100_000,
  summary: "Relayed execution",
  ...overrides,
});

describe("relayLinks", () => {
  test("pairs a signed row with the one execution that shares its nonce", () => {
    const signed = signedRow();
    const execution = executionRow();
    const links = relayLinks([signed, execution]);

    expect(links.get(signed)).toEqual({ counterpart: execution, kind: "execution" });
    expect(links.get(execution)).toEqual({ counterpart: signed, kind: "signed" });
  });

  test("leaves a doubly signed nonce unlinked", () => {
    const links = relayLinks([
      signedRow(),
      signedRow({
        hash: `0x09f3c${"0".repeat(58)}`,
        snip9: {
          callCount: 1,
          caller: "0x0",
          messageHash: `0x09f3c${"0".repeat(58)}`,
          nonce: "0x2a",
          revision: "2",
        },
      }),
      executionRow(),
    ]);
    expect(links.size).toBe(0);
  });

  test("leaves two executions for one nonce unlinked", () => {
    const links = relayLinks([
      signedRow(),
      executionRow(),
      executionRow({ hash: `0x09f4d${"0".repeat(58)}` }),
    ]);
    expect(links.size).toBe(0);
  });

  test("ignores rows that are not part of a relay pair", () => {
    const { origin: _origin, snip9: _snip9, ...executionBase } = executionRow();
    const transfer: ActivityEntry = { ...executionBase, kind: "transfer" };
    expect(relayLinks([transfer]).size).toBe(0);
  });
});

describe("relay appearances", () => {
  test("names the authorisation and the execution without a value direction", () => {
    expect(activityAppearance(signedRow())).toMatchObject({
      direction: null,
      icon: "keyRound",
      label: "Signed for relay",
      title: "Signed for relay",
    });
    expect(activityAppearance(executionRow())).toMatchObject({
      direction: null,
      icon: "link",
      label: "Relayed execution",
      title: "Relayed execution",
    });
  });

  test("never prices a relay row, even when it carries an amount", () => {
    const pricing = {
      currency: "usd" as const,
      prices: { "0xtoken": 2 },
      tokens: [
        {
          address: "0xtoken",
          decimals: 18,
          id: "SN_MAIN:STRK:0xtoken",
          name: "Starknet Token",
          networkId: "SN_MAIN" as const,
          symbol: "STRK",
        },
      ],
    };
    expect(activityRowModel(signedRow({ amount: "5", token: "STRK" }), pricing).fiat).toBeNull();
    expect(activityRowModel(executionRow({ amount: "5", token: "STRK" }), pricing).fiat).toBeNull();
  });
});

describe("relay rows in the feed", () => {
  test("a signed row shows its message hash without a link or copy control", () => {
    const html = transactionRow(signedRow());

    expect(html).toContain("Signed for relay");
    expect(html).toContain(accountLabel(MESSAGE_HASH));
    expect(html).not.toContain("starkscan");
    expect(html).not.toContain("data-copy");
  });

  test("an unlinked signed row says it has not been relayed", () => {
    const html = transactionRow(signedRow());
    expect(html).toContain("Requested by");
    expect(html).toContain("https://app.example");
    expect(html).toContain("Waiting for a relayer");
  });

  test("a linked signed row points at the execution", () => {
    const signed = signedRow();
    const execution = executionRow();
    const html = transactionRow(
      signed,
      undefined,
      relayLinks([signed, execution]).get(signed) ?? null,
    );

    expect(html).toContain("Executed");
    expect(html).toContain(accountLabel(EXECUTION_HASH));
    expect(html).not.toContain("Waiting for a relayer");
  });

  test("an execution row keeps its explorer link and copy control", () => {
    const html = transactionRow(executionRow());
    expect(html).toContain("Relayed execution");
    expect(html).toContain("starkscan");
    expect(html).toContain("data-copy");
  });

  test("transactionGroups threads the pair into both rows", () => {
    const signed = signedRow();
    const execution = executionRow();
    const html = transactionGroups([execution, signed]);

    expect(html).toContain(accountLabel(EXECUTION_HASH));
    expect(html).toContain("Executed");
    expect(html).not.toContain("Waiting for a relayer");
  });
});
