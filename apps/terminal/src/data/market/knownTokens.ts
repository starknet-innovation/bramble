/**
 * The known mainnet token set the data layer reads balances and prices for.
 * Derived from the audited protocol-layer constants (addresses + decimals) so
 * there is no second, drifting token table; only the human name is added here.
 */
import {
  MAINNET_TOKEN_ADDRESSES,
  MAINNET_TOKEN_DECIMALS,
  type MainnetTokenSymbol,
} from "../../protocols/constants";

/** A tracked token and its on-chain identity. */
export type KnownToken = {
  readonly symbol: MainnetTokenSymbol;
  readonly name: string;
  readonly address: string;
  readonly decimals: number;
};

const NAMES: Readonly<Record<MainnetTokenSymbol, string>> = {
  DAI: "Dai",
  ETH: "Ether",
  STRK: "Starknet Token",
  USDC: "USD Coin",
  USDT: "Tether USD",
  WBTC: "Wrapped BTC",
};

/** The tracked mainnet tokens, in display order. */
export const KNOWN_TOKENS: readonly KnownToken[] = (
  Object.keys(MAINNET_TOKEN_ADDRESSES) as MainnetTokenSymbol[]
).map((symbol) => ({
  symbol,
  name: NAMES[symbol],
  address: MAINNET_TOKEN_ADDRESSES[symbol],
  decimals: MAINNET_TOKEN_DECIMALS[symbol],
}));

/** Lowercased contract address -> known token, for reverse lookups. */
export const KNOWN_TOKENS_BY_ADDRESS: Readonly<Record<string, KnownToken>> = Object.fromEntries(
  KNOWN_TOKENS.map((token) => [token.address.toLowerCase(), token]),
);
