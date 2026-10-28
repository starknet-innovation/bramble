/**
 * Sherlock 181: `getEvents` streams a token's log oldest-first, so an
 * unfiltered scan of a busy token spent its whole page budget on the first
 * approvals anyone made and never reached the account's own. Discovery now asks
 * the node for the owner's approvals by key, and reports when it could not read
 * a log to the end. The node here filters by key position and pages
 * oldest-first, as `starknet_getEvents` does.
 */
import { describe, expect, test } from "bun:test";
import { APPROVAL_EVENT_KEY } from "@bramble/transactions/allowance-discovery";
import {
  type AllowanceEvent,
  type AllowanceEventFilter,
  type AllowanceRpc,
  collectExternalAllowances,
} from "@bramble/transactions/allowance-scan";

const OWNER = "0x1234567890abcdef";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const DRAINER = `0x7${"d".repeat(62)}`;
const UNLIMITED_LOW = "0xffffffffffffffffffffffffffffffff";
const canonical = (value: string): string => `0x${BigInt(value).toString(16)}`;

const cairo1 = (owner: string, spender: string): AllowanceEvent => ({
  data: ["0x64", "0x0"],
  keys: [APPROVAL_EVENT_KEY, owner, spender],
});
const legacy = (owner: string, spender: string): AllowanceEvent => ({
  data: [owner, spender, "0x64", "0x0"],
  keys: [APPROVAL_EVENT_KEY],
});
const strangers = (count: number, make = cairo1): AllowanceEvent[] =>
  Array.from({ length: count }, (_, index) =>
    make(`0x${(0x9000 + index).toString(16)}`, `0x${(0x5000 + index).toString(16)}`),
  );

// Matches an event against a key filter the way the spec defines it: each
// non-empty group constrains its position, and an event with fewer keys than
// a constrained position does not match.
const matches = (event: AllowanceEvent, keys: readonly string[][]): boolean =>
  keys.every(
    (group, position) =>
      group.length === 0 ||
      (event.keys[position] !== undefined &&
        group.some((key) => BigInt(key) === BigInt(event.keys[position] ?? "0x0"))),
  );

const node = (log: readonly AllowanceEvent[]) => {
  const filters: AllowanceEventFilter[] = [];
  const rpc: AllowanceRpc = {
    async callContract(call) {
      const spender = canonical(String((call.calldata as string[])[1]));
      return spender === canonical(DRAINER) ? [UNLIMITED_LOW, "0x0"] : ["0x0", "0x0"];
    },
    async getLatestBlockNumber() {
      return 100;
    },
    async getEvents(filter) {
      filters.push(filter);
      const matching = log.filter((event) => matches(event, filter.keys));
      const start = Number(filter.continuation_token ?? "0");
      const end = start + filter.chunk_size;
      return {
        events: matching.slice(start, end),
        ...(end < matching.length ? { continuation_token: String(end) } : {}),
      };
    },
  };
  return { filters, rpc };
};

describe("owner-filtered discovery", () => {
  test("finds the owner's approval behind 600 earlier approvals by others", async () => {
    const { filters, rpc } = node([...strangers(600), cairo1(OWNER, DRAINER)]);

    const found = await collectExternalAllowances(rpc, { owner: OWNER, tokens: [TOKEN] });

    expect(found.allowances).toEqual([
      {
        amount: BigInt(UNLIMITED_LOW).toString(),
        spender: canonical(DRAINER),
        token: canonical(TOKEN),
      },
    ]);
    // The unfiltered log ran out of pages, but held only Cairo 1 events, which
    // the owner filter covers: nothing was missed.
    expect(found.complete).toBe(true);
    expect(filters[0]?.keys).toEqual([[APPROVAL_EVENT_KEY], [canonical(OWNER)]]);
  });

  test("reads a legacy token's log in full when it fits the budget", async () => {
    const { rpc } = node([...strangers(50, legacy), legacy(OWNER, DRAINER)]);

    const found = await collectExternalAllowances(rpc, { owner: OWNER, tokens: [TOKEN] });

    expect(found.allowances.map((entry) => entry.spender)).toEqual([canonical(DRAINER)]);
    expect(found.complete).toBe(true);
  });

  test("is incomplete when a legacy token's log is longer than the budget", async () => {
    const { rpc } = node([...strangers(600, legacy), legacy(OWNER, DRAINER)]);

    const found = await collectExternalAllowances(rpc, { owner: OWNER, tokens: [TOKEN] });

    expect(found.allowances).toEqual([]);
    expect(found.complete).toBe(false);
  });

  test("is incomplete when the owner's own approvals outrun the budget", async () => {
    const owned = Array.from({ length: 600 }, (_, index) =>
      cairo1(OWNER, `0x${(0x7000 + index).toString(16)}`),
    );
    const { rpc } = node(owned);

    expect((await collectExternalAllowances(rpc, { owner: OWNER, tokens: [TOKEN] })).complete).toBe(
      false,
    );
  });
});
