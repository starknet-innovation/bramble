/**
 * Drives the extension's REAL swap handler for one case: `createMessageHandler` (through the
 * shared swap harness) over the real AVNU service (`createSwapService`) whose fetch answers from a
 * script, plus an optional made-up price feed. Every request the service makes is recorded as it
 * went out, and every reply is the exact text the script gave, so the core can replay both.
 */
import type { PriceService } from "@bramble/portfolio/prices";
import { createSwapService } from "@bramble/transactions/avnu";
import { DEFAULT_TRACKED_TOKENS } from "@bramble/wallet-model/networks";
import { extensionSender, makeSwapHarness } from "../../tests/support/swap-policy-harness";

/** One scripted AVNU reply: the status and the body text exactly as served. */
export type Reply = { readonly status: number; readonly body: string };

/** A reply whose body is `value` as JSON, status 200 unless given. */
export const json = (value: unknown, status = 200): Reply => ({
  body: JSON.stringify(value),
  status,
});

/** One request the AVNU service sent. */
type SentRequest = {
  readonly body: string | null;
  readonly contentType: string | null;
  readonly method: string;
  readonly url: string;
};

/** A made-up price feed answer: unit prices by symbol, and whether it came from a stale cache. */
export type Feed = { readonly prices: Readonly<Record<string, number>>; readonly stale: boolean };

/** The tracked mainnet tokens the harness's wallet starts with, by symbol. */
export const TOKENS = DEFAULT_TRACKED_TOKENS.filter((token) => token.networkId === "SN_MAIN");

const token = (symbol: string) => {
  const found = TOKENS.find((candidate) => candidate.symbol === symbol);
  if (!found) throw new Error(`no tracked mainnet ${symbol}`);
  return found;
};

/** The registry id the panel names a tracked token by. */
export const tokenId = (symbol: string): string => `SN_MAIN:${symbol}:${token(symbol).address}`;

const scriptedFetch = (replies: readonly Reply[], sent: SentRequest[]) => {
  let next = 0;
  return async (url: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers);
    sent.push({
      body: typeof init.body === "string" ? init.body : null,
      contentType: headers.get("content-type"),
      method: init.method ?? "GET",
      url,
    });
    const reply = replies[next];
    next += 1;
    if (!reply) throw new Error("the script has no reply for this request");
    return new Response(reply.body, { status: reply.status });
  };
};

const priceService = (feed: Feed): PriceService => ({
  async getPrices(input) {
    return {
      asOf: 0,
      changes: {},
      currency: input.currency,
      prices: Object.fromEntries(
        Object.entries(feed.prices).map(([symbol, price]) => [token(symbol).address, price]),
      ),
      stale: feed.stale,
    };
  },
  getTokenChart: () => Promise.reject(new Error("no chart in the parity feed")),
});

/** The pair and amount a case asks to swap, as the panel sends them. */
export type SwapAsk = {
  readonly amount: string;
  readonly buy: string;
  readonly sell: string;
};

/** A harness for `replies` (and `feed`), recording what the AVNU service sent. */
export const swapHarness = (replies: readonly Reply[], feed?: Feed) => {
  const sent: SentRequest[] = [];
  const swap = createSwapService({ http: scriptedFetch(replies, sent) });
  const harness = makeSwapHarness([], undefined, {
    ...(feed ? { prices: priceService(feed) } : {}),
    swap,
  });
  const send = (message: object) => harness.handler(message, extensionSender);
  return { ...harness, send, sent };
};

/** The quote message for `ask`. */
export const quoteMessage = (ask: SwapAsk) => ({
  amount: ask.amount,
  buyTokenId: tokenId(ask.buy),
  sellTokenId: tokenId(ask.sell),
  type: "wallet.swapQuote",
});
