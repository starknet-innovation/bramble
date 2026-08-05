/**
 * Starknet network constants kept separate from UI and storage code.
 */
export type StarknetNetworkId = "SN_MAIN" | "SN_SEPOLIA" | "SN_DEVNET";

/**
 * Starknet network metadata used for account derivation and display.
 * `rpcUrls` is an ordered failover list; the first entry is the primary.
 * `explorerBaseUrl` is the public block explorer for outbound transaction
 * links; networks without one (devnet) simply omit it and are never linked.
 */
export type StarknetNetwork = {
  readonly chainId: string;
  readonly explorerBaseUrl?: string;
  readonly id: StarknetNetworkId;
  readonly name: string;
  readonly rpcUrls: readonly [string, ...string[]];
};

/**
 * Supported Starknet networks and chain ids.
 *
 * Mainnet and Sepolia prefer the Starknet Foundation's public nodes on RPC
 * spec v0.10, which need no API key and report `PRE_CONFIRMED` finality.
 * Mainnet stays on the proof-facts-capable Foundation endpoint; Sepolia keeps
 * Cartridge as a read/write availability fallback. Requests originate in the
 * MV3 service worker, where the manifest's explicit host permissions apply.
 */
export const STARKNET_NETWORKS: Readonly<Record<StarknetNetworkId, StarknetNetwork>> = {
  SN_MAIN: {
    chainId: "0x534e5f4d41494e",
    explorerBaseUrl: "https://starkscan.co",
    id: "SN_MAIN",
    name: "Starknet Mainnet",
    rpcUrls: ["https://mainnet.nodes.starknet.org/rpc/v0_10"],
  },
  SN_SEPOLIA: {
    chainId: "0x534e5f5345504f4c4941",
    explorerBaseUrl: "https://sepolia.starkscan.co",
    id: "SN_SEPOLIA",
    name: "Starknet Sepolia",
    rpcUrls: [
      "https://sepolia.nodes.starknet.org/rpc/v0_10",
      "https://api.cartridge.gg/x/starknet/sepolia",
    ],
  },
  SN_DEVNET: {
    // starknet-devnet ships with SN_SEPOLIA's on-chain chain id
    // (0x534e5f5345504f4c4941) by default, which collides with the Sepolia
    // network above and makes `networkIdForChainId` non-deterministic. We use a
    // distinct sentinel — the short-string encoding of "SN_DEVNET" — so devnet
    // resolves unambiguously and chain switching cannot silently alias Sepolia.
    // Nothing in the wallet depends on the literal devnet chain id.
    chainId: "0x534e5f4445564e4554",
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

/**
 * Canonical STRK contract used as the trusted bundled Starknet network mark.
 */
export const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

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
 *
 * Each configured network carries a distinct `chainId` (devnet uses a sentinel
 * rather than reusing Sepolia's on-chain id), so this lookup is deterministic:
 * insertion order is stable and no two networks share a chain id. Returns
 * `null` for any chain id the wallet is not configured for.
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

// One gate for every explorer link: a network with no explorer (devnet) and a
// felt that is not well formed both yield null, so no caller can build a URL
// that cannot resolve.
const explorerUrl = (networkId: string, path: string, felt: string): string | null => {
  const base = isStarknetNetworkId(networkId)
    ? STARKNET_NETWORKS[networkId].explorerBaseUrl
    : undefined;
  return base === undefined || !isNonZeroStarkFieldElement(felt) ? null : `${base}/${path}/${felt}`;
};

/**
 * Builds the public explorer URL for a transaction, or `null` when the network
 * has no explorer (devnet) or the hash is not a well-formed field element. A
 * caller that receives `null` must render no link rather than a broken one.
 */
export const explorerTransactionUrl = (networkId: string, hash: string): string | null =>
  explorerUrl(networkId, "tx", hash);

/**
 * Builds the public explorer URL for an account, or `null` under the same rules
 * as {@link explorerTransactionUrl}. Starknet accounts are contracts, so the
 * account view lives under the explorer's contract path.
 */
export const explorerAccountUrl = (networkId: string, address: string): string | null =>
  explorerUrl(networkId, "contract", address);

/**
 * Stark curve group order (n). Valid Stark signing scalars live in [1, n).
 * Distinct from — and strictly smaller than — STARK_FIELD_PRIME, which bounds
 * field elements (hashes, coordinates, class hashes). The ~2^126-wide gap
 * [n, P) holds field elements that are NOT valid private keys: a key there is
 * reduced mod n when signing, so it would derive an account for a different
 * effective scalar than the one the user pasted.
 */
const STARK_CURVE_ORDER = BigInt(
  "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f",
);

/**
 * Checks whether a hex string is a valid Stark private key: a non-zero,
 * canonical, lowercase field element strictly below the curve order. Use this
 * — never isNonZeroStarkFieldElement — to validate a raw signing key, so keys
 * in the [curve order, field prime) gap are rejected rather than silently
 * reduced mod n by the signer.
 */
export const isStarkPrivateKey = (value: string): boolean =>
  isNonZeroStarkFieldElement(value) && BigInt(value) < STARK_CURVE_ORDER;

/**
 * Compares two candidate field elements by numeric value. Non-numeric inputs
 * never compare equal. This is the one shared implementation — do not
 * re-derive it locally (three copies once drifted across features).
 */
export const sameFelt = (left: unknown, right: unknown): boolean => {
  if (typeof left !== "string" || typeof right !== "string" || !left || !right) {
    return false;
  }
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
};

/**
 * Parses a felt-shaped string into its bigint value, or null when the input is
 * not a non-empty numeric string. The one shared felt parser — decode calldata
 * felts through this rather than re-deriving the BigInt guard locally.
 */
export const asFelt = (value: unknown): bigint | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

/**
 * Normalizes a numeric string into the canonical `0x`-hex felt form, or null
 * when the value is not numeric. Callers needing throw-on-invalid semantics
 * wrap this rather than re-deriving the conversion.
 */
export const canonicalFelt = (value: string): string | null => {
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return null;
  }
};

/**
 * Checks whether a value is a chain id in lowercase `0x`-hex form. The loose
 * form used when reading an already-canonical chain id off an internal message
 * or a provider event: it accepts any length and `0x0`, matching how the
 * extension emits chain ids. Do not re-derive this regex locally.
 */
export const isHexChainId = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]+$/.test(value);

/**
 * Checks whether a value is a canonical chain id: a positive `0x`-hex felt of
 * 1..64 digits, accepting either case. The strict form used when accepting a
 * chain id from a dapp (`wallet_addStarknetChain`) or persisting a custom
 * network. Do not re-derive this locally.
 */
export const isCanonicalChainId = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value) && BigInt(value) > 0n;

/**
 * Normalizes a pasted felt/address input so a checksummed (mixed-case) `0x`
 * address survives the strict, lowercase-only field-element check. Hex is
 * case-insensitive, so an uppercase/checksummed address denotes the same felt
 * as its lowercase spelling; this canonicalizes it via `canonicalFelt` rather
 * than re-deriving the conversion. Non-`0x` input (empty, a name, a decimal) is
 * only trimmed and returned unchanged, so it still fails the field-element
 * check downstream — this never widens what counts as a valid address.
 */
export const normalizeFeltInput = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.startsWith("0x") ? (canonicalFelt(trimmed) ?? trimmed) : trimmed;
};

/**
 * Default network for newly imported accounts.
 */
export const DEFAULT_NETWORK = STARKNET_NETWORKS.SN_MAIN;
