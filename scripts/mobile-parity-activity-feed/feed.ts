/**
 * The one Activity feed every block of the feed fixture runs over (see `./index.ts`), newest
 * first as the log returns it, with the tokens the wallet tracks and the names a search resolves.
 * Every row, address and price is made up; the token addresses are the public mainnet contracts.
 */
import { type ActivityEntry, isActivityEntry } from "@bramble/transactions/activity";
import { canonicalAddress, canonicalFelt } from "@bramble/wallet-model/networks";
import { isTokenConfig, type TokenConfig, tokenConfigId } from "@bramble/wallet-model/preferences";
import type { ActivityContact } from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/activity-filter";

const ACCOUNT = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3";
const ALICE = "0x5a11ce1234567890abcdef1234567890abcdef1234567890abcdef12345678";
// Alice as a different writer spelled her: zero-padded, upper-case hex.
const ALICE_PADDED = `0x00${ALICE.slice(2).toUpperCase()}`;
const BOB = `0xb0b${"0".repeat(56)}b0b`;
const PEPE = "0x1234abcd"; // a token the wallet does not track

const felt = (value: string): string => {
  const canonical = canonicalFelt(value);
  if (canonical === null) throw new Error(`not a felt: ${value}`);
  return canonical;
};

const tracked = (address: string, symbol: string, name: string, decimals: number): TokenConfig => {
  const padded = canonicalAddress(address);
  if (padded === null) throw new Error(`not an address: ${address}`);
  const token = {
    address: padded,
    decimals,
    id: tokenConfigId("SN_MAIN", symbol, padded),
    name,
    networkId: "SN_MAIN",
    symbol,
  } as const;
  if (!isTokenConfig(token)) throw new Error(`not a token config: ${symbol}`);
  return token;
};

const STRK = felt("0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d");
const ETH = felt("0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7");
const USDC = felt("0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb");
// A second tracked contract under the same ticker (issue 643).
const USDC_BRIDGED = felt("0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8");

/** The wallet's tracked tokens (the feed's `pricing.tokens`): two share the symbol USDC. */
export const TRACKED: readonly TokenConfig[] = [
  tracked(STRK, "STRK", "Starknet Token", 18),
  tracked(ETH, "ETH", "Ether", 18),
  tracked(USDC, "USDC", "USD Coin", 6),
  tracked(USDC_BRIDGED, "USDC", "Bridged USD Coin", 6),
];

/** The names a search resolves; the label carries the characters `escapeHtml` rewrites. */
export const CONTACTS: readonly ActivityContact[] = [
  { address: canonicalAddress(ALICE) ?? ALICE, label: 'Alice & "Co" <ops>' },
];

const T = 1_752_501_900_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Row = Partial<ActivityEntry> & Pick<ActivityEntry, "kind" | "status" | "summary">;

const row = (index: number, submittedAt: number, fields: Row): ActivityEntry => {
  const networkId = fields.networkId ?? "SN_MAIN";
  const entry = {
    accountId: `${networkId}:${ACCOUNT}`,
    hash: `0x${(0xfeed00 + index).toString(16)}`,
    networkId,
    submittedAt,
    ...fields,
  };
  if (!isActivityEntry(entry)) throw new Error(`row ${index} is not an ActivityEntry`);
  return entry;
};

const send = (amount: string, token: string, tokenAddress: string | undefined) => ({
  amount,
  kind: "transfer" as const,
  token,
  ...(tokenAddress === undefined ? {} : { tokenAddress }),
});

/** One account's feed, newest first: kinds, tokens, networks, statuses, ties and odd rows. */
export const FEED: readonly ActivityEntry[] = [
  row(1, T, {
    ...send("25", "STRK", STRK),
    counterparty: ALICE,
    direction: "out",
    origin: "wallet",
    status: "accepted",
    submittedPrice: { currency: "usd", pricedAt: T - 5_000, unitPrice: 0.5 },
    summary: "Send 25 STRK to 0x5a11…5678",
  }),
  row(2, T - HOUR, {
    ...send("25", "STRK", STRK),
    counterparty: BOB,
    direction: "in",
    status: "accepted",
    summary: "Received 25 STRK from 0xb0b0…0b0b",
  }),
  // Same token, amount and time as row 2: the amount sort keeps the feed's order.
  row(3, T - HOUR, {
    ...send("25.0", "STRK", STRK),
    counterparty: BOB,
    direction: "in",
    status: "accepted",
    summary: "Received 25.0 STRK from 0xb0b0…0b0b",
  }),
  row(4, T - 2 * HOUR, {
    ...send("100", "USDC", USDC),
    counterparty: ALICE_PADDED,
    direction: "in",
    status: "preconfirmed",
    submittedPrice: { currency: "eur", pricedAt: T - 2 * HOUR, unitPrice: 0.92 },
    summary: "Received 100 USDC from 0x5a11…5678",
  }),
  row(5, T - DAY, {
    ...send("1.5", "ETH", ETH),
    counterparty: ALICE,
    direction: "out",
    origin: "wallet",
    status: "reverted",
    summary: "Send 1.5 ETH to 0x5a11…5678",
  }),
  row(6, T - DAY - HOUR, {
    ...send("0.25", "ETH", ETH),
    counterparty: ALICE,
    direction: "out",
    origin: "wallet",
    status: "pending",
    submittedPrice: { currency: "gbp", pricedAt: T - DAY - HOUR, unitPrice: 2345.678 },
    summary: "Send 0.25 ETH to 0x5a11…5678",
  }),
  row(7, T - DAY - 2 * HOUR, {
    ...send("3", "PEPE", felt(PEPE)),
    counterparty: ALICE,
    direction: "in",
    status: "accepted",
    summary: "Received 3 PEPE from 0x5a11…5678",
  }),
  row(8, T - 2 * DAY, {
    amount: "50",
    kind: "invoke",
    origin: "wallet",
    status: "accepted",
    summary: "Approve 50 USDC for 0x0410…7a3c",
    token: "USDC",
    tokenAddress: USDC,
  }),
  row(9, T - 2 * DAY - HOUR, {
    kind: "deploy",
    origin: "wallet",
    status: "accepted",
    summary: "Deploy Argent multisig Treasury",
  }),
  row(10, T - 3 * DAY, {
    kind: "invoke",
    origin: "wallet",
    status: "rejected",
    summary: "Change multisig signers: 2 of 3",
  }),
  // Legacy rows: no recorded address (and the first no direction either).
  row(11, T - 4 * DAY, {
    ...send("7", "USDC", undefined),
    counterparty: ALICE,
    status: "accepted",
    summary: "Received 7 USDC from 0x5a11…5678",
  }),
  // Larger than every ETH row with an address: with the tracked tokens it sorts first among
  // them, without them after them (its own `symbol:eth` key).
  row(12, T - 4 * DAY - HOUR, {
    ...send("2", "ETH", undefined),
    counterparty: ALICE,
    direction: "out",
    status: "accepted",
    summary: "Sent 2 ETH to 0x5a11…5678",
  }),
  row(13, T - 5 * DAY, {
    ...send("10", "STRK", undefined),
    accountId: `SN_SEPOLIA:${ACCOUNT}`,
    counterparty: BOB,
    direction: "in",
    networkId: "SN_SEPOLIA",
    status: "accepted",
    summary: "Received 10 STRK from 0xb0b0…0b0b",
  }),
  row(14, T - 6 * DAY, {
    ...send("about 5", "STRK", STRK),
    counterparty: BOB,
    direction: "out",
    status: "accepted",
    submittedPrice: { currency: "usd", pricedAt: T - 6 * DAY, unitPrice: 0.5 },
    summary: "Send about 5 STRK to 0xb0b0…0b0b",
  }),
  // More fraction digits than USDC has: counted, never totalled.
  row(15, T - 6 * DAY - HOUR, {
    ...send("0.1234567", "USDC", USDC),
    counterparty: ALICE,
    direction: "in",
    status: "accepted",
    summary: "Received 0.1234567 USDC from 0x5a11…5678",
  }),
  row(16, T - 7 * DAY, {
    amount: "10",
    kind: "invoke",
    origin: "wallet",
    status: "accepted",
    summary: "Swap 10 STRK for 5 USDC",
    token: "STRK",
    tokenAddress: STRK,
  }),
  row(17, T - 8 * DAY, {
    ...send("100", "USDC", USDC_BRIDGED),
    counterparty: BOB,
    direction: "out",
    origin: "wallet",
    status: "accepted",
    summary: "Send 100 USDC to 0xb0b0…0b0b",
  }),
  // Text a third party chose, opening spreadsheet formulas in several cells.
  row(18, T - 9 * DAY, {
    // Behind a no-break space (JavaScript whitespace) and a control character, as an importer
    // skips them.
    amount: "\u00a0\u0001-1",
    counterparty: "  -2+3",
    kind: "invoke",
    status: "accepted",
    summary: '=HYPERLINK("https://example.invalid","pay")',
    token: "@SUM",
  }),
  row(19, 1_000_000_000_000, {
    ...send(" 2 ", "  STRK ", STRK),
    counterparty: BOB,
    direction: "in",
    status: "accepted",
    summary: "Received 2 STRK from 0xb0b0…0b0b",
  }),
  // The epoch itself: a date the feed shows as no date.
  row(20, 0, {
    ...send("1", "STRK", STRK),
    counterparty: BOB,
    direction: "in",
    status: "rejected",
    summary: "Received 1 STRK from 0xb0b0…0b0b",
  }),
];

/** The feed without the given rows (1-based), as after a row settled or was dropped. */
export const without = (...indexes: readonly number[]): readonly ActivityEntry[] =>
  FEED.filter((_, at) => !indexes.includes(at + 1));

/** Values the cases name. */
export const KEYS = { ALICE_PADDED, BOB, ETH, STRK, USDC_BRIDGED } as const;
