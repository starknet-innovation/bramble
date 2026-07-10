/**
 * Top navigation bar with real screen navigation and wallet connection state.
 */
import type { ReactNode } from "react";
import { useWallet } from "../wallet/WalletProvider";
import { type ScreenId, SCREEN_TABS, shortenAddress } from "./screens";

export type TopNavProps = {
  readonly active: ScreenId;
  readonly onNavigate: (screen: ScreenId) => void;
};

/**
 * The application chrome's top bar. Drives screen switching and wallet connect.
 */
export const TopNav = ({ active, onNavigate }: TopNavProps): ReactNode => {
  const { address, isConnected, isConnecting, connect, disconnect } = useWallet();

  const connectLabel = isConnected
    ? shortenAddress(address ?? "")
    : isConnecting
      ? "Connecting…"
      : "Connect Wallet";

  return (
    <div className="topnav">
      <div className="brand">
        <div className="logo">MC</div>
        <span>MC Wallet</span>
      </div>
      <div className="navtabs">
        {SCREEN_TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={tab.id === active ? "navtab active" : "navtab"}
            onClick={() => onNavigate(tab.id)}
            aria-current={tab.id === active ? "page" : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="navright">
        <button
          type="button"
          className="connect"
          disabled={isConnecting}
          onClick={() => (isConnected ? void disconnect() : void connect())}
        >
          {connectLabel}
        </button>
      </div>
    </div>
  );
};
