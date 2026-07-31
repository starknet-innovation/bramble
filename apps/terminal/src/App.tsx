/**
 * App root: renders the shell chrome (top nav + bottom bar) and the active
 * screen. Screen switching is simple client-side tab state — no router
 * dependency — matching the mockup's four-screen nav.
 */
import { X } from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";
import Discover from "./screens/Discover";
import NftStudio from "./screens/NftStudio";
import Lending from "./screens/Lending";
import Perps from "./screens/Perps";
import Portfolio from "./screens/Portfolio";
import Privacy from "./screens/Privacy";
import Tokens from "./screens/Tokens";
import { BottomBar } from "./shell/BottomBar";
import { type ScreenId } from "./shell/screens";
import { TopNav } from "./shell/TopNav";
import { useWallet } from "./wallet/WalletProvider";

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
  const [active, setActive] = useState<ScreenId>("discover");
  const { clearError, error: walletError } = useWallet();
  const Screen = SCREENS[active];
  return (
    <>
      <TopNav active={active} onNavigate={setActive} />
      {walletError ? (
        <div className="wallet-notice" role="alert">
          <span>{walletError}</span>
          <button aria-label="Dismiss wallet error" onClick={clearError} type="button">
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      <main>
        <Screen onNavigate={setActive} />
      </main>
      <BottomBar />
    </>
  );
};
