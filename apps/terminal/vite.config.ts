import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Standalone SPA build for the MC Wallet Trade Terminal. This app is NOT part
// of the extension bundle — it is served as an ordinary web app and connects to
// the MC Wallet extension at runtime via the injected window.starknet_mcWallet
// provider.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
