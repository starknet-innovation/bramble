/**
 * Perps screen — STUB. The screen-build agent fills in the region banner, the
 * markets list, center chart + positions, order book, and the order ticket.
 * Perps settle off-chain via Extended signed orders (not wallet invoke calls);
 * see the protocol layer's `extended` module and the MANIFEST.
 */
import type { ReactNode } from "react";
import { EmptyState } from "../components";
import { useWallet } from "../wallet/WalletProvider";

export default function Perps(): ReactNode {
  const { isConnected, isConnecting, connect } = useWallet();
  return (
    <div className="screen" id="perps">
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="regionbanner">
          <span>&#9888;</span>
          <span>
            Access to this product isn't available in your region.{" "}
            <a href="#learn-more">Learn more.</a>
          </span>
        </div>
        <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", margin: 12 }}>
          <div className="card-h">Perps</div>
          <EmptyState
            icon="📊"
            title="Perps — coming soon"
            subtitle="Perp markets, order book, chart, and the leverage order ticket will appear here."
            ctaLabel={isConnected ? undefined : "Connect Wallet"}
            onCta={isConnected ? undefined : () => void connect()}
            ctaDisabled={isConnecting}
          />
        </div>
      </div>
    </div>
  );
}
