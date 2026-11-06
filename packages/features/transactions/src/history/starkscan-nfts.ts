/**
 * Starkscan as the Collectibles preview's built-in NFT indexer, over the
 * wallet's existing Starkscan connection (the same client, per-network base
 * override, untrusted HTTP transport and `explorerFallback` gate as Activity).
 *
 * Trust boundary: a positions page only suggests which ERC-721 tokens an
 * account may own. The background re-proves every candidate on chain before
 * the gallery shows it or a transfer is built: the indexer suggests, the chain
 * decides. The page must answer for Mainnet and for the exact address asked
 * about; token ids must fit a u256 and positions must be unique, or the page is
 * refused. The collection name is the one deployer-controlled field, so a bad
 * name is dropped to "" rather than refusing the page.
 *
 * Coverage: Starkscan never claims global completeness. A page is "complete"
 * only when it is `ready`, complete within the documented ERC-721 scope, names
 * no gap other than the ERC-1155 exclusion (which the opt-in copy discloses;
 * ERC-1155 stays watch-only) and has no further page. Anything else is
 * "incomplete"; any failure is "unavailable"; neither is ever "no NFTs".
 *
 * Mainnet only: Starkscan does not serve Sepolia positions, so no other network
 * sends a request.
 */
import type { NftDiscovery, StarkscanNftSource } from "@bramble/portfolio/nft-indexer";
import { type DiscoveredNft, nftId } from "@bramble/portfolio/nft-metadata";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { StarkscanNftPositions } from "./starkscan-types";
import {
  type ExplorerLaneReadOptions,
  gatewayClientFor,
  gatewayPreferencesFor,
} from "./starkscan-wallet";

/** The one network Starkscan NFT discovery runs on. */
export const STARKSCAN_NFT_NETWORK: StarknetNetworkId = "SN_MAIN";
/** Positions read in the one page the wallet requests (Starkscan's maximum). */
export const STARKSCAN_NFT_PAGE_SIZE = 100;

const DECLARED_SCOPE = "indexed_standard_erc721_transfers";
// The one exclusion the wallet discloses at opt-in; any other reason is a gap.
const DISCLOSED_EXCLUSION = "unsupported_erc1155";
const MAX_COLLECTION_NAME = 64;
const MAX_U256 = (1n << 256n) - 1n;
const NONE: NftDiscovery = { coverage: "none", nfts: [] };
const UNAVAILABLE: NftDiscovery = { coverage: "unavailable", nfts: [] };

// C0/C1 controls, and every Unicode Bidi_Control character (marks, embeddings,
// overrides, isolates) that can reorder text.
const isUnsafeCode = (code: number): boolean =>
  code <= 0x1f ||
  (code >= 0x7f && code <= 0x9f) ||
  code === 0x061c ||
  code === 0x200e ||
  code === 0x200f ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);

const safeName = (value: string | null, indexed: boolean): string => {
  if (!indexed || value === null || value.length > MAX_COLLECTION_NAME) return "";
  if ([...value].some((char) => isUnsafeCode(char.codePointAt(0) ?? 0))) return "";
  return value.trim();
};

const isComplete = (page: StarkscanNftPositions): boolean =>
  page.coverage.status === "ready" &&
  page.coverage.completeWithinScope &&
  page.coverage.declaredScope === DECLARED_SCOPE &&
  page.coverage.reasonCodes.every((code) => code === DISCLOSED_EXCLUSION) &&
  !page.hasMore;

/**
 * Folds one parsed page for `owner` into canonical candidates and coverage, or
 * null when the page answers for another chain or owner, or holds a zero
 * contract, a token id past u256, or a duplicate position.
 */
export const nftDiscoveryFromPositions = (
  page: StarkscanNftPositions,
  owner: string,
): NftDiscovery | null => {
  if (page.chainId !== STARKSCAN_NFT_NETWORK || !sameFelt(page.ownerAddress, owner)) return null;
  const nfts: DiscoveredNft[] = [];
  const seen = new Set<string>();
  for (const item of page.items) {
    const contract = canonicalFelt(item.tokenAddress);
    const id = BigInt(item.tokenId);
    if (contract === null || !isNonZeroStarkFieldElement(contract) || id > MAX_U256) return null;
    const tokenId = id.toString();
    const key = nftId(STARKSCAN_NFT_NETWORK, contract, tokenId);
    if (seen.has(key)) return null;
    seen.add(key);
    nfts.push({
      collection: safeName(item.collectionName, item.collectionIndexed),
      contract,
      id: key,
      image: "",
      name: "",
      networkId: STARKSCAN_NFT_NETWORK,
      tokenId,
    });
  }
  return { coverage: isComplete(page) ? "complete" : "incomplete", nfts };
};

/**
 * Builds the built-in NFT source over the wallet's Starkscan connection. Off
 * Mainnet, or when the user's `explorerFallback` choice keeps the explorer
 * from this network, it sends nothing and reports "none". Any client error
 * (transport, HTTP status, cooldown, malformed page) is "unavailable".
 */
export const createStarkscanNftSource =
  (options: ExplorerLaneReadOptions): StarkscanNftSource =>
  async ({ address, networkId }) => {
    if (networkId !== STARKSCAN_NFT_NETWORK) return NONE;
    const preferences = await gatewayPreferencesFor(options.readPreferences, networkId);
    if (preferences === null) return NONE;
    try {
      const page = await gatewayClientFor(options, networkId, preferences).getAddressNftPositions(
        STARKSCAN_NFT_NETWORK,
        address,
        STARKSCAN_NFT_PAGE_SIZE,
      );
      return nftDiscoveryFromPositions(page, address) ?? UNAVAILABLE;
    } catch {
      return UNAVAILABLE;
    }
  };
