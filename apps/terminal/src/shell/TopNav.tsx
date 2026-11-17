/**
 * Top navigation bar with real screen navigation and wallet connection state.
 */
import { Check, ChevronDown, Copy, LogOut, WalletCards } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useWallet } from "../wallet/connection/WalletProvider";
import { walletNetwork } from "../wallet/connection/wallet-connection";
import { type ScreenId, SCREEN_TABS, shortenAddress } from "./screens";

export type TopNavProps = {
  readonly active: ScreenId;
  readonly onNavigate: (screen: ScreenId) => void;
};

/**
 * The application chrome's top bar. Drives screen switching and wallet connect.
 */
export const TopNav = ({ active, onNavigate }: TopNavProps): ReactNode => {
  const {
    address,
    chainId,
    isConnected,
    isConnecting,
    walletName,
    connect,
    disconnect,
  } = useWallet();
  const [copied, setCopied] = useState(false);
  const network = walletNetwork(chainId);
  const networkLabel =
    network?.id === "SN_MAIN"
      ? "Mainnet"
      : network?.id === "SN_SEPOLIA"
        ? "Sepolia"
        : network?.name ?? chainId ?? "Unknown";

  const copyAddress = async (): Promise<void> => {
    if (address === null) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="topnav">
      <div className="brand">
        <div className="logo">B</div>
        <span>Bramble</span>
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
        {isConnected && address !== null ? (
          <details
            className="wallet-session"
            onToggle={(event) => {
              if (!event.currentTarget.open) setCopied(false);
            }}
          >
            <summary className="wallet-session-trigger">
              <span className="wallet-session-dot" aria-hidden />
              <span className="wallet-session-network">{networkLabel}</span>
              <span className="wallet-session-address">{shortenAddress(address)}</span>
              <ChevronDown size={13} aria-hidden />
            </summary>
            <div className="wallet-session-menu">
              <div className="wallet-session-heading">
                <span className="wallet-session-icon">
                  <WalletCards size={17} aria-hidden />
                </span>
                <div>
                  <strong>{walletName ?? "Starknet wallet"}</strong>
                  <span>Connected to {networkLabel}</span>
                </div>
              </div>
              <div className="wallet-session-account">
                <span>Active account</span>
                <code>{address}</code>
              </div>
              <div className="wallet-session-actions">
                <button type="button" onClick={() => void copyAddress()}>
                  {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                  {copied ? "Copied" : "Copy address"}
                </button>
                <button className="disconnect" type="button" onClick={() => void disconnect()}>
                  <LogOut size={14} aria-hidden />
                  Disconnect
                </button>
              </div>
              <p>
                Every action gets a terminal review before {walletName ?? "your wallet"} opens.
              </p>
            </div>
          </details>
        ) : (
          <button
            type="button"
            className="connect"
            disabled={isConnecting}
            onClick={() => void connect()}
          >
            {isConnecting ? (
              <>
                <span className="connect-spinner" aria-hidden />
                Check wallet
              </>
            ) : (
              "Connect Wallet"
            )}
          </button>
        )}
      </div>
    </div>
  );
};
