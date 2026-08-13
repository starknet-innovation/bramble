/**
 * Curated Starknet token registry plus spam heuristics.
 *
 * Addresses and decimals below are vendored from public Starknet token lists
 * (Cartridge, StarkScan, Voyager, the Starknet ecosystem token list). They are
 * marked VERIFY where the canonical contract has moved between deployments;
 * treat auto-detection as advisory: a wrong address simply fails its balance
 * probe and is never surfaced, and none of this data authorizes a transfer.
 */

import {
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { type TokenConfig, withTokenId } from "@mc-wallet/wallet-model/preferences";

/**
 * A registry token without its derived preference id.
 */
export type RegistryToken = Omit<TokenConfig, "id">;

/**
 * Reason a token is treated as likely spam. `symbol-spoof` means the token
 * borrows a registry symbol (after confusable folding) from a different
 * contract; `absurd-decimals` and `empty-name` catch malformed metadata.
 */
export type SpamReason = "absurd-decimals" | "empty-name" | "symbol-spoof";

/**
 * Decimals above this are treated as absurd; real ERC20 tokens stay well under.
 */
const MAX_PLAUSIBLE_DECIMALS = 24;

// Canonical mainnet contracts. ETH and STRK match wallet-model/networks.
const MAINNET_TOKENS: readonly RegistryToken[] = [
  {
    address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
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
    address: "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
    decimals: 6,
    name: "USD Coin",
    networkId: "SN_MAIN",
    symbol: "USDC",
  },
  {
    address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    decimals: 6,
    name: "Bridged USDC",
    networkId: "SN_MAIN",
    symbol: "USDC.e",
  },
  {
    // VERIFY: Bridged Tether USD on Starknet mainnet.
    address: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
    decimals: 6,
    name: "Tether USD",
    networkId: "SN_MAIN",
    symbol: "USDT",
  },
  {
    // VERIFY: DAI v0; a v2 contract also circulates. Both are advisory only.
    address: "0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3",
    decimals: 18,
    name: "Dai Stablecoin",
    networkId: "SN_MAIN",
    symbol: "DAI",
  },
  {
    // VERIFY: Wrapped BTC on Starknet mainnet (8 decimals).
    address: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
    decimals: 8,
    name: "Wrapped BTC",
    networkId: "SN_MAIN",
    symbol: "WBTC",
  },
];

const REGISTRY: Readonly<Record<StarknetNetworkId, readonly RegistryToken[]>> = {
  SN_DEVNET: [],
  SN_MAIN: MAINNET_TOKENS,
  SN_SEPOLIA: [],
};

// Additional legitimate contracts that share a registry symbol (native vs
// bridged deployments, versioned redeploys). Addresses here are treated as
// genuine and never flagged as symbol-spoofs. Keyed by registry symbol.
// VERIFY each address against a public Starknet token list before trusting it.
const LEGITIMATE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Some legacy metadata still reports the StarkGate token as "USDC" rather
  // than "USDC.e"; accept that exact deployment without trusting lookalikes.
  USDC: ["0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"],
};

// Multi-character homoglyph sequences collapsed before single-glyph folding so
// "VV"->"W" and "rn"->"m" style spoofs resolve to their target ticker.
const MULTI_CONFUSABLES: readonly (readonly [RegExp, string])[] = [
  [/vv/g, "w"],
  [/rn/g, "m"],
];

// Folds glyphs that scammers swap in to fake a well-known ticker. Covers
// digit->letter swaps plus common ASCII letter homoglyphs (v->u, i/1->l).
const CONFUSABLES: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  i: "l",
  v: "u",
};

const foldSymbol = (symbol: string): string => {
  const stripped = symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
  const collapsed = MULTI_CONFUSABLES.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    stripped,
  );
  return collapsed
    .split("")
    .map((character) => CONFUSABLES[character] ?? character)
    .join("");
};

/**
 * Returns the curated known tokens for a network, each carrying its derived
 * preference id so callers can probe balances or compare against tracked
 * tokens directly.
 */
export const knownTokensForNetwork = (networkId: StarknetNetworkId): readonly TokenConfig[] =>
  // Through the one shared id builder, never a local interpolation of the same
  // three fields: a curated entry and a user-added entry for the same token must
  // land on the same id, or "already tracked" comparisons silently miss.
  REGISTRY[networkId].map(withTokenId);

/**
 * Metadata shape scored by the spam heuristics; accepts both stored token
 * configs and freshly fetched on-chain metadata.
 */
export type SpamCandidate = {
  readonly address: string;
  readonly decimals: number;
  readonly name: string;
  readonly networkId: StarknetNetworkId;
  readonly symbol: string;
};

/**
 * Scores a token against the spam heuristics, returning every reason it looks
 * suspicious. An empty array means nothing tripped.
 */
export const tokenSpamReasons = (token: SpamCandidate): readonly SpamReason[] => {
  const reasons: SpamReason[] = [];
  if (token.name.trim().length === 0) {
    reasons.push("empty-name");
  }
  if (!Number.isSafeInteger(token.decimals) || token.decimals > MAX_PLAUSIBLE_DECIMALS) {
    reasons.push("absurd-decimals");
  }
  const folded = foldSymbol(token.symbol);
  const spoofs = knownTokensForNetwork(token.networkId).some((known) => {
    if (foldSymbol(known.symbol) !== folded || sameFelt(known.address, token.address)) {
      return false;
    }
    // A different contract sharing the symbol is only genuine when it is an
    // explicitly allowlisted alternate deployment of that ticker.
    const aliases = LEGITIMATE_ALIASES[known.symbol] ?? [];
    return !aliases.some((alias) => sameFelt(alias, token.address));
  });
  if (spoofs) {
    reasons.push("symbol-spoof");
  }
  return reasons;
};

/**
 * Checks whether a token trips any spam heuristic and should be hidden by
 * default.
 */
export const isLikelySpam = (token: SpamCandidate): boolean => tokenSpamReasons(token).length > 0;
