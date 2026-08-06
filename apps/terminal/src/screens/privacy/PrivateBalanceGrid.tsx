import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { TokenIcon } from "../../components";

export type PrivateBalanceItem = {
  readonly address: string;
  readonly balance: string;
  readonly logoUri: string;
  readonly symbol: string;
};

/** Public aggregate balance cards; no note-level data is accepted or rendered. */
export const PrivateBalanceGrid = ({
  busy,
  items,
  onRefresh,
}: {
  readonly busy: boolean;
  readonly items: readonly PrivateBalanceItem[];
  readonly onRefresh: () => void;
}): ReactNode => (
  <div className="private-balance-grid">
    {items.map((item) => (
      <article key={item.address}>
        <TokenIcon logoUri={item.logoUri} name={item.symbol} size={34} symbol={item.symbol} />
        <span>{item.symbol}</span>
        <strong>{item.balance}</strong>
        <small>Private balance</small>
      </article>
    ))}
    <button className="privacy-primary" disabled={busy} onClick={onRefresh} type="button">
      <RefreshCw size={15} /> {busy ? "Reading wallet…" : "Refresh balances"}
    </button>
  </div>
);
