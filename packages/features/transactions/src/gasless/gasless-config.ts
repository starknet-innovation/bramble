/**
 * Wallet-wide gasless fee route. Public sends and dapp approvals both use
 * it, so it does not live with the private-pool configuration. Reading this
 * does not contact the gateway.
 */
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";

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
 * Wallet-gateway gasless routes. The extension posts fee mode `default` here.
 * These are not the private-pool paymaster.
 */
export const GASLESS_PAYMASTER_URLS: Readonly<Record<GaslessNetworkId, string>> = {
  SN_MAIN: "https://wallet.nodes.starknet.org/api/paymaster/mainnet",
  SN_SEPOLIA: "https://wallet.nodes.starknet.org/api/paymaster/sepolia",
};

/**
 * Wallet-side switches. Mainnet is on by Adrien's decision on Oct 28, 2026.
 * The independent security review is still pending. Sepolia stays off: that
 * network has no forwarder, so the route refuses.
 */
export const GASLESS_FEES_ENABLED: Readonly<Record<GaslessNetworkId, boolean>> = {
  SN_MAIN: true,
  SN_SEPOLIA: false,
};

/**
 * Paymaster forwarder, pinned per network. Mainnet was confirmed by the
 * backend owner. Sepolia has no known forwarder: `null` makes the gasless
 * path refuse, and the wallet pays that network in STRK.
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
