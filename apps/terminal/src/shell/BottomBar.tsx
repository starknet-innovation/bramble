/**
 * Bottom status bar with wallet, network, and live data-source state.
 */
import type { ReactNode } from "react";
import { useWallet } from "../wallet/WalletProvider";
import { shortenAddress } from "./screens";

/**
 * The application chrome's bottom bar.
 */
export const BottomBar = (): ReactNode => {
  const { address, chainId, isConnected } = useWallet();
  return (
    <div className="bottombar">
      <span className="bal">
        <span className="status-dot" />
        {isConnected ? `Connected ${shortenAddress(address ?? "")}` : "Wallet disconnected"}
      </span>
      <div className="right">
        <span>{chainId ?? "Starknet"}</span>
        <span>AVNU · Extended</span>
      </div>
    </div>
  );
};
