/**
 * Tokens screen — STUB. The screen-build agent fills in the three-pane layout
 * (left token list, center token header + chart + trades tabs, right buy/sell
 * trade panel). Swaps are executed by building Ekubo/AVNU calls from the
 * protocol layer and sending them via the connected account. See the MANIFEST.
 */
import type { ReactNode } from "react";
import { EmptyState } from "../components";
import { useWallet } from "../wallet/WalletProvider";

export default function Tokens(): ReactNode {
  const { isConnected, isConnecting, connect } = useWallet();
  return (
    <div className="screen" id="tokens">
      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div className="card-h">Tokens</div>
        <EmptyState
          icon="🪙"
          title="Tokens — coming soon"
          subtitle="Token list, price chart, live trades, and a buy/sell panel will appear here."
          ctaLabel={isConnected ? undefined : "Connect Wallet"}
          onCta={isConnected ? undefined : () => void connect()}
          ctaDisabled={isConnecting}
        />
      </div>
    </div>
  );
}
