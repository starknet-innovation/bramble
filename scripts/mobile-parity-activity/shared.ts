/** Values every block of the activity fixture shares (see `./index.ts`). All made up. */
import type { ActivityEntry } from "@bramble/transactions/activity";

const ACCOUNT = "SN_MAIN:0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3";
export const SCOPE = { accountId: ACCOUNT, networkId: "SN_MAIN" } as const;
export const HASH = "0x5c2b9cd7d7e5a3f0b6fdb1b3a7ac2d3b4d5e6f708192a3b4c5d6e7f8091a2b3";
const RECIPIENT = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
export const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const SUBMITTED_AT = 1_752_501_900_000;
export const ONE_HUNDREDTH = "0x2386f26fc10000";
// The field prime P is 2^251 + 17 * 2^192 + 1: the largest felt is P - 1.
export const LARGEST_FELT = `0x800000000000011${"0".repeat(48)}`;
export const FIELD_PRIME = `0x800000000000011${"0".repeat(47)}1`;

/** Fields to replace; an `undefined` one is dropped, as a stored row would lack it. */
export type Overrides<T> = { readonly [K in keyof T]?: T[K] | undefined };

const storedFields = (overrides: Overrides<ActivityEntry>) => ({
  accountId: ACCOUNT,
  amount: "1.5",
  counterparty: RECIPIENT,
  direction: "out",
  hash: HASH,
  kind: "transfer",
  networkId: "SN_MAIN",
  origin: "wallet",
  status: "pending",
  submittedAt: SUBMITTED_AT,
  summary: "Send 1.5 STRK to 0x49d3…4dc7",
  token: "STRK",
  tokenAddress: STRK,
  ...overrides,
});

/** A public send this wallet recorded, as stored; JSON-clean, so no key holds `undefined`. */
export const stored = (overrides: Overrides<ActivityEntry> = {}): ActivityEntry =>
  JSON.parse(JSON.stringify(storedFields(overrides))) as ActivityEntry;
