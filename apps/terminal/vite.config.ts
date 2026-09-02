import type { Server as HttpServer } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { isMissingAvnuCandleHistory } from "./src/data/avnu/avnu-proxy";
import { attachExtendedWebSocketBridge } from "./src/data/extended/dev-bridge";
import { AVNU_API, EXTENDED_API_BASE } from "./src/protocols/constants";

// Standalone SPA build for the Bramble Trade Terminal. This app is NOT part
// of the extension bundle — it is served as an ordinary web app and connects to
// the Bramble extension at runtime via the injected window.starknet_bramble
// provider.
//
// DEV PROXY (CORS fix)
// --------------------
// Extended REST does not allow browser origins. The proxy below gives the app a
// same-origin route in development; the other runtime hosts support CORS.
//
// This proxy ONLY exists under `bun run dev`; production must provide its own
// CORS-enabled Extended REST base via `VITE_EXTENDED_REST_BASE`.
const extendedRest = EXTENDED_API_BASE; // https://api.starknet.extended.exchange
const extendedWsTarget = `wss://${new URL(EXTENDED_API_BASE).host}`;
const extendedRestPrefix = "/proxy/extended";
const avnuMarketsPrefix = "/proxy/avnu-markets";
const starkscanPrefix = "/proxy/starkscan";
const extendedUserAgent = "Bramble-Terminal/0.1";

// Forward market-data GETs with a clean server-side header set. Extended needs
// the proxy for CORS; AVNU uses it so missing candle history can become a clean
// empty series instead of a browser-visible 404/500 retry flood.
const marketDataMiddleware = (): Plugin => ({
  name: "market-data-middleware",
  configureServer(server) {
    if (server.httpServer !== null) {
      const bridge = attachExtendedWebSocketBridge({
        prefix: "/proxy/extended-ws",
        server: server.httpServer as HttpServer,
        target: extendedWsTarget,
        userAgent: extendedUserAgent,
      });
      server.httpServer.once("close", bridge.close);
    }
    server.middlewares.use((request, response, next) => {
      const path = request.url ?? "";
      const isExtended = path.startsWith(`${extendedRestPrefix}/`);
      const isAvnuMarkets = path.startsWith(`${avnuMarketsPrefix}/`);
      const isStarkscan = path.startsWith(`${starkscanPrefix}/`);
      if (!isExtended && !isAvnuMarkets && !isStarkscan) {
        next();
        return;
      }
      if (request.method !== "GET") {
        response.statusCode = 405;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      void (async (): Promise<void> => {
        try {
          const prefix = isExtended
            ? extendedRestPrefix
            : isAvnuMarkets
              ? avnuMarketsPrefix
              : starkscanPrefix;
          const target = isExtended
            ? extendedRest
            : isAvnuMarkets
              ? AVNU_API.impulse
              : "https://starkscan.co";
          const upstreamPath = path.slice(prefix.length);
          const upstream = new URL(upstreamPath, target);
          const result = await fetch(upstream, {
            headers: { accept: "application/json", "user-agent": extendedUserAgent },
          });
          if (isAvnuMarkets && isMissingAvnuCandleHistory(upstreamPath, result.status)) {
            response.statusCode = 200;
            response.setHeader("content-type", "application/json");
            response.setHeader("cache-control", "no-store");
            response.setHeader("x-upstream-status", String(result.status));
            response.end("[]");
            return;
          }
          response.statusCode = result.status;
          response.setHeader(
            "content-type",
            result.headers.get("content-type") ?? "application/json",
          );
          const cacheControl = result.headers.get("cache-control");
          if (cacheControl !== null) {
            response.setHeader("cache-control", cacheControl);
          }
          response.end(Buffer.from(await result.arrayBuffer()));
        } catch {
          response.statusCode = 502;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: "Market data unavailable" }));
        }
      })();
    });
  },
});

export default defineConfig({
  plugins: [marketDataMiddleware(), react()],
  server: {
    port: 5273,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
