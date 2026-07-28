import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { WalletProvider } from "./wallet/WalletProvider";
import "./styles/theme.css";
import "./styles/perps-workspace.css";
import "./styles/swap.css";
import "./styles/swap-details.css";
import "./styles/lending.css";
import "./styles/lending-risk-ticket.css";
import "./styles/lending-account.css";
import "./styles/lending-responsive.css";
import "./styles/lending-visuals.css";
import "./styles/lending-manage.css";
import "./styles/wallet-ui.css";
import "./styles/nft-studio.css";
import "./styles/nft-studio-finishing.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root container #root not found");
}

createRoot(container).render(
  <StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </StrictMode>,
);
