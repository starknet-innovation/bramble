/**
 * Value at submission (mc-wallet issue 480): a public send this wallet records
 * carries the unit price the wallet's cache held, fresh, at that moment. A
 * stale, missing or failing price leaves the row unpriced, and no other kind
 * of row (private, discovered, inbound, non-transfer) is ever priced.
 */
import { describe, expect, test } from "bun:test";
import type { PriceService, TokenPriceInput, TokenPrices } from "@bramble/portfolio/prices";
import { createMemoryStore } from "@bramble/store/kv";
import {
  type ActivityEntry,
  createActivityLog,
  type NewActivityEntry,
} from "@bramble/transactions/activity";
import { canonicalFelt, STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { withSubmittedPrice } from "../../../apps/extension/src/background/transactions/activity-valuation";

// Activity stores token addresses canonically, as every writer records them.
const STRK = canonicalFelt(STRK_TOKEN_ADDRESS) ?? STRK_TOKEN_ADDRESS;
const ACCOUNT = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const send: NewActivityEntry = {
  accountId: ACCOUNT,
  amount: "2.5",
  counterparty: "0x777",
  direction: "out",
  hash: "0xabc",
  kind: "transfer",
  networkId: "SN_MAIN",
  origin: "wallet",
  summary: "Send 2.5 STRK",
  token: "STRK",
  tokenAddress: STRK,
};

const answer = (overrides: Partial<TokenPrices> = {}): TokenPrices => ({
  asOf: 1_700_000_000_000,
  changes: {},
  currency: "eur",
  prices: { [STRK]: 0.12 },
  stale: false,
  ...overrides,
});

const harness = (
  reply: (input: TokenPriceInput) => Promise<TokenPrices>,
  options: {
    readonly readPreferences?: () => Promise<{ readonly displayCurrency?: "eur" }>;
    readonly wait?: (ms: number) => Promise<void>;
  } = {},
) => {
  const asked: TokenPriceInput[] = [];
  const prices: PriceService = {
    getPrices: (input) => {
      asked.push(input);
      return reply(input);
    },
    getTokenChart: () => Promise.reject(new Error("not used")),
  };
  const log = withSubmittedPrice(createActivityLog({ store: createMemoryStore() }), {
    prices: () => prices,
    readPreferences: options.readPreferences ?? (() => Promise.resolve({ displayCurrency: "eur" })),
    ...(options.wait ? { wait: options.wait } : {}),
  });
  const only = async (): Promise<ActivityEntry | undefined> => (await log.list())[0];
  return { asked, log, only };
};

describe("value at submission", () => {
  test("records the fresh cached unit price on a public send", async () => {
    const { asked, log, only } = harness(() => Promise.resolve(answer()));

    await log.record(send);

    expect((await only())?.submittedPrice).toEqual({
      currency: "eur",
      pricedAt: 1_700_000_000_000,
      unitPrice: 0.12,
    });
    // Cache only: recording a send never reaches the price feed.
    expect(asked).toEqual([
      { addresses: [STRK], cached: true, currency: "eur", networkId: "SN_MAIN" },
    ]);
  });

  test("prices a send written through recordIfAbsent too", async () => {
    const { log, only } = harness(() => Promise.resolve(answer()));

    expect(await log.recordIfAbsent(send)).toBe(true);
    expect((await only())?.submittedPrice?.unitPrice).toBe(0.12);
  });

  test("leaves the row unpriced when the price is stale, undated, missing or failing", async () => {
    for (const reply of [
      () => Promise.resolve(answer({ stale: true })),
      () => Promise.resolve(answer({ asOf: null })),
      () => Promise.resolve(answer({ prices: {} })),
      () => Promise.resolve(answer({ prices: { [STRK]: 0 } })),
      () => Promise.reject(new Error("storage unavailable")),
    ]) {
      const { log, only } = harness(reply);
      await log.record(send);
      const row = await only();
      expect(row?.hash).toBe("0xabc");
      expect(row?.submittedPrice).toBeUndefined();
    }
  });

  test("records the row unpriced when a price read never answers", async () => {
    const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
    for (const options of [
      { readPreferences: never, wait: () => Promise.resolve() },
      { wait: () => Promise.resolve() },
    ]) {
      const { log, only } = harness(never, options);
      await log.record(send);
      expect((await only())?.submittedPrice).toBeUndefined();
      expect(await log.recordIfAbsent({ ...send, hash: "0xdef" })).toBe(true);
    }
  });

  test("never prices a row that is not a public send this wallet made", async () => {
    const { tokenAddress: _address, ...noAddress } = send;
    const { origin: _origin, ...discovered } = send;
    for (const entry of [
      { ...send, kind: "invoke" as const },
      { ...send, direction: "in" as const },
      discovered,
      { ...send, amount: "all" },
      noAddress,
    ]) {
      const { asked, log, only } = harness(() => Promise.resolve(answer()));
      await log.record(entry);
      expect((await only())?.submittedPrice).toBeUndefined();
      expect(asked).toEqual([]);
    }
  });
});
