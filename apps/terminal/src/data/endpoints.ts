/**
 * Off-chain API bases and the on-chain RPC failover list for the terminal's real
 * data layer. This is the single source of truth for every host the `data/`
 * hooks reach; nothing under `data/` hardcodes a URL inline.
 *
 * Extended REST is routed through Vite's development proxy for CORS. AVNU
 * market data also uses a same-origin development route so missing candle
 * history can be normalized without browser-level 404/500 noise.
 *
 * Every host can be overridden with `VITE_<NAME>_BASE`. A production deployment
 * must point `VITE_EXTENDED_REST_BASE` at its own CORS-enabled reverse proxy;
 * the public Extended WebSocket can be used directly.
 *
 * PRODUCTION: the Vite dev proxy only exists while `bun run dev` is running. A
 * production deployment must front these APIs with a real reverse proxy (nginx,
 * a CDN edge worker, etc.) or CORS-enabled hosting and point the `VITE_*_BASE`
 * vars at it — otherwise the same CORS errors return in prod. See
 * `apps/terminal/README.md`.
 *
 * Hosts are derived from the protocol/network constants rather than retyped.
 */
import { AVNU_API, EKUBO_API_BASE, EXTENDED_API_BASE } from "../protocols/constants";
import { STARKNET_NETWORKS } from "../protocols/support/networks";

// -----------------------------------------------------------------------------
// Direct (production) hosts — the single source of truth, reused as the prod
// targets, as the Vite proxy targets, and by the offline `check:api` script
// (which bypasses the dev proxy and hits these directly, server-side, no CORS).
// -----------------------------------------------------------------------------

/** Ordered mainnet RPC failover list, reused from the shared network constants. */
export const RPC_DIRECT_URLS: readonly [string, ...string[]] = STARKNET_NETWORKS.SN_MAIN.rpcUrls;

/** AVNU quote/build API base. */
export const AVNU_DIRECT_BASE = AVNU_API.base;

/** AVNU's supported market-data API base. */
export const AVNU_MARKETS_DIRECT_BASE = AVNU_API.impulse;

/** Ekubo public mainnet data API base (token-list fallback). */
export const EKUBO_DIRECT_BASE = EKUBO_API_BASE;

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

// -----------------------------------------------------------------------------
// Resolved bases the data layer imports.
// -----------------------------------------------------------------------------

/** AVNU quote/build API. */
export const AVNU_BASE = override("AVNU") ?? AVNU_DIRECT_BASE;

/** AVNU market-data API used by token lists, prices, and charts. */
export const AVNU_MARKETS_BASE = USE_DEV_PROXY
  ? "/proxy/avnu-markets"
  : (override("AVNU_MARKETS") ?? AVNU_MARKETS_DIRECT_BASE);

/** Ekubo metadata API fallback. */
export const EKUBO_BASE = override("EKUBO") ?? EKUBO_DIRECT_BASE;

/**
 * Extended REST base: `/proxy/extended/api/v1` in dev (Vite strips `/proxy/extended`
 * and forwards to the real host), direct host otherwise.
 */
export const EXTENDED_REST_BASE = USE_DEV_PROXY
  ? "/proxy/extended/api/v1"
  : (override("EXTENDED_REST") ?? EXTENDED_REST_DIRECT_BASE);

/**
 * Extended WS base: a same-origin `/proxy/extended-ws/...` URL in dev (the Vite
 * bridge reconnects the upstream socket without dropping the browser socket),
 * direct `wss://` host otherwise. The path suffix after the origin is preserved
 * from the direct base so the upstream stream path is unchanged.
 */
export const EXTENDED_WS_BASE = USE_DEV_PROXY
  ? `${currentWsOrigin()}/proxy/extended-ws${new URL(EXTENDED_WS_DIRECT_BASE).pathname}`
  : (override("EXTENDED_WS") ?? EXTENDED_WS_DIRECT_BASE);

/**
 * RPC failover list. Cartridge permits browser origins, so no proxy is needed.
 */
export const RPC_URLS: readonly [string, ...string[]] = RPC_DIRECT_URLS;
