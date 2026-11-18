/**
 * Bottom status bar with wallet, network, and live data-source state.
 */
import { addressLabel } from "@bramble/wallet-model/networks";
import type { ReactNode } from "react";
import { useWallet } from "../wallet/connection/WalletProvider";

/**
 * The application chrome's bottom bar.
 */
export const BottomBar = (): ReactNode => {
  const { address, chainId, isConnected } = useWallet();
  return (
    <div className="bottombar">
      <span className="bal">
        <span className="status-dot" />
        {isConnected ? `Connected ${addressLabel(address ?? "")}` : "Wallet disconnected"}
      </span>
      <div className="right">
        <span>{chainId ?? "Starknet"}</span>
        <span>AVNU · Vesu V2 · Extended</span>
      </div>
    </div>
  );
};
