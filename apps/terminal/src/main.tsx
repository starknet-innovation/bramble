import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { WalletProvider } from "./wallet/WalletProvider";
import "./styles/theme.css";

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
