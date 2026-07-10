/**
 * Portfolio screen — STUB. The screen-build agent fills in the balance/P&L
 * header and the Tokens / Perps / Activity tabs. See the MANIFEST.
 */
import type { ReactNode } from "react";
import { EmptyState } from "../components";
import { useWallet } from "../wallet/WalletProvider";

export default function Portfolio(): ReactNode {
  const { isConnected, isConnecting, connect } = useWallet();
  return (
    <div className="screen" id="portfolio">
      <div className="card pf-top">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Portfolio</div>
        </div>
        <div className="pf-balrow">
          <div>
            <div className="lbl">Balance</div>
            <div className="val">$0.00</div>
          </div>
          <div>
            <div className="lbl">P&amp;L</div>
            <div className="val pos" style={{ fontSize: 20 }}>
              +$0.00 (0.00%)
            </div>
          </div>
        </div>
      </div>
      <div className="card pf-body">
        <EmptyState
          icon="💼"
          title="Portfolio — coming soon"
          subtitle="Connect your Starknet wallet to view token holdings, perps positions, and activity."
          ctaLabel={isConnected ? undefined : "Connect Wallet"}
          onCta={isConnected ? undefined : () => void connect()}
          ctaDisabled={isConnecting}
        />
      </div>
    </div>
  );
}
