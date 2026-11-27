/**
 * The quote block: `wallet.swapQuote` through the real handler. Each case records the pair and
 * amount asked, the price feed (if any), AVNU's scripted replies, the GET the service sent, and
 * the handler's answer: the quote the panel shows (with the wallet's own value check) or the
 * refusal.
 */
import { parseTokenAmount } from "@bramble/starknet/rpc";
import {
  type Feed,
  json,
  quoteMessage,
  type Reply,
  type SwapAsk,
  swapHarness,
  TOKENS,
} from "./run";

/** The quote id every scripted quote carries unless a case is about the id. */
const QUOTE_ID = "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca";

const address = (symbol: string): string =>
  TOKENS.find((token) => token.symbol === symbol)?.address ?? "";
const decimals = (symbol: string): number =>
  TOKENS.find((token) => token.symbol === symbol)?.decimals ?? 18;

/** `amount` of `symbol` in base units, as `0x` hex. */
const units = (symbol: string, amount: string): string =>
  `0x${parseTokenAmount(amount, decimals(symbol)).toString(16)}`;

/** An honest quote object for `ask` buying `buyAmount`, with `overrides` applied. */
const quoteFor = (
  ask: SwapAsk,
  buyAmount: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  buyAmount: units(ask.buy, buyAmount),
  buyAmountInUsd: 18.8,
  buyTokenAddress: address(ask.buy),
  gasFeesInUsd: 0.025,
  quoteId: QUOTE_ID,
  sellAmount: units(ask.sell, ask.amount.trim()),
  sellAmountInUsd: 18.79,
  sellTokenAddress: address(ask.sell),
  ...overrides,
});

/** AVNU's quotes reply: the list with one honest quote, `overrides` applied. */
export const quoteReply = (
  ask: SwapAsk,
  buyAmount: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Reply => json([quoteFor(ask, buyAmount, overrides)]);

type QuoteCase = {
  readonly name: string;
  readonly ask: SwapAsk;
  readonly feed?: Feed;
  readonly replies: readonly Reply[];
};

const ETH_STRK: SwapAsk = { amount: "0.01", buy: "STRK", sell: "ETH" };
const STRK_USDC: SwapAsk = { amount: "25", buy: "USDC", sell: "STRK" };
const honest = quoteReply(ETH_STRK, "12.5");
const malformed = (name: string, overrides: Readonly<Record<string, unknown>>): QuoteCase => ({
  ask: ETH_STRK,
  name,
  replies: [quoteReply(ETH_STRK, "12.5", overrides)],
});

const CASES: readonly QuoteCase[] = [
  { ask: ETH_STRK, name: "an honest quote, no price feed", replies: [honest] },
  {
    ask: ETH_STRK,
    feed: { prices: { ETH: 1879, STRK: 1.504 }, stale: false },
    name: "an honest quote with the wallet's value check",
    replies: [honest],
  },
  {
    ask: ETH_STRK,
    feed: { prices: { ETH: 1879, STRK: 1.2 }, stale: false },
    name: "the value check shows a loss the aggregator's figures hide",
    replies: [honest],
  },
  {
    ask: ETH_STRK,
    feed: { prices: { ETH: 1879, STRK: 1.504 }, stale: true },
    name: "a stale feed gives no value check",
    replies: [honest],
  },
  {
    ask: ETH_STRK,
    feed: { prices: { ETH: 1879 }, stale: false },
    name: "no price for the buy token gives no value check",
    replies: [honest],
  },
  {
    ask: ETH_STRK,
    feed: { prices: { ETH: 0, STRK: 1.5 }, stale: false },
    name: "a zero sell price gives no value check",
    replies: [honest],
  },
  {
    ask: STRK_USDC,
    name: "a six-decimal buy token formats in its own decimals",
    replies: [quoteReply(STRK_USDC, "11.234567")],
  },
  {
    ask: { amount: " 0.01 ", buy: "STRK", sell: "ETH" },
    name: "the amount is trimmed before it is quoted",
    replies: [honest],
  },
  {
    ask: ETH_STRK,
    name: "the echoed sell amount is compared by value",
    replies: [quoteReply(ETH_STRK, "12.5", { sellAmount: "0x00002386F26FC10000" })],
  },
  {
    ask: ETH_STRK,
    name: "a quote id of 120 characters is accepted",
    replies: [quoteReply(ETH_STRK, "12.5", { quoteId: "q".repeat(120) })],
  },
  { ask: { amount: "0", buy: "STRK", sell: "ETH" }, name: "a zero amount", replies: [] },
  {
    ask: { amount: "0.0000001", buy: "STRK", sell: "USDC" },
    name: "more decimals than the sell token has",
    replies: [],
  },
  {
    ask: { amount: "1e3", buy: "STRK", sell: "ETH" },
    name: "an amount that is not decimal text",
    replies: [],
  },
  {
    ask: { amount: "1", buy: "ETH", sell: "ETH" },
    name: "the same token on both sides",
    replies: [],
  },
  { ask: ETH_STRK, name: "AVNU answers with no quote", replies: [json([])] },
  { ask: ETH_STRK, name: "AVNU answers with an object", replies: [json({ quotes: [] })] },
  { ask: ETH_STRK, name: "AVNU answers 500", replies: [json([], 500)] },
  { ask: ETH_STRK, name: "AVNU answers with text", replies: [{ body: "<html>", status: 200 }] },
  malformed("a quote with no id", { quoteId: undefined }),
  malformed("a quote with an empty id", { quoteId: "" }),
  malformed("a quote id over 120 characters", { quoteId: "q".repeat(121) }),
  malformed("a sell token that is not a felt", { sellTokenAddress: "0xnope" }),
  malformed("a buy amount that is not hex", { buyAmount: "12500000000000000000" }),
  malformed("a buy amount of 65 hex digits", { buyAmount: `0x${"1".repeat(65)}` }),
  malformed("a negative USD figure", { sellAmountInUsd: -1 }),
  malformed("a USD figure given as text", { gasFeesInUsd: "0.02" }),
  malformed("a quote for another sell token", { sellTokenAddress: address("USDC") }),
  malformed("a quote for another buy token", { buyTokenAddress: address("USDC") }),
  malformed("a quote for another amount", { sellAmount: "0x2386f26fc10001" }),
];

/** Runs every quote case through the real handler. */
export const computeQuotes = async (): Promise<readonly object[]> => {
  const out: object[] = [];
  for (const item of CASES) {
    const harness = swapHarness(item.replies, item.feed);
    const response = await harness.send(quoteMessage(item.ask));
    out.push({ ...item, requests: harness.sent, response });
  }
  return out;
};
