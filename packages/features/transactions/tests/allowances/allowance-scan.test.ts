/**
 * External-allowance scanning: paging a token's `Approval` events to find the
 * spenders an owner approved, reading each spender's live allowance, filtering
 * by owner and zero amounts, and isolating per-token failures.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { APPROVAL_EVENT_KEY } from "@bramble/transactions/allowance-discovery";
import {
  type AllowanceEvent,
  type AllowanceEventFilter,
  type AllowanceRpc,
  collectExternalAllowances,
  scanExternalAllowances,
} from "@bramble/transactions/allowance-scan";
import type { Call } from "starknet";

const OWNER = "0x1234567890abcdef";
const OTHER_OWNER = "0x9999";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x05abcdef";
const ZERO_SPENDER = "0x07feed";
const LEGACY_SPENDER = "0x09aa";
const canonical = (value: string): string => `0x${BigInt(value).toString(16)}`;

const ozEvent = (owner: string, spender: string): AllowanceEvent => ({
  data: ["0x64", "0x0"],
  keys: [APPROVAL_EVENT_KEY, owner, spender],
});
const legacyEvent = (owner: string, spender: string): AllowanceEvent => ({
  data: [owner, spender, "0x64", "0x0"],
  keys: [APPROVAL_EVENT_KEY],
});

// Live allowance amounts keyed by the canonical spender felt; anything unlisted
// reads as zero (an approval later revoked elsewhere).
const AMOUNTS: Record<string, [string, string]> = {
  [canonical(SPENDER)]: ["0x3e8", "0x0"],
  [canonical(LEGACY_SPENDER)]: ["0x0", "0x1"],
  [canonical(ZERO_SPENDER)]: ["0x0", "0x0"],
};

const makeRpc = (pages: readonly (readonly AllowanceEvent[])[]): AllowanceRpc => ({
  async callContract(call: Call) {
    const spender = canonical(String((call.calldata as string[])[1]));
    return AMOUNTS[spender] ?? ["0x0", "0x0"];
  },
  async getEvents(filter: AllowanceEventFilter) {
    const page = Number(filter.continuation_token ?? "0");
    const events = pages[page] ?? [];
    return page + 1 < pages.length ? { continuation_token: String(page + 1), events } : { events };
  },
});

describe("collectExternalAllowances", () => {
  test("discovers spenders across pages, reads live amounts, and filters owner and zero", async () => {
    const rpc = makeRpc([
      [ozEvent(OWNER, SPENDER), ozEvent(OWNER, ZERO_SPENDER), ozEvent(OTHER_OWNER, SPENDER)],
      [legacyEvent(OWNER, LEGACY_SPENDER)],
    ]);

    const found = await collectExternalAllowances(rpc, { owner: OWNER, tokens: [TOKEN] });

    expect(found).toEqual([
      { amount: "1000", spender: canonical(SPENDER), token: canonical(TOKEN) },
      {
        amount: (1n << 128n).toString(),
        spender: canonical(LEGACY_SPENDER),
        token: canonical(TOKEN),
      },
    ]);
  });

  test("skips a token whose event query fails without a transport error", async () => {
    const rpc: AllowanceRpc = {
      async callContract() {
        return ["0x3e8", "0x0"];
      },
      async getEvents() {
        throw new WalletError("contract has no Approval events");
      },
    };
    expect(await collectExternalAllowances(rpc, { owner: OWNER, tokens: [TOKEN] })).toEqual([]);
  });

  test("returns nothing for an invalid owner", async () => {
    const rpc = makeRpc([[ozEvent(OWNER, SPENDER)]]);
    expect(await collectExternalAllowances(rpc, { owner: "0x0", tokens: [TOKEN] })).toEqual([]);
  });
});

describe("scanExternalAllowances", () => {
  test("short-circuits to an empty list when no tokens are tracked", async () => {
    expect(await scanExternalAllowances({ owner: OWNER, rpcUrls: [], tokens: [] })).toEqual([]);
  });
});
