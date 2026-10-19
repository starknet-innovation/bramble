/**
 * Sherlock 181: a legacy-layout approval names its owner only in the data
 * payload, so no key filter reaches it and discovery reads the unfiltered log.
 * Read from the token's first event, that log never got past the Cairo 0
 * approvals mainnet ETH and STRK opened with, so every scan reported itself
 * incomplete and a recent legacy approval was never found. The unfiltered read
 * now walks back from the head in block windows. The node here filters by key
 * position and block range and pages oldest-first, as `starknet_getEvents` does.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
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
const HEAD = 1_000_000;
const WINDOW = 200_000;
const canonical = (value: string): string => `0x${BigInt(value).toString(16)}`;

type BlockEvent = AllowanceEvent & { readonly block: number };

const cairo1 = (owner: string, spender: string, block: number): BlockEvent => ({
  block,
  data: ["0x64", "0x0"],
  keys: [APPROVAL_EVENT_KEY, owner, spender],
});
const legacy = (owner: string, spender: string, block: number): BlockEvent => ({
  block,
  data: [owner, spender, "0x64", "0x0"],
  keys: [APPROVAL_EVENT_KEY],
});
// `count` approvals by strangers, one per block from `firstBlock`.
const strangers = (count: number, firstBlock: number, make: typeof cairo1 = legacy): BlockEvent[] =>
  Array.from({ length: count }, (_, index) =>
    make(
      `0x${(0x9000 + index).toString(16)}`,
      `0x${(0x5000 + index).toString(16)}`,
      firstBlock + index,
    ),
  );

const matchesKeys = (event: AllowanceEvent, keys: readonly string[][]): boolean =>
  keys.every(
    (group, position) =>
      group.length === 0 ||
      (event.keys[position] !== undefined &&
        group.some((key) => BigInt(key) === BigInt(event.keys[position] ?? "0x0"))),
  );

const node = (log: readonly BlockEvent[], failRanges = false) => {
  const filters: AllowanceEventFilter[] = [];
  const rpc: AllowanceRpc = {
    async callContract(call) {
      const spender = canonical(String((call.calldata as string[])[1]));
      return spender === canonical(DRAINER) ? [UNLIMITED_LOW, "0x0"] : ["0x0", "0x0"];
    },
    async getEvents(filter) {
      filters.push(filter);
      if (failRanges && filter.to_block !== undefined) {
        throw new WalletError("block range not served");
      }
      const matching = log.filter(
        (event) =>
          matchesKeys(event, filter.keys) &&
          event.block >= (filter.from_block ?? 0) &&
          event.block <= (filter.to_block ?? HEAD),
      );
      const start = Number(filter.continuation_token ?? "0");
      const end = start + filter.chunk_size;
      return {
        events: matching.slice(start, end),
        ...(end < matching.length ? { continuation_token: String(end) } : {}),
      };
    },
    async getLatestBlockNumber() {
      return HEAD;
    },
  };
  return { filters, rpc };
};

const scan = (rpc: AllowanceRpc) =>
  collectExternalAllowances(rpc, { owner: OWNER, tokens: [TOKEN] });

describe("legacy approvals read back from the head", () => {
  test("Cairo 0 approvals before an upgrade no longer mark every scan incomplete", async () => {
    // The ETH shape: 600 Cairo 0 approvals open the log, and the token has
    // emitted the Cairo 1 layout ever since.
    const { filters, rpc } = node([
      ...strangers(600, 0),
      ...strangers(400, HEAD - 50_000, cairo1),
      cairo1(OWNER, DRAINER, HEAD - 10),
    ]);

    const found = await scan(rpc);

    expect(found.allowances.map((entry) => entry.spender)).toEqual([canonical(DRAINER)]);
    expect(found.complete).toBe(true);
    // The unfiltered read covered the newest window only, never block 0.
    const unfiltered = filters.filter((filter) => filter.keys.length === 1);
    expect(unfiltered.map((filter) => filter.from_block)).toEqual(
      unfiltered.map(() => HEAD - WINDOW + 1),
    );
  });

  test("finds a recent legacy approval behind 600 older ones", async () => {
    const { rpc } = node([...strangers(600, 0), legacy(OWNER, DRAINER, HEAD - 10)]);

    const found = await scan(rpc);

    expect(found.allowances.map((entry) => entry.spender)).toEqual([canonical(DRAINER)]);
    // The windows held one legacy event each; the rest of the log, read from
    // block 0, ran out of pages on legacy events: older approvals went unread.
    expect(found.complete).toBe(false);
  });

  test("reads a quiet legacy token to its first block", async () => {
    const { rpc } = node([legacy(OWNER, DRAINER, 5), ...strangers(20, 100)]);

    const found = await scan(rpc);

    expect(found.allowances.map((entry) => entry.spender)).toEqual([canonical(DRAINER)]);
    expect(found.complete).toBe(true);
  });

  test("is incomplete when a recent window holds more legacy events than the budget", async () => {
    const { rpc } = node(strangers(400, HEAD - 1_000));

    expect((await scan(rpc)).complete).toBe(false);
  });

  test("is incomplete when a window read fails", async () => {
    const { rpc } = node([cairo1(OWNER, DRAINER, HEAD - 10)], true);

    const found = await scan(rpc);

    expect(found).toEqual({ allowances: [], complete: false });
  });
});
