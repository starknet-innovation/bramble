/**
 * App root: renders the shell chrome (top nav + bottom bar) and the active
 * screen. Screen switching is simple client-side tab state — no router
 * dependency — matching the mockup's four-screen nav.
 */
import { X } from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";
import Discover from "./screens/discover/Discover";
import NftStudio from "./screens/nft/NftStudio";
import Lending from "./screens/lending/Lending";
import Perps from "./screens/perps/Perps";
import Portfolio from "./screens/portfolio/Portfolio";
import Privacy from "./screens/privacy/Privacy";
import Tokens from "./screens/tokens/Tokens";
import { BottomBar } from "./shell/BottomBar";
import { type ScreenId, screenFromHash } from "./shell/screens";
import { TopNav } from "./shell/TopNav";
import { useWallet } from "./wallet/connection/WalletProvider";

type ScreenProps = { readonly onNavigate: (screen: ScreenId) => void };

const SCREENS: Record<ScreenId, ComponentType<ScreenProps>> = {
  discover: Discover,
  lending: Lending,
  nfts: NftStudio,
  tokens: Tokens,
  perps: Perps,
  portfolio: Portfolio,
  privacy: Privacy,
};

export const App = (): ReactNode => {
  const [active, setActive] = useState<ScreenId>(() => screenFromHash(window.location.hash));
  const { address, chainId, clearError, error: walletError } = useWallet();
  const Screen = SCREENS[active];
  const navigate = (screen: ScreenId): void => {
    setActive(screen);
    window.history.replaceState(null, "", `#${screen}`);
  };
  return (
    <>
      <TopNav active={active} onNavigate={navigate} />
      {walletError ? (
        <div className="wallet-notice" role="alert">
          <span>{walletError}</span>
          <button aria-label="Dismiss wallet error" onClick={clearError} type="button">
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      <main>
        {/* Screens hold account-bound state (a lending position under review,
            private balances) and async replies started for one account; a new
            account or network remounts the screen instead (Sherlock 222). */}
        <Screen key={`${address ?? ""}:${chainId ?? ""}`} onNavigate={navigate} />
      </main>
      <BottomBar />
    </>
  );
};
