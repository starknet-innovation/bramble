/**
 * Starknet network constants kept separate from UI and storage code.
 */
export type StarknetNetworkId = "SN_MAIN" | "SN_SEPOLIA" | "SN_DEVNET";

/**
 * Starknet network metadata used for account derivation and display.
 * `rpcUrls` is an ordered failover list; the first entry is the primary.
 */
export type StarknetNetwork = {
  readonly chainId: string;
  readonly id: StarknetNetworkId;
  readonly name: string;
  readonly rpcUrls: readonly [string, ...string[]];
};

/**
 * Supported Starknet networks and chain ids.
 */
export const STARKNET_NETWORKS: Readonly<Record<StarknetNetworkId, StarknetNetwork>> = {
  SN_MAIN: {
    chainId: "0x534e5f4d41494e",
    id: "SN_MAIN",
    name: "Starknet Mainnet",
    rpcUrls: ["https://api.cartridge.gg/x/starknet/mainnet"],
  },
  SN_SEPOLIA: {
    chainId: "0x534e5f5345504f4c4941",
    id: "SN_SEPOLIA",
    name: "Starknet Sepolia",
    rpcUrls: ["https://api.cartridge.gg/x/starknet/sepolia"],
  },
  SN_DEVNET: {
    chainId: "0x534e5f5345504f4c4941",
    id: "SN_DEVNET",
    name: "Local Devnet",
    rpcUrls: ["http://127.0.0.1:5050/rpc"],
  },
};

/**
 * ERC20 token metadata used by the default wallet home.
 */
export type DefaultToken = {
  readonly address: string;
  readonly decimals: number;
  readonly name: string;
  readonly networkId: StarknetNetworkId;
  readonly symbol: string;
};

const ETH_TOKEN_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRK_TOKEN_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/**
 * Default ERC20 tokens queried on each configured network.
 */
export const DEFAULT_TOKENS: readonly DefaultToken[] = [
  {
    address: ETH_TOKEN_ADDRESS,
    decimals: 18,
    name: "Ether",
    networkId: "SN_MAIN",
    symbol: "ETH",
  },
  {
    address: STRK_TOKEN_ADDRESS,
    decimals: 18,
    name: "Starknet Token",
    networkId: "SN_MAIN",
    symbol: "STRK",
  },
  {
    address: ETH_TOKEN_ADDRESS,
    decimals: 18,
    name: "Sepolia Ether",
    networkId: "SN_SEPOLIA",
    symbol: "ETH",
  },
  {
    address: STRK_TOKEN_ADDRESS,
    decimals: 18,
    name: "Sepolia Starknet Token",
    networkId: "SN_SEPOLIA",
    symbol: "STRK",
  },
  {
    address: ETH_TOKEN_ADDRESS,
    decimals: 18,
    name: "Devnet Ether",
    networkId: "SN_DEVNET",
    symbol: "ETH",
  },
  {
    address: STRK_TOKEN_ADDRESS,
    decimals: 18,
    name: "Devnet Starknet Token",
    networkId: "SN_DEVNET",
    symbol: "STRK",
  },
];

/**
 * Checks whether an untrusted value is one of the supported Starknet network ids.
 */
export const isStarknetNetworkId = (value: unknown): value is StarknetNetworkId =>
  typeof value === "string" && Object.hasOwn(STARKNET_NETWORKS, value);

/**
 * Resolves a configured network id from a Starknet chain id.
 */
export const networkIdForChainId = (chainId: string): StarknetNetworkId | null =>
  Object.values(STARKNET_NETWORKS).find((network) => network.chainId === chainId)?.id ?? null;

/**
 * Stark curve field modulus for validating hashes before signing.
 */
export const STARK_FIELD_PRIME = BigInt(
  "0x800000000000011000000000000000000000000000000000000000000000001",
);

const MAX_STARK_FIELD_HEX_DIGITS = 64;

/**
 * Checks whether a hex string is a Stark field element.
 */
export const isStarkFieldElement = (value: string): boolean =>
  /^0x[0-9a-f]+$/.test(value) &&
  value.length <= 2 + MAX_STARK_FIELD_HEX_DIGITS &&
  BigInt(value) < STARK_FIELD_PRIME;

/**
 * Checks whether a hex string is a non-zero Stark field element for key material.
 */
export const isNonZeroStarkFieldElement = (value: string): boolean =>
  isStarkFieldElement(value) && BigInt(value) > 0n;

/**
 * Default network for newly imported accounts.
 */
export const DEFAULT_NETWORK = STARKNET_NETWORKS.SN_MAIN;
