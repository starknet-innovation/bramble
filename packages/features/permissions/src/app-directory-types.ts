/**
 * The app directory's entry shape (mc-wallet issue 749), apart from its rules
 * and data so the bundled entries can name it without an import cycle.
 */
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";

/** The longest app name a listing may carry; approval responses are held to it too. */
export const MAX_APP_NAME_LENGTH = 40;

/** What a listed app is for; the directory screen filters on it. */
export const APP_CATEGORIES = [
  "defi",
  "gaming",
  "infrastructure",
  "nft",
  "payments",
  "social",
] as const;

/** One directory category. */
export type AppCategory = (typeof APP_CATEGORIES)[number];

/** The networks a listing can declare contracts for. */
export const APP_DIRECTORY_NETWORKS = [
  "SN_MAIN",
  "SN_SEPOLIA",
] as const satisfies readonly StarknetNetworkId[];

/** One listed app, as reviewed. */
export type ListedApp = {
  /** A public audit report covering the contracts that hold user funds. */
  readonly audit: string;
  readonly category: AppCategory;
  /** Per network: every contract the app asks users to call. */
  readonly chains: Partial<
    Record<(typeof APP_DIRECTORY_NETWORKS)[number], { readonly contracts: readonly string[] }>
  >;
  /** A stable slug, unique in the directory. */
  readonly id: string;
  readonly name: string;
  /** Exact origin: `https://` + host (+ port). No path, no wildcard. */
  readonly origin: string;
};
