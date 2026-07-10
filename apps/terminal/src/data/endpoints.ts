/**
 * Off-chain API bases and the on-chain RPC failover list for the terminal's real
 * data layer. This is the single source of truth for every host the `data/`
 * hooks reach; nothing under `data/` hardcodes a URL inline.
 *
 * ENVIRONMENT-AWARE BASES (CORS fix)
 * ----------------------------------
 * The browser cannot call these APIs directly — CoinGecko and Extended (and the
 * others) do not send an `Access-Control-Allow-Origin` header, so a direct
 * `fetch` from `http://localhost:5273` is blocked by CORS. To make local
 * development work, `vite.config.ts` defines a `server.proxy` that maps local
 * `/proxy/<name>` prefixes onto the real hosts (same-origin from the browser's
 * point of view, so no CORS, and CoinGecko's demo API key rides along).
 *
 * Accordingly each base below resolves at import time:
 *   - In the Vite dev server (`import.meta.env.DEV`, but NOT under vitest) it is
 *     the relative `/proxy/...` path so requests go same-origin through Vite.
 *   - Otherwise (production build, unit tests) it is the direct host, which can
 *     be overridden per-host via `import.meta.env.VITE_<NAME>_BASE`.
 *
 * PRODUCTION: the Vite dev proxy only exists while `bun run dev` is running. A
 * production deployment must front these APIs with a real reverse proxy (nginx,
 * a CDN edge worker, etc.) or CORS-enabled hosting and point the `VITE_*_BASE`
 * vars at it — otherwise the same CORS errors return in prod. See
 * `apps/terminal/README.md`.
 *
 * The RPC endpoints and the Avnu base are NOT redefined here — they are read
 * from the shared constants (`STARKNET_NETWORKS.SN_MAIN.rpcUrls`, `AVNU_API`) so
 * the data layer uses the exact same audited hosts as the protocol quote reads.
 * Only the CoinGecko and public Ekubo data-API bases (which the protocol layer
 * does not already own) are declared here.
 */
import { AVNU_API, EXTENDED_API_BASE } from "../protocols/constants";
import { STARKNET_NETWORKS } from "../protocols/support/networks";

// -----------------------------------------------------------------------------
// Direct (production) hosts — the single source of truth, reused as the prod
// targets, as the Vite proxy targets, and by the offline `check:api` script
// (which bypasses the dev proxy and hits these directly, server-side, no CORS).
// -----------------------------------------------------------------------------

/** Ordered mainnet RPC failover list, reused from the shared network constants. */
export const RPC_DIRECT_URLS: readonly [string, ...string[]] = STARKNET_NETWORKS.SN_MAIN.rpcUrls;

/** Avnu aggregator API base (`/swap/v2/tokens`). Reuses the protocol constant. */
export const AVNU_DIRECT_BASE = AVNU_API.base;

/** Ekubo public mainnet data API base (token-list fallback). */
export const EKUBO_DIRECT_BASE = "https://mainnet-api.ekubo.org";

/** CoinGecko API base — token prices, majors, and OHLC market charts. */
export const COINGECKO_DIRECT_BASE = "https://api.coingecko.com";

/**
 * Extended public perps-DEX REST base — the audited host (`EXTENDED_API_BASE`)
 * plus the `/api/v1` version prefix the public `/info/*` endpoints live under.
 */
export const EXTENDED_REST_DIRECT_BASE = `${EXTENDED_API_BASE.replace(/\/+$/, "")}/api/v1`;

/** Extended public WebSocket stream base, host-consistent with the REST base. */
export const EXTENDED_WS_DIRECT_BASE = `wss://${new URL(EXTENDED_API_BASE).host}/stream.extended.exchange/v1`;

// -----------------------------------------------------------------------------
// Environment resolution.
// -----------------------------------------------------------------------------

/**
 * Vite/Bun-safe env accessor. In the Vite dev server / a build, `import.meta.env`
 * is Vite's typed object; under Bun (the `check:api` script) it maps to
 * `process.env`, where DEV/MODE are simply undefined — which correctly resolves
 * to the direct hosts.
 */
const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;

/**
 * The dev proxy only exists while the Vite dev server (`bun run dev`) is running.
 * `import.meta.env.DEV` is also true under vitest, so exclude `MODE === "test"`
 * (the unit suite mocks `fetch` against the direct hosts).
 */
const USE_DEV_PROXY = env.DEV === true && env.MODE !== "test";

/** Reads a `VITE_<NAME>_BASE` prod override, if a non-empty string is set. */
const override = (name: string): string | undefined => {
  const value = env[`VITE_${name}_BASE`];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/** Same-origin WS origin (ws/wss) for the current page, for the dev WS proxy. */
const currentWsOrigin = (): string => {
  if (typeof window !== "undefined" && window.location !== undefined) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}`;
  }
  return "ws://localhost:5273";
};

/** Same-origin HTTP origin for the current page, for the dev RPC proxy. */
const currentHttpOrigin = (): string =>
  typeof window !== "undefined" && window.location !== undefined
    ? window.location.origin
    : "http://localhost:5273";

// -----------------------------------------------------------------------------
// Resolved bases the data layer imports.
// -----------------------------------------------------------------------------

/** CoinGecko base: `/proxy/coingecko` in dev, direct host otherwise. */
export const COINGECKO_BASE = USE_DEV_PROXY
  ? "/proxy/coingecko"
  : (override("COINGECKO") ?? COINGECKO_DIRECT_BASE);

/** Avnu base: `/proxy/avnu` in dev, direct host otherwise. */
export const AVNU_BASE = USE_DEV_PROXY ? "/proxy/avnu" : (override("AVNU") ?? AVNU_DIRECT_BASE);

/** Ekubo base: `/proxy/ekubo` in dev, direct host otherwise. */
export const EKUBO_BASE = USE_DEV_PROXY ? "/proxy/ekubo" : (override("EKUBO") ?? EKUBO_DIRECT_BASE);

/**
 * Extended REST base: `/proxy/extended/api/v1` in dev (Vite strips `/proxy/extended`
 * and forwards to the real host), direct host otherwise.
 */
export const EXTENDED_REST_BASE = USE_DEV_PROXY
  ? "/proxy/extended/api/v1"
  : (override("EXTENDED_REST") ?? EXTENDED_REST_DIRECT_BASE);

/**
 * Extended WS base: a same-origin `/proxy/extended-ws/...` URL in dev (Vite
 * tunnels the socket to the real WS host), direct `wss://` host otherwise. The
 * path suffix after the origin is preserved from the direct base so the upstream
 * stream path is unchanged.
 */
export const EXTENDED_WS_BASE = USE_DEV_PROXY
  ? `${currentWsOrigin()}/proxy/extended-ws${new URL(EXTENDED_WS_DIRECT_BASE).pathname}`
  : (override("EXTENDED_WS") ?? EXTENDED_WS_DIRECT_BASE);

/**
 * RPC failover list. In dev the primary is proxied same-origin through Vite
 * (`/proxy/rpc<path>`, `<path>` preserved from the direct URL so the Cartridge
 * `/x/starknet/mainnet` route is intact); `starknet.js` needs an absolute URL,
 * so the current page origin is prepended. Otherwise the direct list is used.
 */
export const RPC_URLS: readonly [string, ...string[]] = USE_DEV_PROXY
  ? [`${currentHttpOrigin()}/proxy/rpc${new URL(RPC_DIRECT_URLS[0]).pathname}`]
  : RPC_DIRECT_URLS;

/**
 * Optional CoinGecko demo API key (`import.meta.env.VITE_COINGECKO_API_KEY`).
 * When set it lifts the harsh anonymous rate limit; sent as the demo-key header
 * (which rides through the dev proxy). See `usePrices` / `useCandles`.
 */
export const COINGECKO_API_KEY: string | undefined =
  typeof env.VITE_COINGECKO_API_KEY === "string" && env.VITE_COINGECKO_API_KEY.length > 0
    ? env.VITE_COINGECKO_API_KEY
    : undefined;

/**
 * Extra headers for CoinGecko requests: the demo API-key header when a key is
 * configured, else empty. Works through the dev proxy and against the direct host.
 */
export const coingeckoHeaders = (): Record<string, string> =>
  COINGECKO_API_KEY !== undefined ? { "x-cg-demo-api-key": COINGECKO_API_KEY } : {};
