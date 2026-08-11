/**
 * Per-network STRK20 production-service configuration. Endpoints and deployed
 * contract addresses are public routing metadata, so they live in the plain
 * preferences store; credentials are deliberately unsupported because an MV3
 * bundle cannot keep a shared API secret.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isServiceUrl } from "@mc-wallet/core/service-url";
import {
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";

/**
 * Public same-origin gateway exposed to released wallet builds.
 */
export const STRK20_GATEWAY_BASE = "https://wallet.nodes.starknet.org/api/strk20";
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
   * Optional SDK sub-account module used only by `subaccount_invoke`. Dapp
   * anonymizers/executors are separate reviewed invoke targets.
   */
  readonly subaccountAnonymizerAddress?: string;
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
    "subaccountAnonymizerAddress",
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
  (value["subaccountAnonymizerAddress"] === undefined ||
    (typeof value["subaccountAnonymizerAddress"] === "string" &&
      isNonZeroStarkFieldElement(value["subaccountAnonymizerAddress"])));

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
