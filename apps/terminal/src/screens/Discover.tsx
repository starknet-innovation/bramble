/**
 * Discover screen — STUB. Foundation renders the shell + wallet-aware empty
 * state; the screen-build agent fills in the three-column layout (Total panel +
 * Positions/Activities/Follows on the left, Launches in the middle, ranked
 * Tokens/Perps tables on the right). See the MANIFEST for layout notes.
 */
import type { ReactNode } from "react";
import { EmptyState } from "../components";
import { useWallet } from "../wallet/WalletProvider";

export default function Discover(): ReactNode {
  const { isConnected, isConnecting, connect } = useWallet();
  return (
    <div className="screen" id="discover">
      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div className="card-h">Discover</div>
        <EmptyState
          icon="🔮"
          title="Discover — coming soon"
          subtitle="Launches, trending tokens, and ranked perps will appear here."
          ctaLabel={isConnected ? undefined : "Connect Wallet"}
          onCta={isConnected ? undefined : () => void connect()}
          ctaDisabled={isConnecting}
        />
      </div>
    </div>
  );
}
