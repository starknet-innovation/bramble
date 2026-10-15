/**
 * The token address an activity row records beside its symbol (issue 643). The
 * activity log is an unversioned plain store whose policy is "discard invalid
 * rows" (docs/WALLET_STORE.md), so the field is optional: rows persisted before
 * it existed must keep loading, a well-formed current row must round-trip, and
 * a malformed address must cost only that row. The writers' shared spelling
 * (`activityToken`) and the on-chain lane must actually record it, and two
 * same-symbol legs of one transaction must not collapse into one.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import {
  type ActivityEntry,
  activityToken,
  createActivityLog,
  isActivityEntry,
} from "@bramble/transactions/activity";
import { mergeActivity, onChainActivityEntry } from "@bramble/transactions/tx-history";
import type { TokenConfig } from "@bramble/wallet-model/preferences";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const USDC_A = "0xa11ce";
const USDC_B = "0xb0b";

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  accountId: ACCOUNT_ID,
  amount: "1",
  hash: "0x1",
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: 1,
  summary: "Send 1 USDC",
  token: "USDC",
  ...overrides,
});

const usdc = (address: string): TokenConfig => ({
  address,
  decimals: 6,
  id: `SN_MAIN:USDC:${address}`,
  name: "USD Coin",
  networkId: "SN_MAIN",
  symbol: "USDC",
});

const persisted = async (rows: readonly unknown[]): Promise<readonly ActivityEntry[]> => {
  const store = createMemoryStore();
  await store.set("bramble:activity", rows as never);
  return createActivityLog({ now: () => 5, store }).list();
};

describe("activity token address: stored data", () => {
  test("a legacy row without an address still loads unchanged", async () => {
    const legacy = row();
    expect(isActivityEntry(legacy)).toBe(true);
    expect(await persisted([legacy])).toEqual([legacy as ActivityEntry]);
  });

  test("a current row with a canonical address round-trips", async () => {
    const current = row({ tokenAddress: USDC_A });
    expect(isActivityEntry(current)).toBe(true);
    expect((await persisted([current]))[0]?.tokenAddress).toBe(USDC_A);
  });

  test.each([
    ["a zero-padded spelling", "0x000a11ce"],
    ["an uppercase spelling", "0xA11CE"],
    ["the zero felt", "0x0"],
    ["a non-felt", "usdc"],
    ["a number", 42],
    ["an address past the field prime", `0x${"f".repeat(64)}`],
  ])("drops a row whose address is %s, keeping its neighbours", async (_name, tokenAddress) => {
    const bad = row({ hash: "0x2", tokenAddress });
    expect(isActivityEntry(bad)).toBe(false);
    expect((await persisted([row(), bad])).map((entry) => entry.hash)).toEqual(["0x1"]);
  });

  test("refuses an address with no symbol to qualify", () => {
    const { token: _symbol, ...withoutSymbol } = row({ tokenAddress: USDC_A });
    expect(isActivityEntry(withoutSymbol)).toBe(false);
  });
});

describe("activity token address: writers", () => {
  test("activityToken records the canonical address beside the symbol", () => {
    expect(activityToken({ address: "0x000A11CE", symbol: "USDC" })).toEqual({
      token: "USDC",
      tokenAddress: USDC_A,
    });
    // An address that is no felt is left out rather than recorded unusable.
    expect(activityToken({ address: "nope", symbol: "USDC" })).toEqual({ token: "USDC" });
    expect(activityToken({ address: "0x0", symbol: "USDC" })).toEqual({ token: "USDC" });
  });

  test("record() keeps the address a writer passes", async () => {
    const log = createActivityLog({ now: () => 5, store: createMemoryStore() });
    await log.record({
      accountId: ACCOUNT_ID,
      hash: "0x9",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send 1 USDC",
      ...activityToken(usdc(USDC_B)),
    });
    expect((await log.list())[0]?.tokenAddress).toBe(USDC_B);
  });

  test("a chain-discovered row records the token's address", () => {
    const entry = onChainActivityEntry({
      accountId: ACCOUNT_ID,
      decoded: {
        amountRaw: "1000000",
        blockNumber: 1,
        counterparty: "0x777",
        direction: "in",
        hash: "0xabc",
      },
      networkId: "SN_MAIN",
      timestampMs: 1,
      token: usdc(USDC_A),
    });
    expect(entry.tokenAddress).toBe(USDC_A);
    expect(isActivityEntry(entry)).toBe(true);
  });

  test("two same-symbol legs of one transaction stay two rows", () => {
    const leg = (tokenAddress: string): ActivityEntry =>
      row({ counterparty: "0x777", hash: "0xabc", tokenAddress }) as ActivityEntry;
    const merged = mergeActivity([], [leg(USDC_A), leg(USDC_B)]);
    expect(merged.map((entry) => entry.tokenAddress).sort()).toEqual([USDC_A, USDC_B]);
  });
});
