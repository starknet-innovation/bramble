/**
 * Per-network STRK20 production-service configuration. Endpoints and deployed
 * contract addresses are public routing metadata, so they live in the plain
 * preferences store; credentials are deliberately unsupported because an MV3
 * bundle cannot keep a shared API secret.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isServiceUrl } from "@bramble/core/service-url";
import {
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";

/**
 * Public same-origin gateway exposed to released wallet builds.
 */
export const STRK20_GATEWAY_BASE = "https://wallet.nodes.starknet.org/api/strk20";

/**
 * Networks that have a gasless paymaster route. Devnet is not one of them.
 */
export type GaslessNetworkId = "SN_MAIN" | "SN_SEPOLIA";

/**
 * Whether `value` is a network the gasless routes exist for.
 */
export const isGaslessNetworkId = (value: string): value is GaslessNetworkId =>
  value === "SN_MAIN" || value === "SN_SEPOLIA";

/**
 * Wallet-gateway gasless routes. The extension posts SNIP-29 fee mode
 * `default` here and does not call AVNU's hosts. These are not the STRK20
 * paymaster, which is the only route that carries a paymaster key.
 */
export const GASLESS_PAYMASTER_URLS: Readonly<Record<GaslessNetworkId, string>> = {
  SN_MAIN: "https://wallet.nodes.starknet.org/api/paymaster/mainnet",
  SN_SEPOLIA: "https://wallet.nodes.starknet.org/api/paymaster/sepolia",
};

/**
 * Wallet-side switches, independent of the gateway's `GASLESS_*_ENABLED`
 * switches. Both stay off until an independent security review turns one on.
 */
export const GASLESS_FEES_ENABLED: Readonly<Record<GaslessNetworkId, boolean>> = {
  SN_MAIN: false,
  SN_SEPOLIA: false,
};

/**
 * AVNU paymaster forwarder, pinned per network. Mainnet was confirmed by the
 * backend owner and is the caller and fee recipient in the gateway's mainnet
 * outside-execution fixture. Sepolia has no known forwarder: `null` makes the
 * gasless path refuse, and the wallet pays that network in STRK.
 */
export const GASLESS_FORWARDER_ADDRESS: Readonly<Record<GaslessNetworkId, string | null>> = {
  SN_MAIN: "0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f",
  SN_SEPOLIA: null,
};

/**
 * One network's gasless route: its URL, the wallet flag, and the pinned
 * forwarder. `forwarder: null` or `enabled: false` refuses the path.
 */
export type GaslessRoute = {
  readonly chainId: GaslessNetworkId;
  readonly enabled: boolean;
  readonly forwarder: string | null;
  readonly url: string;
};

/**
 * The bundled route for a network, or null when that network has no gasless
 * route. Reading this does not contact the gateway.
 */
export const gaslessRoute = (networkId: StarknetNetworkId): GaslessRoute | null => {
  if (!isGaslessNetworkId(networkId)) {
    return null;
  }
  return {
    chainId: networkId,
    enabled: GASLESS_FEES_ENABLED[networkId],
    forwarder: GASLESS_FORWARDER_ADDRESS[networkId],
    url: GASLESS_PAYMASTER_URLS[networkId],
  };
};

/**
 * Whether a route may build or submit a gasless fee. False when the wallet
 * flag is off or the forwarder pin is unset.
 */
export const gaslessRouteReady = (
  route: GaslessRoute | null,
): route is GaslessRoute & { readonly forwarder: string } =>
  route?.enabled === true && typeof route.forwarder === "string";

/**
 * Canonical Starknet Mainnet privacy-pool address.
 */
export const STRK20_MAINNET_POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

/**
 * Sponsored-private paymaster configuration. The fee token funds the
 * paymaster-provided withdrawal action added before proving.
 */
export type Strk20PaymasterConfig = {
  readonly feeToken: string;
  readonly url: string;
};

/**
 * Complete service and contract routing for one Starknet network.
 */
export type Strk20NetworkConfig = {
  readonly discoveryUrl: string;
  readonly ohttpEnabled?: boolean;
  readonly ohttpRelayUrl?: string;
  readonly paymaster?: Strk20PaymasterConfig;
  readonly poolAddress: string;
  readonly proverUrl: string;
  /**
   * Optional SDK shadow account module used only by `shadow_account_invoke`. Dapp
   * anonymizers/executors are separate reviewed invoke targets.
   */
  readonly shadowAccountAnonymizerAddress?: string;
};

/**
 * Sparse network routing map; an absent network is disabled and fails closed.
 */
export type Strk20NetworkConfigs = Readonly<
  Partial<Record<StarknetNetworkId, Strk20NetworkConfig>>
>;

const isPaymasterConfig = (value: unknown): value is Strk20PaymasterConfig =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["feeToken", "url"]) &&
  typeof value["feeToken"] === "string" &&
  isNonZeroStarkFieldElement(value["feeToken"]) &&
  typeof value["url"] === "string" &&
  isServiceUrl(value["url"]);

/**
 * Validates one complete STRK20 network configuration.
 */
export const isStrk20NetworkConfig = (value: unknown): value is Strk20NetworkConfig =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "discoveryUrl",
    "ohttpEnabled",
    "ohttpRelayUrl",
    "paymaster",
    "poolAddress",
    "proverUrl",
    "shadowAccountAnonymizerAddress",
  ]) &&
  typeof value["discoveryUrl"] === "string" &&
  isServiceUrl(value["discoveryUrl"]) &&
  (value["ohttpEnabled"] === undefined || typeof value["ohttpEnabled"] === "boolean") &&
  (value["ohttpRelayUrl"] === undefined ||
    (typeof value["ohttpRelayUrl"] === "string" && isServiceUrl(value["ohttpRelayUrl"]))) &&
  (value["paymaster"] === undefined || isPaymasterConfig(value["paymaster"])) &&
  typeof value["poolAddress"] === "string" &&
  isNonZeroStarkFieldElement(value["poolAddress"]) &&
  typeof value["proverUrl"] === "string" &&
  isServiceUrl(value["proverUrl"]) &&
  (value["shadowAccountAnonymizerAddress"] === undefined ||
    (typeof value["shadowAccountAnonymizerAddress"] === "string" &&
      isNonZeroStarkFieldElement(value["shadowAccountAnonymizerAddress"])));

/**
 * Bundled mainnet routing uses the wallet-owned AWS gateway so private upstream
 * service URLs and paymaster credentials never enter the extension bundle.
 * OHTTP remains disabled until both privacy upstreams support it.
 */
export const DEFAULT_STRK20_NETWORKS: Strk20NetworkConfigs = {
  SN_MAIN: {
    discoveryUrl: `${STRK20_GATEWAY_BASE}/discovery`,
    ohttpEnabled: false,
    paymaster: {
      feeToken: STRK_TOKEN_ADDRESS,
      url: `${STRK20_GATEWAY_BASE}/paymaster`,
    },
    poolAddress: STRK20_MAINNET_POOL,
    proverUrl: `${STRK20_GATEWAY_BASE}/prover`,
  },
};

/**
 * Validates the sparse per-network STRK20 routing map.
 */
export const isStrk20NetworkConfigs = (value: unknown): value is Strk20NetworkConfigs =>
  isRecord(value) &&
  Reflect.ownKeys(value).every(
    (key) =>
      typeof key === "string" && isStarknetNetworkId(key) && isStrk20NetworkConfig(value[key]),
  );
