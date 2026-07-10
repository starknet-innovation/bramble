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

const SCREENS: Record<ScreenId, ComponentType> = {
  discover: Discover,
  tokens: Tokens,
  perps: Perps,
  portfolio: Portfolio,
};

export const App = (): ReactNode => {
  const [active, setActive] = useState<ScreenId>("discover");
  const Screen = SCREENS[active];
  return (
    <>
      <TopNav active={active} onNavigate={setActive} />
      <main>
        <Screen />
      </main>
      <BottomBar />
    </>
  );
};
