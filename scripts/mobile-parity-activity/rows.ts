/**
 * The row blocks of the activity fixture: `record` (stored rows `isActivityEntry` accepts or
 * refuses), `capture` (what `withSubmittedPrice` prices as the send path records a row) and
 * `fact` (the "Network fee" and "Value at submission" text the expanded row shows).
 */
import type { PriceService } from "@bramble/portfolio/prices";
import {
  type ActivityEntry,
  isActivityEntry,
  memoryActivityLog,
  type NewActivityEntry,
} from "@bramble/transactions/activity";
import { withSubmittedPrice } from "../../apps/extension/src/background/transactions/activity-valuation";
// Not a package export: the expanded row is a side-panel renderer, read here only to pin the port.
import {
  activityFeeText,
  activityRecordFacts,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/activity-detail";
import { LARGEST_FELT, ONE_HUNDREDTH, type Overrides, STRK, SUBMITTED_AT, stored } from "./shared";

const PRICE = { currency: "eur", pricedAt: SUBMITTED_AT - 10_000, unitPrice: 0.12 } as const;

const RECORDS: readonly { readonly name: string; readonly entry: unknown }[] = [
  { entry: stored(), name: "no fee or price, as every older row" },
  { entry: stored({ feePaid: { amount: ONE_HUNDREDTH, unit: "FRI" } }), name: "a STRK fee" },
  { entry: stored({ feePaid: { amount: ONE_HUNDREDTH, unit: "WEI" } }), name: "an ETH fee" },
  { entry: stored({ feePaid: { amount: "0x0", unit: "FRI" } }), name: "a zero fee" },
  {
    entry: { ...stored(), feePaid: { amount: ONE_HUNDREDTH, unit: "STRK" } },
    name: "an unknown unit",
  },
  {
    entry: { ...stored(), feePaid: { amount: "0x002386f26fc10000", unit: "FRI" } },
    name: "a padded fee",
  },
  {
    entry: { ...stored(), feePaid: { amount: "0x2386F26FC10000", unit: "FRI" } },
    name: "an upper-case fee",
  },
  {
    entry: { ...stored(), feePaid: { amount: "10000000000000000", unit: "FRI" } },
    name: "a decimal fee",
  },
  { entry: { ...stored(), feePaid: { amount: 1, unit: "FRI" } }, name: "a number fee" },
  { entry: { ...stored(), feePaid: { amount: ONE_HUNDREDTH } }, name: "a fee without a unit" },
  {
    entry: { ...stored(), feePaid: { amount: ONE_HUNDREDTH, unit: "FRI", usd: 1 } },
    name: "a fee with an extra key",
  },
  { entry: { ...stored(), feePaid: null }, name: "a null fee" },
  { entry: stored({ submittedPrice: PRICE }), name: "a price" },
  {
    entry: stored({ submittedPrice: { currency: "gbp", pricedAt: 0, unitPrice: 1e-30 } }),
    name: "a tiny price at time zero",
  },
  {
    entry: stored({
      submittedPrice: { currency: "usd", pricedAt: 8_640_000_000_000_000, unitPrice: 1e21 },
    }),
    name: "the last instant and a huge price",
  },
  {
    entry: { ...stored(), submittedPrice: { ...PRICE, currency: "jpy" } },
    name: "an unknown currency",
  },
  {
    entry: { ...stored(), submittedPrice: { ...PRICE, currency: "EUR" } },
    name: "an upper-case currency",
  },
  { entry: { ...stored(), submittedPrice: { ...PRICE, unitPrice: 0 } }, name: "a zero price" },
  {
    entry: { ...stored(), submittedPrice: { ...PRICE, unitPrice: -0.12 } },
    name: "a negative price",
  },
  { entry: { ...stored(), submittedPrice: { ...PRICE, unitPrice: "0.12" } }, name: "a text price" },
  {
    entry: { ...stored(), submittedPrice: { ...PRICE, pricedAt: 1.5 } },
    name: "a fractional time",
  },
  { entry: { ...stored(), submittedPrice: { ...PRICE, pricedAt: -1 } }, name: "a negative time" },
  {
    entry: { ...stored(), submittedPrice: { ...PRICE, pricedAt: 8_640_000_000_000_001 } },
    name: "past the last instant",
  },
  {
    entry: { ...stored(), submittedPrice: { currency: "eur", unitPrice: 0.12 } },
    name: "a price without a time",
  },
  {
    entry: { ...stored(), submittedPrice: { ...PRICE, source: "coingecko" } },
    name: "a price with an extra key",
  },
  { entry: { ...stored(), origin: "dapp" }, name: "an unknown origin" },
  { entry: stored({ origin: undefined }), name: "no origin" },
];

export const computeRecords = () =>
  RECORDS.map(({ entry, name }) => ({
    entry: JSON.parse(JSON.stringify(entry)) as unknown,
    name,
    valid: isActivityEntry(JSON.parse(JSON.stringify(entry))),
  }));

const send = (overrides: Overrides<NewActivityEntry> = {}): NewActivityEntry => {
  const { status: _s, submittedAt: _t, ...rest } = stored(overrides);
  return rest;
};

type PriceAnswer = {
  readonly asOf: number | null;
  readonly currency: "eur" | "gbp" | "usd";
  readonly prices: Readonly<Record<string, number>>;
  readonly stale: boolean;
};

const fresh = (overrides: Partial<PriceAnswer> = {}): PriceAnswer => ({
  asOf: SUBMITTED_AT - 10_000,
  currency: "usd",
  prices: { [STRK]: 0.12 },
  stale: false,
  ...overrides,
});

const CAPTURE_CASES: readonly {
  readonly name: string;
  readonly entry: NewActivityEntry;
  readonly displayCurrency?: "eur" | "gbp" | "usd";
  readonly answer: PriceAnswer;
}[] = [
  { answer: fresh(), entry: send(), name: "a public send with a fresh price" },
  {
    answer: fresh({ currency: "gbp" }),
    displayCurrency: "gbp",
    entry: send(),
    name: "in the display currency",
  },
  { answer: fresh(), entry: send(), name: "in dollars when no currency is set" },
  {
    answer: fresh({ stale: true }),
    entry: send(),
    name: "a stale price is not the price at submission",
  },
  { answer: fresh({ asOf: null }), entry: send(), name: "an undated price" },
  { answer: fresh({ prices: {} }), entry: send(), name: "no price for the token" },
  { answer: fresh({ prices: { [STRK]: 0 } }), entry: send(), name: "a zero price" },
  { answer: fresh({ prices: { [STRK]: -1 } }), entry: send(), name: "a negative price" },
  { answer: fresh(), entry: send({ origin: undefined }), name: "not this wallet's send" },
  {
    answer: fresh(),
    entry: send({ kind: "invoke" }),
    name: "not a transfer (a private send is an invoke)",
  },
  { answer: fresh(), entry: send({ direction: "in" }), name: "value coming in" },
  { answer: fresh(), entry: send({ direction: undefined }), name: "no direction" },
  { answer: fresh(), entry: send({ tokenAddress: undefined }), name: "no token address" },
  { answer: fresh(), entry: send({ amount: undefined }), name: "no amount" },
  { answer: fresh(), entry: send({ amount: "0" }), name: "a zero amount" },
  { answer: fresh(), entry: send({ amount: "all" }), name: "an amount that is not a number" },
  { answer: fresh(), entry: send({ amount: "1e3" }), name: "an exponent amount" },
  { answer: fresh(), entry: send({ amount: " 2.5 " }), name: "a padded amount" },
];

const captureOne = async (
  entry: NewActivityEntry,
  answer: PriceAnswer,
  displayCurrency: PriceAnswer["currency"] | undefined,
) => {
  const requests: unknown[] = [];
  const prices = {
    async getPrices(input: unknown) {
      requests.push(input);
      return { changes: {}, ...answer };
    },
  } as unknown as PriceService;
  const log = withSubmittedPrice(
    memoryActivityLog(() => SUBMITTED_AT),
    {
      prices: () => prices,
      readPreferences: async () => (displayCurrency === undefined ? {} : { displayCurrency }),
      // The deadline never passes: the canned answer is immediate.
      wait: () => new Promise<void>(() => undefined),
    },
  );
  await log.record(entry);
  const [row] = await log.list();
  return { request: requests[0] ?? null, submittedPrice: row?.submittedPrice ?? null };
};

export const computeCapture = async () => {
  const cases = [];
  for (const { answer, displayCurrency, entry, name } of CAPTURE_CASES) {
    cases.push({
      answer,
      displayCurrency: displayCurrency ?? null,
      entry: JSON.parse(JSON.stringify(entry)) as unknown,
      name,
      ...(await captureOne(entry, answer, displayCurrency)),
    });
  }
  return cases;
};

const priced = (
  amount: string | undefined,
  unitPrice: number,
  currency: PriceAnswer["currency"] = "usd",
) =>
  stored({
    amount,
    status: "accepted",
    submittedPrice: { currency, pricedAt: SUBMITTED_AT, unitPrice },
  });

const FACT_CASES: readonly { readonly name: string; readonly entry: ActivityEntry }[] = [
  { entry: stored({ status: "accepted" }), name: "neither recorded" },
  { entry: stored({ feePaid: { amount: ONE_HUNDREDTH, unit: "FRI" } }), name: "a STRK fee" },
  { entry: stored({ feePaid: { amount: "0x0", unit: "FRI" } }), name: "a zero STRK fee" },
  {
    entry: stored({ feePaid: { amount: "0x1", unit: "FRI" } }),
    name: "a STRK fee below six places",
  },
  {
    entry: stored({ feePaid: { amount: "0x1d6b5e8f5b9a7f9f", unit: "FRI" } }),
    name: "a STRK fee past six places",
  },
  {
    entry: stored({ feePaid: { amount: "0x3635c9adc5dea00000", unit: "FRI" } }),
    name: "a thousand STRK",
  },
  {
    entry: stored({ feePaid: { amount: LARGEST_FELT, unit: "FRI" } }),
    name: "the largest felt in STRK",
  },
  { entry: stored({ feePaid: { amount: ONE_HUNDREDTH, unit: "WEI" } }), name: "an ETH fee" },
  { entry: stored({ feePaid: { amount: "0x1", unit: "WEI" } }), name: "one wei, in full" },
  {
    entry: stored({ feePaid: { amount: "0x1d6b5e8f5b9a7f9f", unit: "WEI" } }),
    name: "an ETH fee in full precision",
  },
  {
    entry: stored({ feePaid: { amount: "0x64", unit: "FRI" }, status: "reverted" }),
    name: "a reverted send's fee",
  },
  { entry: priced("2.5", 0.12, "eur"), name: "a value in euros" },
  { entry: priced("1", 0.12, "gbp"), name: "a value in pounds" },
  { entry: priced("1234567.89", 2.5), name: "a grouped value" },
  { entry: priced("0.01", 0.12), name: "a value below a cent" },
  { entry: priced("0.0425", 0.2), name: "a value at a cent" },
  { entry: priced("0.105", 0.1), name: "a value rounding half" },
  { entry: priced("1e3", 0.12), name: "an exponent amount" },
  { entry: priced(" 2 ", 0.12), name: "a padded amount" },
  { entry: priced("0x10", 1), name: "a hex amount" },
  { entry: priced("1e400", 1), name: "an amount past a double" },
  { entry: priced("1", 1e21), name: "a value past 1e21" },
  { entry: priced("0", 0.12), name: "a zero amount" },
  { entry: priced("-1", 0.12), name: "a negative amount" },
  { entry: priced("all", 0.12), name: "an amount that is not a number" },
  { entry: priced("", 0.12), name: "an empty amount" },
  { entry: priced(undefined, 0.12), name: "no amount" },
  {
    entry: { ...priced("2.5", 0.12, "eur"), feePaid: { amount: ONE_HUNDREDTH, unit: "FRI" } },
    name: "both recorded",
  },
];

const VALUE_FACT = /<dt>Value at submission<\/dt><dd>([^<]*)<\/dd>/;

// The fact as the user reads it: `escapeHtml` undone (`&amp;` last, as it was escaped first).
const shownText = (html: string): string =>
  html
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

const valueText = (entry: ActivityEntry): string | null => {
  const html = VALUE_FACT.exec(activityRecordFacts(entry))?.[1];
  return html === undefined ? null : shownText(html);
};

export const computeFacts = () =>
  FACT_CASES.map(({ entry, name }) => ({
    entry: JSON.parse(JSON.stringify(entry)) as unknown,
    fee: activityFeeText(entry),
    name,
    value: valueText(entry),
  }));
