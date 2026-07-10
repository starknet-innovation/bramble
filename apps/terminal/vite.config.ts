import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { AVNU_API, EXTENDED_API_BASE } from "./src/protocols/constants";
import { STARKNET_NETWORKS } from "./src/protocols/support/networks";

// Standalone SPA build for the MC Wallet Trade Terminal. This app is NOT part
// of the extension bundle — it is served as an ordinary web app and connects to
// the MC Wallet extension at runtime via the injected window.starknet_mcWallet
// provider.
//
// DEV PROXY (CORS fix)
// --------------------
// The upstream APIs (CoinGecko, Extended, Avnu, Ekubo, the Starknet RPC) do NOT
// send `Access-Control-Allow-Origin`, so a direct browser `fetch` from the dev
// origin is blocked by CORS. The proxy below lets the browser call same-origin
// `/proxy/<name>/...` paths; Vite strips the prefix and forwards the request to
// the real host server-side (no CORS involved). `src/data/endpoints.ts` resolves
// its bases to these `/proxy/...` paths whenever the dev server is running.
//
// Proxy targets are derived from the SAME audited constants the data layer uses
// (no host is re-typed here). This proxy ONLY exists under `bun run dev`; a
// production deployment must front these APIs with a real reverse proxy / CORS-
// enabled hosting and point the `VITE_*_BASE` env vars at it (see README).
const extendedRest = EXTENDED_API_BASE; // https://api.starknet.extended.exchange
const extendedWsTarget = `wss://${new URL(EXTENDED_API_BASE).host}`;
const rpc = new URL(STARKNET_NETWORKS.SN_MAIN.rpcUrls[0]); // https://api.cartridge.gg/x/starknet/mainnet
const rpcTarget = `${rpc.protocol}//${rpc.host}`; // https://api.cartridge.gg

const strip = (prefix: string) => (path: string): string =>
  path.replace(new RegExp(`^${prefix}`), "");

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      // NOTE: `/proxy/extended-ws` MUST be declared before `/proxy/extended` so
      // the more specific WebSocket prefix wins for WS connect URLs.
      "/proxy/extended-ws": {
        target: extendedWsTarget,
        ws: true,
        changeOrigin: true,
        secure: true,
        rewrite: strip("/proxy/extended-ws"),
      },
      "/proxy/coingecko": {
        target: "https://api.coingecko.com",
        changeOrigin: true,
        secure: true,
        rewrite: strip("/proxy/coingecko"),
      },
      "/proxy/extended": {
        target: extendedRest,
        changeOrigin: true,
        secure: true,
        rewrite: strip("/proxy/extended"),
      },
      "/proxy/avnu": {
        target: AVNU_API.base,
        changeOrigin: true,
        secure: true,
        rewrite: strip("/proxy/avnu"),
      },
      "/proxy/ekubo": {
        target: "https://mainnet-api.ekubo.org",
        changeOrigin: true,
        secure: true,
        rewrite: strip("/proxy/ekubo"),
      },
      "/proxy/rpc": {
        // Keeps the upstream `/x/starknet/mainnet` path (only the `/proxy/rpc`
        // prefix is stripped).
        target: rpcTarget,
        changeOrigin: true,
        secure: true,
        rewrite: strip("/proxy/rpc"),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
