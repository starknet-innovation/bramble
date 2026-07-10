/**
 * Top navigation bar — logo, screen tabs, search box, balance chip, and the
 * Connect Wallet button. Ported from the mockup's `.topnav`.
 */
import type { ReactNode } from "react";
import { Search, Settings } from "lucide-react";
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
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="search">
        <Search className="mag" size={14} strokeWidth={1.75} aria-hidden />
        <input type="text" placeholder="Search tokens, perps, wallets" />
        <span className="slash">/</span>
      </div>
      <div className="navright">
        <div className="balchip">
          <span className="dot" />
          {isConnected ? shortenAddress(address ?? "") : "$0.00"}
        </div>
        <div className="numsel">
          <button type="button" className="active">
            1
          </button>
          <button type="button">2</button>
          <button type="button">3</button>
        </div>
        <button
          type="button"
          className="connect"
          disabled={isConnecting}
          onClick={() => (isConnected ? void disconnect() : void connect())}
        >
          {connectLabel}
        </button>
        <button type="button" className="iconbtn" aria-label="Settings">
          <Settings size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
};
