/**
 * Deterministic token, amount, and review models for the Terminal privacy screen.
 */
import { avnuTokenArtwork } from "../../assets/avnu-token-assets";
import {
  MAINNET_TOKEN_ADDRESSES,
  MAINNET_TOKEN_DECIMALS,
  type MainnetTokenSymbol,
} from "../../protocols/constants";
import type { PrivateSwapFee } from "../../protocols/avnu/private-swap-client";

export type Mode = "balances" | "deposit" | "register" | "swap" | "transfer" | "withdraw";
export type TokenOption = {
  readonly address: string;
  readonly decimals: number;
  readonly logoUri: string;
  readonly symbol: MainnetTokenSymbol;
};

export type SwapReview = {
  readonly actions: readonly unknown[];
  readonly buyAmount: bigint;
  readonly minBuyAmount: bigint;
  readonly buyToken: TokenOption;
  readonly executor: string;
  readonly fee: PrivateSwapFee;
  readonly sellAmount: bigint;
  readonly sellToken: TokenOption;
};

export const TOKENS: readonly TokenOption[] = (["STRK", "ETH", "USDC", "USDT"] as const).map(
  (symbol) => ({
    address: MAINNET_TOKEN_ADDRESSES[symbol],
    decimals: MAINNET_TOKEN_DECIMALS[symbol],
    logoUri: avnuTokenArtwork(MAINNET_TOKEN_ADDRESSES[symbol], null) ?? "",
    symbol,
  }),
);

export const FEE_MODE = {
  poolFeeToken: MAINNET_TOKEN_ADDRESSES.STRK,
  tip: "normal" as const,
};

export const modeLabel: Readonly<Record<Mode, string>> = {
  balances: "Private balances",
  deposit: "Shield",
  register: "Activate",
  swap: "Private swap",
  transfer: "Private transfer",
  withdraw: "Withdraw",
};

export const parseAmount = (value: string, decimals: number): bigint => {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    throw new Error("Enter a valid positive amount.");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new Error(`This token supports at most ${decimals} decimal places.`);
  }
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
  if (raw <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  return raw;
};

export const short = (value: string): string =>
  value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;

export const formatRaw = (raw: string, decimals: number): string => {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${value / base}${fraction ? `.${fraction.slice(0, 6)}` : ""}`;
};
