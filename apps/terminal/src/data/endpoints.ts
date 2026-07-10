/**
 * Off-chain API bases and the on-chain RPC failover list for the terminal's real
 * data layer. This is the single source of truth for every host the `data/`
 * hooks reach; nothing under `data/` hardcodes a URL inline.
 *
 * The RPC endpoints are NOT redefined here — they are read from the shared
 * network constants (`STARKNET_NETWORKS.SN_MAIN.rpcUrls`) so the data layer uses
 * the exact same ordered failover list as the protocol quote reads. The Avnu
 * base likewise reuses the protocol-layer constant. Only the CoinGecko and the
 * public Ekubo data-API bases (which the protocol layer does not already own)
 * are declared here.
 */
import { AVNU_API, EXTENDED_API_BASE } from "../protocols/constants";
import { STARKNET_NETWORKS } from "../protocols/support/networks";

/**
 * Ordered mainnet RPC failover list, reused from the shared network constants.
 */
export const RPC_URLS: readonly [string, ...string[]] = STARKNET_NETWORKS.SN_MAIN.rpcUrls;

/**
 * Avnu aggregator API base (swap quotes + the `/swap/v2/tokens` market list).
 * Reuses the audited protocol-layer constant rather than re-declaring the host.
 */
export const AVNU_BASE = AVNU_API.base;

/**
 * Ekubo public mainnet data API base — used only as the token-list fallback when
 * the Avnu `/swap/v2/tokens` shape is missing.
 */
export const EKUBO_BASE = "https://mainnet-api.ekubo.org";

/**
 * CoinGecko API base — token prices, major-asset prices, and OHLC market charts.
 */
export const COINGECKO_BASE = "https://api.coingecko.com";

/**
 * Extended (formerly x10) public perps-DEX REST base — the single source of
 * truth for every Extended REST call in the data layer. Derived from the audited
 * protocol-layer host (`EXTENDED_API_BASE`) plus the `/api/v1` version prefix the
 * public `/info/*` endpoints live under.
 *
 * HOST DISCREPANCY (verify live): the product brief + `protocols/constants.ts`
 * use the `api.starknet.extended.exchange` apex, which is what we default to
 * here. The official x10 Python SDK v0.4.5 `MAINNET_CONFIG` instead uses the
 * `api.extended.exchange` apex (i.e. REST base
 * `https://api.extended.exchange/api/v1`). Both likely resolve; if the default
 * 403s/DNS-fails live, switch `EXTENDED_API_BASE` in protocols/constants.ts to
 * the SDK apex. Testnet: `https://api.testnet.extended.exchange/api/v1`.
 */
export const EXTENDED_REST_BASE = `${EXTENDED_API_BASE.replace(/\/+$/, "")}/api/v1`;

/**
 * Extended public WebSocket stream base — one connection per stream is opened at
 * `${EXTENDED_WS_BASE}/<channel>/<market?>` (URL-path subscription model; no JSON
 * subscribe frame). Kept host-consistent with the REST base above.
 *
 * HOST DISCREPANCY (verify live): defaulted to the `starknet.` apex to match the
 * REST host. The SDK v0.4.5 variant is
 * `wss://api.extended.exchange/stream.extended.exchange/v1`; testnet is
 * `wss://api.testnet.extended.exchange/stream.extended.exchange/v1`. Switch here
 * if the WS handshake fails live.
 */
export const EXTENDED_WS_BASE = `wss://${new URL(EXTENDED_API_BASE).host}/stream.extended.exchange/v1`;
