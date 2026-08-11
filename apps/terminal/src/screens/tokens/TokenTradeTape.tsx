import { Receipt } from "lucide-react";
import type { ReactNode } from "react";
import { canonicalAddress } from "../../protocols/support/networks";
import {
  EmptyState,
  ErrorBanner,
  SkeletonRows,
} from "../../components/index";
import { formatCompactUsd, formatPrice, type Resource, type TokenTrade } from "../../data/index";

type TokenTradeTapeProps = {
  readonly connected: boolean;
  readonly mode: "trades" | "mine";
  readonly resource: Resource<readonly TokenTrade[]>;
  readonly tokenSymbol: string;
  readonly walletTransactionHashes: ReadonlySet<string>;
};

const amountLabel = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: 6 });

const timeLabel = (timestampMs: number): string =>
  new Date(timestampMs).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const isWalletTrade = (trade: TokenTrade, hashes: ReadonlySet<string>): boolean => {
  const hash = canonicalAddress(trade.txHash);
  return hash !== null && hashes.has(hash);
};

/**
 * Verified Ekubo fills for a token, with a connected-wallet filter driven by
 * exact Starkscan transaction hashes rather than guessed trader attribution.
 */
export const TokenTradeTape = ({
  connected,
  mode,
  resource,
  tokenSymbol,
  walletTransactionHashes,
}: TokenTradeTapeProps): ReactNode => {
  const allTrades = resource.data ?? [];
  const trades =
    mode === "mine"
      ? allTrades.filter((trade) => isWalletTrade(trade, walletTransactionHashes))
      : allTrades;

  if (mode === "mine" && !connected) {
    return (
      <EmptyState
        icon={<Receipt size={22} strokeWidth={1.75} />}
        title="Connect your wallet"
        subtitle="Your recent fills are matched by exact transaction hash."
        style={{ minHeight: 180 }}
      />
    );
  }
  if (resource.error !== null && allTrades.length === 0) {
    return <ErrorBanner message={`Couldn't load spot trades: ${resource.error}`} />;
  }
  if (resource.isLoading && allTrades.length === 0) {
    return <SkeletonRows rows={6} />;
  }
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={<Receipt size={22} strokeWidth={1.75} />}
        title={mode === "mine" ? "No recent wallet fills" : "No recent pair fills"}
        subtitle={
          mode === "mine"
            ? "A matching Ekubo fill will appear here as soon as its transaction is indexed."
            : "This token has no recent trades against the available USD reference pairs."
        }
        style={{ minHeight: 180 }}
      />
    );
  }

  return (
    <div className="token-trade-tape">
      <div className="token-trade-status">
        <span className="token-trade-live" aria-hidden="true" />
        Live spot fills
        <span>Ekubo indexer</span>
      </div>
      <div className="token-trade-head" aria-hidden="true">
        <span>Side</span>
        <span>Price</span>
        <span>Amount</span>
        <span>Value</span>
        <span>Time</span>
      </div>
      <div className="token-trade-scroll" role="feed" aria-label={`${tokenSymbol} spot trades`}>
        {trades.map((trade) => (
          <a
            key={trade.id}
            role="article"
            className={`token-trade-row ${trade.side}`}
            href={`https://starkscan.co/tx/${trade.txHash}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`${trade.side} ${amountLabel(trade.amount)} ${tokenSymbol} for ${formatCompactUsd(trade.valueUsd)}`}
          >
            <span className="token-trade-side">{trade.side}</span>
            <span className="mono">{formatPrice(trade.priceUsd)}</span>
            <span className="mono">
              {amountLabel(trade.amount)} <small>{tokenSymbol}</small>
            </span>
            <span className="mono">{formatCompactUsd(trade.valueUsd)}</span>
            <span className="mono token-trade-time">{timeLabel(trade.timestampMs)}</span>
          </a>
        ))}
      </div>
    </div>
  );
};
