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
import { AVNU_API } from "../protocols/constants";
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
