/**
 * Starknet network constants kept separate from UI and storage code.
 */
import { validateAndParseAddress } from "starknet";

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
    rpcUrls: ["https://mainnet.nodes.starknet.org/rpc/v0_10"],
  },
  SN_SEPOLIA: {
    chainId: "0x534e5f5345504f4c4941",
    id: "SN_SEPOLIA",
    name: "Starknet Sepolia",
    rpcUrls: ["https://api.cartridge.gg/x/starknet/sepolia"],
  },
  SN_DEVNET: {
    // starknet-devnet ships with SN_SEPOLIA's on-chain chain id
    // (0x534e5f5345504f4c4941) by default, which collides with the Sepolia
    // network above and makes `networkIdForChainId` non-deterministic. We use a
    // distinct sentinel — the short-string encoding of "SN_DEVNET" — so devnet
    // resolves unambiguously and chain switching cannot silently alias Sepolia.
    // The node must agree: start it with `--chain-id SN_DEVNET`, because the
    // write path checks this value against `starknet_chainId` and a default
    // devnet (which reports Sepolia's id) fails closed with "RPC endpoint
    // returned the wrong Starknet chain".
    chainId: "0x534e5f4445564e4554",
    id: "SN_DEVNET",
    name: "Local Devnet",
    rpcUrls: ["http://127.0.0.1:5050/rpc"],
  },
};

/**
 * Stark curve field modulus for validating hashes before signing.
 */
const STARK_FIELD_PRIME = BigInt(
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

/**
 * Canonicalizes a Starknet address through starknet.js validation and padding.
 * Invalid inputs return null so untrusted API metadata fails closed.
 */
export const canonicalAddress = (value: string): string | null => {
  try {
    return validateAndParseAddress(value).toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Compares two Starknet addresses after library-backed validation.
 */
export const sameAddress = (left: string, right: string): boolean => {
  const canonicalLeft = canonicalAddress(left);
  return canonicalLeft !== null && canonicalLeft === canonicalAddress(right);
};
