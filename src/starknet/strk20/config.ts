/**
 * Per-network STRK20 production-service configuration. Endpoints and deployed
 * contract addresses are public routing metadata, so they live in the plain
 * preferences store; credentials are deliberately unsupported because an MV3
 * bundle cannot keep a shared API secret.
 */
import { hasOnlyKnownKeys, isRecord } from "../../shared/json";
import { isServiceUrl } from "../../shared/service-url";
import {
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../networks";

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
  readonly ohttpRelayUrl?: string;
  readonly paymaster?: Strk20PaymasterConfig;
  readonly poolAddress: string;
  readonly proverUrl: string;
  readonly subaccountAnonymizerAddress: string;
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
    "ohttpRelayUrl",
    "paymaster",
    "poolAddress",
    "proverUrl",
    "subaccountAnonymizerAddress",
  ]) &&
  typeof value["discoveryUrl"] === "string" &&
  isServiceUrl(value["discoveryUrl"]) &&
  (value["ohttpRelayUrl"] === undefined ||
    (typeof value["ohttpRelayUrl"] === "string" && isServiceUrl(value["ohttpRelayUrl"]))) &&
  (value["paymaster"] === undefined || isPaymasterConfig(value["paymaster"])) &&
  typeof value["poolAddress"] === "string" &&
  isNonZeroStarkFieldElement(value["poolAddress"]) &&
  typeof value["proverUrl"] === "string" &&
  isServiceUrl(value["proverUrl"]) &&
  typeof value["subaccountAnonymizerAddress"] === "string" &&
  isNonZeroStarkFieldElement(value["subaccountAnonymizerAddress"]);

/**
 * Validates the sparse per-network STRK20 routing map.
 */
export const isStrk20NetworkConfigs = (value: unknown): value is Strk20NetworkConfigs =>
  isRecord(value) &&
  Reflect.ownKeys(value).every(
    (key) =>
      typeof key === "string" && isStarknetNetworkId(key) && isStrk20NetworkConfig(value[key]),
  );
