/**
 * App root: renders the shell chrome (top nav + bottom bar) and the active
 * screen. Screen switching is simple client-side tab state — no router
 * dependency — matching the mockup's four-screen nav.
 */
import { type ComponentType, type ReactNode, useState } from "react";
import Discover from "./screens/Discover";
import Perps from "./screens/Perps";
import Portfolio from "./screens/Portfolio";
import Tokens from "./screens/Tokens";
import { BottomBar } from "./shell/BottomBar";
import { type ScreenId } from "./shell/screens";
import { TopNav } from "./shell/TopNav";
import { useWallet } from "./wallet/WalletProvider";

type ScreenProps = { readonly onNavigate: (screen: ScreenId) => void };

const SCREENS: Record<ScreenId, ComponentType<ScreenProps>> = {
  discover: Discover,
  tokens: Tokens,
  perps: Perps,
  portfolio: Portfolio,
};

export const App = (): ReactNode => {
  const [active, setActive] = useState<ScreenId>("discover");
  const { error: walletError } = useWallet();
  const Screen = SCREENS[active];
  return (
    <>
      <TopNav active={active} onNavigate={setActive} />
      {walletError ? (
        <div className="wallet-notice" role="alert">
          {walletError}
        </div>
      ) : null}
      <main>
        <Screen onNavigate={setActive} />
      </main>
      <BottomBar />
    </>
  );
};
