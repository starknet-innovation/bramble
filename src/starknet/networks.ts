/**
 * Starknet network constants kept separate from UI and storage code.
 */
export type StarknetNetworkId = "SN_MAIN" | "SN_SEPOLIA";

/**
 * Starknet network metadata used for account derivation and display.
 */
export type StarknetNetwork = {
  readonly chainId: string;
  readonly id: StarknetNetworkId;
  readonly name: string;
};

/**
 * Supported Starknet networks and chain ids.
 */
export const STARKNET_NETWORKS: Readonly<Record<StarknetNetworkId, StarknetNetwork>> = {
  SN_MAIN: {
    chainId: "0x534e5f4d41494e",
    id: "SN_MAIN",
    name: "Starknet Mainnet",
  },
  SN_SEPOLIA: {
    chainId: "0x534e5f5345504f4c4941",
    id: "SN_SEPOLIA",
    name: "Starknet Sepolia",
  },
};

/**
 * Checks whether an untrusted value is one of the supported Starknet network ids.
 */
export const isStarknetNetworkId = (value: unknown): value is StarknetNetworkId =>
  typeof value === "string" && Object.hasOwn(STARKNET_NETWORKS, value);

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
export const DEFAULT_NETWORK = STARKNET_NETWORKS.SN_SEPOLIA;
