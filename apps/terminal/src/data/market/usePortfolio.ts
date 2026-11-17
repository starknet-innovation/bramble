/**
 * usePortfolio — composes on-chain balances (useBalances) with live prices
 * (usePrices) into priced holdings and portfolio totals. Only tokens with a
 * non-zero balance become holdings; nothing is fabricated. The 24h PnL is
 * derived from each holding's USD value and its 24h price change, so it reflects
 * real market movement of the real balances (not a made-up cost basis).
 */
import { useMemo } from "react";
import { canonicalAddress } from "../../protocols/support/networks";
import { useBalances } from "./useBalances";
import { usePrices } from "./usePrices";
import { useTokens } from "./useTokens";
import type { Holding, PortfolioData } from "../core/types";

export type UsePortfolioResult = {
  readonly data: PortfolioData;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
};

const EMPTY: PortfolioData = {
  holdings: [],
  totalValueUsd: 0,
  pnl24hUsd: 0,
  pnl24hPct: 0,
};

/**
 * Priced holdings + totals for `address`. Empty (all zeros) when disconnected.
 */
export const usePortfolio = (address: string | null): UsePortfolioResult => {
  const balances = useBalances(address);
  const prices = usePrices();
  const tokens = useTokens();

  const data = useMemo<PortfolioData>(() => {
    const rows = balances.data ?? [];
    const byAddress = prices.data?.byAddress ?? {};
    const logosByAddress = Object.fromEntries(
      (tokens.data ?? []).map((token) => [
        canonicalAddress(token.address) ?? token.address.toLowerCase(),
        token.logoUri,
      ]),
    );

    const holdings: Holding[] = rows
      .filter((balance) => balance.raw > 0n)
      .map((balance) => {
        const addressKey = canonicalAddress(balance.address) ?? balance.address.toLowerCase();
        // Priced and pictured by contract address only. Anyone can airdrop a
        // token that calls itself "WBTC", so a symbol never borrows a listed
        // token's price or logo (Sherlock 194); an unlisted token is unpriced
        // and adds nothing to the totals.
        const price = byAddress[addressKey];
        const priceUsd = price?.usd ?? null;
        const change24h = price?.change24h ?? null;
        const usdValue = priceUsd === null ? 0 : balance.amount * priceUsd;
        return {
          address: balance.address,
          symbol: balance.symbol,
          name: balance.name,
          logoUri: logosByAddress[addressKey] ?? null,
          decimals: balance.decimals,
          display: balance.display,
          amount: balance.amount,
          priceUsd,
          usdValue,
          change24h,
        };
      })
      .sort((a, b) => b.usdValue - a.usdValue);

    if (holdings.length === 0) {
      return EMPTY;
    }

    const totalValueUsd = holdings.reduce((sum, holding) => sum + holding.usdValue, 0);
    const pnl24hUsd = holdings.reduce((sum, holding) => {
      if (holding.change24h === null) {
        return sum;
      }
      // value_now - value_24h_ago, where value_24h_ago = value_now / (1 + chg).
      const prior = holding.usdValue / (1 + holding.change24h / 100);
      return sum + (holding.usdValue - prior);
    }, 0);
    const priorTotal = totalValueUsd - pnl24hUsd;
    const pnl24hPct = priorTotal === 0 ? 0 : (pnl24hUsd / priorTotal) * 100;

    return { holdings, totalValueUsd, pnl24hUsd, pnl24hPct };
  }, [balances.data, prices.data, tokens.data]);

  return {
    data,
    isLoading: balances.isLoading || prices.isLoading,
    error: balances.error ?? prices.error,
    refresh: balances.refresh,
  };
};
