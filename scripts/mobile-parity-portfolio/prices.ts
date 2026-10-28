/**
 * Price, chart, number and fiat parity blocks: the extension's real `createPriceService` driven
 * through scripted CoinGecko answers and a scripted clock, the real `formatFiat` /
 * `compactAmount` / `tokenFiatValue`, and the real Home hero and token-row renderers.
 */
import { HTTP_BODY_LIMITS, HTTP_REQUEST_TIMEOUT_MS } from "@bramble/core/http-json";
import { createPriceService, PRICE_CHART_POINT_LIMIT } from "@bramble/portfolio/prices";
import type { DisplayCurrency } from "@bramble/settings/preferences";
import { RPC_BODY_LIMIT_BYTES, RPC_REQUEST_TIMEOUT_MS } from "@bramble/starknet/rpc-transport";
import { createMemoryStore } from "@bramble/store/kv";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { homeScreen } from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/home-view";
import {
  balanceRow,
  compactAmount,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/token-row";
import {
  formatFiat,
  tokenFiatValue,
} from "../../packages/presentation/wallet-ui/src/sidepanel/shared/fiat";
import { firstMatch, type ScriptedAnswer, scriptedClock, scriptedFetch } from "./shared";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const UNPRICED = "0x0000000000000000000000000000000000000000000000000000000000001234";

const entry = (usd: number, change?: number): string =>
  `{"usd":${usd},"eur":${usd * 0.9},"gbp":${usd * 0.8}${change === undefined ? "" : `,"usd_24h_change":${change}`}}`;
const body = (address: string, value: string): string => `{"${address}":${value}}`;

/** Bounds the core restates, each pinned to the TypeScript constant. */
export const limitsBlock = () => ({
  chartPoints: PRICE_CHART_POINT_LIMIT,
  httpTimeout: HTTP_REQUEST_TIMEOUT_MS,
  price: HTTP_BODY_LIMITS.price,
  rpcBody: RPC_BODY_LIMIT_BYTES,
  rpcTimeout: RPC_REQUEST_TIMEOUT_MS,
  starkscan: HTTP_BODY_LIMITS.starkscan,
});

const show = (value: number): string => String(value);

/** JavaScript number semantics the core reproduces. */
export const numbersBlock = () => ({
  fixed: [
    0, 0.125, 1.005, 2.675, 0.005, -0.001, 1e21, 123.456, 99.995, 5e-7, 1.45, 8.345, 1234.5678,
  ].map((value) => ({ out: value.toFixed(2), value })),
  locale: [
    0.01, 0.125, 1.005, 2.675, 999.995, 1234567.895, 1e21, 1.23e25, 0.015, 10.005,
    5030.000845459129, 7.1e-3,
  ].map((value) => ({
    out: value.toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      useGrouping: true,
    }),
    value,
  })),
  number: [
    "12.5",
    " 12 ",
    "",
    ".5",
    "5.",
    "0x10",
    "1e3",
    "-Infinity",
    "Infinity",
    "1,000",
    "abc",
    "0b11",
    "-0x1",
    "1e",
    "+.5",
    "0.1e-2",
  ].map((input) => ({ input, out: show(Number(input)) })),
  string: [0.1 + 0.2, 1e21, 123.45, 5e-7, 1e-6, -0, 1.5e300, 100, 33.33, 0.01, 2 ** 53].map(
    (value) => ({
      out: String(value),
      value,
    }),
  ),
});

const CURRENCIES: readonly DisplayCurrency[] = ["usd", "eur", "gbp"];

const heroOf = (
  balances: readonly { address: string; formatted: string; id: string; symbol: string }[],
  prices: Record<string, number>,
  changes: Record<string, number>,
  currency: DisplayCurrency,
) => {
  const html = homeScreen(
    { network: "Starknet Mainnet", networkId: "SN_MAIN" } as never,
    { address: "0x1", id: "SN_MAIN:0x1" } as never,
    {
      balances: balances.map((b) => ({
        ...b,
        balance: "1",
        decimals: 18,
        name: b.symbol,
        networkId: "SN_MAIN",
      })),
    } as never,
    0,
    true,
    null,
    prices,
    changes,
    currency,
    { error: null, loading: false, value: null },
  );
  return {
    amount: firstMatch(html, /<span class="hero-change-amt">([^<]*)<\/span>/),
    down: html.includes('class="hero-change down"'),
    total: firstMatch(html, /<p class="hero-total"[^>]*>([^<]*)<\/p>/),
    window: firstMatch(html, /<span class="hero-change-win">([^<]*)<\/span>/),
  };
};

/** Fiat formatting, amounts, the Home hero and token rows. */
export const fiatBlock = () => {
  const strk = { address: STRK, formatted: "1234.5", id: `SN_MAIN:STRK:${STRK}`, symbol: "STRK" };
  const eth = { address: ETH, formatted: "0.25", id: `SN_MAIN:ETH:${ETH}`, symbol: "ETH" };
  const heroCases = [
    {
      balances: [eth, strk],
      changes: { [ETH]: 2.5, [STRK]: -1.25 },
      currency: "usd" as const,
      prices: { [ETH]: 2500.5, [STRK]: 0.125 },
    },
    {
      balances: [eth, strk],
      changes: {},
      currency: "eur" as const,
      prices: { [ETH]: 1.005, [STRK]: 2.675 },
    },
    {
      balances: [strk],
      changes: { [STRK]: -150 },
      currency: "gbp" as const,
      prices: { [STRK]: 0.5 },
    },
    { balances: [strk], changes: { [STRK]: 0 }, currency: "usd" as const, prices: { [STRK]: 0.4 } },
    { balances: [eth], changes: {}, currency: "usd" as const, prices: {} },
    {
      balances: [eth, strk],
      changes: { [ETH]: -3 },
      currency: "usd" as const,
      prices: { [ETH]: 1000 },
    },
  ];
  return {
    compact: [
      ["1234567.891", 2],
      ["1", 2],
      ["0.5", 2],
      ["0.00001234", 2],
      ["0.000000001", null],
      ["12.300", null],
      ["0.000", null],
      ["1234.56789", 4],
      ["0", 2],
      ["1000000", null],
      ["0.1234567", 4],
      ["-0.5", 2],
      ["abc.def", 2],
      ["12.3.4", null],
    ].map(([value, places]) => ({
      out:
        places === null
          ? compactAmount(String(value))
          : compactAmount(String(value), Number(places)),
      places,
      value,
    })),
    format: [0, -1, 0.004, 0.005, 0.01, 0.125, 1.005, 2.675, 1234.5, 1e6, 1e21, 999.995].flatMap(
      (value) =>
        CURRENCIES.map((currency) => ({ currency, out: formatFiat(value, currency), value })),
    ),
    hero: heroCases.map((c) => ({
      ...c,
      out: heroOf(c.balances, c.prices, c.changes, c.currency),
    })),
    rows: [
      { change: 3.456, price: 0.125 },
      { change: -0.004, price: 2 },
      { change: 0, price: undefined },
      { change: undefined, price: 1.005 },
    ].map(({ change, price }) => {
      const html = balanceRow(
        { ...strk, balance: "1", decimals: 18, name: "Starknet Token", networkId: "SN_MAIN" },
        price,
        change,
        "usd",
      );
      return {
        // The badge's whole text, its quiet window tag included (`<span>` nested inside).
        badge:
          firstMatch(html, /<span class="token-change [a-z]+">(.*?)<\/span><\/span>/)?.replace(
            /<[^>]*>/g,
            "",
          ) ?? firstMatch(html, /<span class="token-change [a-z]+">([^<]*)<\/span>/),
        change: change ?? null,
        price: price ?? null,
        up: html.includes('class="token-change up"'),
        value: firstMatch(html, /<span class="token-amount"[^>]*>([^<]*)<\/span>/),
      };
    }),
    value: [
      ["1.5", 2],
      ["", 3],
      [" ", 3],
      ["abc", 3],
      ["0.000001", 12345.678],
      ["1e3", 2],
      ["12", null],
      ["5030.000845459129", 1],
    ].map(([formatted, price]) => ({
      formatted,
      out: tokenFiatValue(String(formatted), price === null ? undefined : Number(price)),
      price,
    })),
  };
};

type PriceStep = {
  readonly addresses: readonly string[];
  readonly answers: Readonly<Record<string, ScriptedAnswer>>;
  readonly cached?: true;
  readonly currency: DisplayCurrency;
  readonly networkId: StarknetNetworkId;
  readonly now: number;
};

const runPriceTimeline = async (steps: readonly PriceStep[]) => {
  const clock = scriptedClock(0);
  let answers: Readonly<Record<string, ScriptedAnswer>> = {};
  const seen: string[] = [];
  const http = scriptedFetch((url) => {
    const address = decodeURIComponent(new URL(url).searchParams.get("contract_addresses") ?? "");
    return answers[address] ?? null;
  }, seen);
  const service = createPriceService({ http, now: clock.read, store: createMemoryStore() });
  const outputs = [];
  for (const step of steps) {
    clock.now = step.now;
    answers = step.answers;
    seen.length = 0;
    const result = await service.getPrices({
      addresses: step.addresses,
      ...(step.cached ? { cached: true as const } : {}),
      currency: step.currency,
      networkId: step.networkId,
    });
    outputs.push({ ...step, out: { ...result, urls: [...seen] } });
  }
  return outputs;
};

const ok = (address: string, value: string): Record<string, ScriptedAnswer> => ({
  [address]: { body: body(address, value), status: 200 },
});

/** CoinGecko body judging and the `getPrices` cache timelines. */
export const pricesBlock = async () => {
  // `pad`: trailing spaces appended to the body when it is served (kept out of the fixture text).
  const bodies: { name: string; address: string; answer: ScriptedAnswer; pad?: number }[] = [
    { address: STRK, answer: { body: body(STRK, entry(0.5, 2.5)), status: 200 }, name: "valid" },
    {
      address: STRK,
      answer: { body: body(STRK, '{"usd":1,"eur":1}'), status: 200 },
      name: "missing gbp",
    },
    {
      address: STRK,
      answer: {
        body: body(STRK, '{"usd":"1","eur":1,"gbp":1,"usd_24h_change":null}'),
        status: 200,
      },
      name: "string price",
    },
    {
      address: STRK,
      answer: { body: body(STRK, '{"usd":1e400,"eur":1,"gbp":1,"usd_24h_change":4}'), status: 200 },
      name: "huge exponent",
    },
    {
      address: STRK,
      answer: { body: `{"${ETH}":${entry(9)},"${STRK}":${entry(1)}}`, status: 200 },
      name: "injected second address",
    },
    {
      address: STRK,
      answer: {
        body: body(
          "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
          entry(0.7, -1),
        ),
        status: 200,
      },
      name: "non-canonical key",
    },
    {
      address: STRK,
      answer: { body: body(STRK.toUpperCase().replace("0X", "0x"), entry(0.8)), status: 200 },
      name: "upper-case key",
    },
    {
      address: STRK,
      answer: { body: body(STRK, '{"usd":5030.00084545912909691,"eur":1,"gbp":1}'), status: 200 },
      name: "serde mis-rounds this literal",
    },
    { address: STRK, answer: { body: "{}", status: 200 }, name: "empty object" },
    { address: STRK, answer: { body: "[1,2]", status: 200 }, name: "array body" },
    { address: STRK, answer: { body: "not json", status: 200 }, name: "not json" },
    { address: STRK, answer: { body: body(STRK, entry(1)), status: 500 }, name: "server error" },
    { address: STRK, answer: null, name: "transport" },
    {
      address: STRK,
      answer: { body: body(STRK, entry(1)), status: 200 },
      name: "over budget",
      pad: HTTP_BODY_LIMITS.price,
    },
    {
      address: STRK,
      answer: { body: `{"${STRK}":${entry(1)},"${STRK}":${entry(2, 7)}}`, status: 200 },
      name: "duplicate key",
    },
  ];
  const bodyCases = [];
  for (const c of bodies) {
    const served =
      c.answer === null ? null : { ...c.answer, body: c.answer.body + " ".repeat(c.pad ?? 0) };
    const [usd, eur, gbp] = await runPriceTimeline(
      CURRENCIES.map((currency) => ({
        addresses: [c.address],
        answers: { [c.address]: served },
        currency,
        networkId: "SN_MAIN" as const,
        now: 1_000,
      })),
    );
    bodyCases.push({ ...c, out: { eur: eur?.out, gbp: gbp?.out, usd: usd?.out } });
  }
  const t0 = 1_000;
  const fresh = { ...ok(STRK, entry(0.5, 2)), ...ok(ETH, entry(2500, -1)) };
  const plans = {
    backoff: await runPriceTimeline([
      { addresses: [STRK, ETH], answers: fresh, currency: "usd", networkId: "SN_MAIN", now: t0 },
      {
        addresses: [STRK, ETH],
        answers: {},
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0 + 1_000,
      },
      {
        addresses: [STRK, ETH],
        answers: { ...ok(STRK, entry(0.6, 3)), [ETH]: { body: "{}", status: 500 } },
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0 + 300_000,
      },
      {
        addresses: [STRK, ETH],
        answers: {},
        currency: "eur",
        networkId: "SN_MAIN",
        now: t0 + 301_000,
      },
      {
        addresses: [STRK, ETH],
        answers: {},
        cached: true,
        currency: "gbp",
        networkId: "SN_MAIN",
        now: t0 + 1_000_000,
      },
      {
        addresses: [STRK, ETH],
        answers: {},
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0 + 1_000_000,
      },
      {
        addresses: [STRK, ETH],
        answers: fresh,
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0 + 1_030_000,
      },
      {
        addresses: [STRK, ETH],
        answers: fresh,
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0 + 1_070_000,
      },
    ]),
    // b78b0507: once the feed answers an address without a usable price ({} or one currency), its
    // cached price and change are dropped rather than freshened by the new refresh time.
    dropped: await runPriceTimeline([
      { addresses: [STRK, ETH], answers: fresh, currency: "usd", networkId: "SN_MAIN", now: t0 },
      {
        addresses: [STRK, ETH],
        answers: {
          [STRK]: { body: "{}", status: 200 },
          [ETH]: { body: body(ETH, '{"usd":2600}'), status: 200 },
        },
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0 + 400_000,
      },
      {
        addresses: [STRK, ETH],
        answers: {},
        cached: true,
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0 + 401_000,
      },
    ]),
    checked: await runPriceTimeline([
      {
        addresses: [UNPRICED],
        answers: { [UNPRICED]: { body: "{}", status: 200 } },
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0,
      },
      {
        addresses: [UNPRICED],
        answers: {},
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0 + 10_000,
      },
    ]),
    nonMainnet: await runPriceTimeline([
      {
        addresses: [STRK],
        answers: ok(STRK, entry(0.5, 2)),
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0,
      },
      {
        addresses: [STRK, ETH],
        answers: {},
        currency: "eur",
        networkId: "SN_SEPOLIA",
        now: t0 + 10_000_000,
      },
      { addresses: [], answers: {}, currency: "usd", networkId: "SN_MAIN", now: t0 + 10_000_000 },
    ]),
    partialUncached: await runPriceTimeline([
      {
        addresses: [STRK, USDC],
        answers: { ...ok(STRK, entry(0.5)), [USDC]: null },
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0,
      },
    ]),
    spellings: await runPriceTimeline([
      {
        addresses: [
          "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
          STRK,
          ` ${STRK.toUpperCase().replace("0X", "0x")} `,
          "not-an-address",
        ],
        answers: {
          ...ok(STRK, entry(0.5, 1)),
          "not-an-address": { body: '{"not-an-address":{"usd":1,"eur":1,"gbp":1}}', status: 200 },
        },
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0,
      },
    ]),
    tooMany: await runPriceTimeline([
      {
        addresses: Array.from(
          { length: 55 },
          (_, i) => `0x${(i + 1).toString(16).padStart(64, "0")}`,
        ),
        answers: {},
        currency: "usd",
        networkId: "SN_MAIN",
        now: t0,
      },
    ]),
  };
  return { bodies: bodyCases, plans };
};
