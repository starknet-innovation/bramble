/**
 * Strict reader for Starkscan's NFT positions page
 * (`GET /v1/SN_MAIN/address/{address}/nft-positions`, schema
 * `AddressNftPositionsView`), as the SNF gateway passes it through unchanged.
 *
 * Trust boundary: the page is untrusted third-party data. It only suggests
 * which ERC-721 tokens an account may own; the background re-proves every
 * candidate with an on-chain ownership read before the gallery shows it or a
 * transfer is built, so the indexer suggests and the chain decides.
 *
 * Validation: every structural field the wallet reads is checked for type,
 * format and bounds, and anything malformed rejects the whole page (null), so
 * discovery reports "unavailable" rather than a partial or shifted list. The
 * page must name the schema version, the Mainnet chain and the exact owner the
 * wallet asked about. Fields the wallet does not read are ignored, so an added
 * Starkscan field cannot take discovery down. The collection name is the one
 * field a token's own deployer controls, so a bad name is dropped to "" rather
 * than refusing the page: one hostile airdrop must not hide every NFT.
 *
 * Coverage: Starkscan never claims global completeness (ERC-1155 and history
 * before its indexed floor are excluded). Only `status: "ready"` with
 * `completeWithinScope: true`, the documented ERC-721 scope, no reason code
 * other than the ERC-1155 exclusion (which the opt-in copy discloses; ERC-1155
 * is watch-only) and no further page is "complete". Anything else, including
 * `indexed_history_floor` or an unknown reason, is "incomplete", never "no NFTs".
 */
import { isRecord } from "@bramble/core/json";
import { trimTrailingSlashes } from "@bramble/core/service-url";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { type DiscoveredNft, nftId } from "./nft-metadata";

/**
 * The SNF gateway route that fronts Starkscan's Mainnet NFT positions and
 * holds the API key. Null until that route exists; while null, the wallet
 * never selects the Starkscan reader and no address leaves for it. Mainnet
 * only: Starkscan does not serve Sepolia, so no other network has a route.
 */
export const STARKSCAN_NFT_ROUTE: string | null = null;

/** Positions requested in the one page the wallet reads (Starkscan's maximum). */
export const STARKSCAN_NFT_PAGE_SIZE = 100;

/** The only network Starkscan NFT discovery runs on. */
export const STARKSCAN_NFT_NETWORK: StarknetNetworkId = "SN_MAIN";

const SCHEMA_VERSION = "starkscan.nft_positions.v1";
const CHAIN_ID = "SN_MAIN";
const DECLARED_SCOPE = "indexed_standard_erc721_transfers";
// The one exclusion the wallet discloses at opt-in; any other reason is a gap.
const DISCLOSED_EXCLUSION = "unsupported_erc1155";
const MAX_COLLECTION_NAME = 64;
const MAX_U256 = (1n << 256n) - 1n;

/** How complete one validated page says it is. */
export type StarkscanNftCoverage = "complete" | "incomplete";

/** One validated page: owned-token candidates plus its coverage. */
export type StarkscanNftPage = {
  readonly coverage: StarkscanNftCoverage;
  readonly nfts: readonly DiscoveredNft[];
};

/**
 * The URL the wallet calls for one address: `{route}/{address}/nft-positions`
 * with only `limit`. The address is canonical lowercase hex, and nothing else
 * about the account or wallet is sent.
 */
export const starkscanNftPositionsUrl = (route: string, address: string): string =>
  `${trimTrailingSlashes(route)}/${address}/nft-positions?limit=${STARKSCAN_NFT_PAGE_SIZE}`;

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

const safeName = (value: unknown): string => {
  if (typeof value !== "string" || value.length > MAX_COLLECTION_NAME) return "";
  if ([...value].some((char) => isUnsafeCode(char.codePointAt(0) ?? 0))) return "";
  return value.trim();
};

const isBlock = (value: unknown): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const feltOf = (value: unknown): string | null =>
  typeof value === "string" &&
  value.length <= 66 &&
  /^0x[0-9a-fA-F]+$/.test(value) &&
  isStarkFieldElement(value.toLowerCase())
    ? canonicalFelt(value)
    : null;

// Decimal digits or 0x-hex, at most a u256, returned as canonical decimal so
// the id matches a watched NFT's key exactly.
const tokenIdOf = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const decimal = /^[0-9]{1,78}$/.test(value);
  if (!decimal && !/^0x[0-9a-fA-F]{1,64}$/.test(value)) return null;
  const id = BigInt(value);
  return id <= MAX_U256 ? id.toString() : null;
};

const COLLECTION_STATUSES: readonly unknown[] = ["indexed", "unavailable"];

const readCollection = (value: unknown): string | null => {
  if (!isRecord(value) || !COLLECTION_STATUSES.includes(value["metadataStatus"])) return null;
  const { name, symbol } = value;
  if (![name, symbol].every((field) => field === null || typeof field === "string")) return null;
  return value["metadataStatus"] === "indexed" ? safeName(name) : "";
};

const readItem = (value: unknown, networkId: StarknetNetworkId): DiscoveredNft | null => {
  if (!isRecord(value)) return null;
  const contract = feltOf(value["tokenAddress"]);
  const tokenId = tokenIdOf(value["tokenId"]);
  const collection = readCollection(value["collection"]);
  if (
    contract === null ||
    !isNonZeroStarkFieldElement(contract) ||
    tokenId === null ||
    collection === null ||
    value["standard"] !== "erc721" ||
    value["evidenceSource"] !== "indexed_erc721_ownership" ||
    !isBlock(value["observedAtBlock"]) ||
    feltOf(value["lastTransferHash"]) === null
  ) {
    return null;
  }
  return {
    collection,
    contract,
    id: nftId(networkId, contract, tokenId),
    image: "",
    name: "",
    networkId,
    tokenId,
  };
};

const COVERAGE_STATUSES: readonly unknown[] = ["ready", "partial"];

// Null when malformed; otherwise whether this page's coverage is complete.
const readCoverage = (value: unknown): boolean | null => {
  if (
    !isRecord(value) ||
    !COVERAGE_STATUSES.includes(value["status"]) ||
    typeof value["completeWithinScope"] !== "boolean" ||
    typeof value["globallyComplete"] !== "boolean" ||
    typeof value["declaredScope"] !== "string" ||
    !Array.isArray(value["reasonCodes"]) ||
    !value["reasonCodes"].every((code) => typeof code === "string") ||
    !isBlock(value["indexedFromBlock"]) ||
    !isBlock(value["indexedThroughBlock"])
  ) {
    return null;
  }
  return (
    value["status"] === "ready" &&
    value["completeWithinScope"] === true &&
    value["declaredScope"] === DECLARED_SCOPE &&
    value["reasonCodes"].every((code) => code === DISCLOSED_EXCLUSION)
  );
};

const readItems = (value: unknown, networkId: StarknetNetworkId): DiscoveredNft[] | null => {
  if (!Array.isArray(value) || value.length > STARKSCAN_NFT_PAGE_SIZE) return null;
  const nfts: DiscoveredNft[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const nft = readItem(item, networkId);
    if (nft === null || seen.has(nft.id)) return null;
    seen.add(nft.id);
    nfts.push(nft);
  }
  return nfts;
};

/**
 * Validates one page for `owner` on Mainnet. Returns null when the page is
 * malformed, out of bounds, for another chain or another owner, so the caller
 * reports discovery as unavailable; otherwise the candidates (still to be
 * re-proved on chain) and whether the coverage is complete.
 */
export const parseStarkscanNftPage = (
  body: unknown,
  owner: string,
  networkId: StarknetNetworkId,
): StarkscanNftPage | null => {
  if (
    networkId !== STARKSCAN_NFT_NETWORK ||
    !isRecord(body) ||
    body["schemaVersion"] !== SCHEMA_VERSION ||
    body["chainId"] !== CHAIN_ID ||
    typeof body["hasMore"] !== "boolean" ||
    !(body["nextCursor"] === null || typeof body["nextCursor"] === "string") ||
    !isBlock(body["snapshotBlock"])
  ) {
    return null;
  }
  const pageOwner = feltOf(body["ownerAddress"]);
  if (pageOwner === null || !sameFelt(pageOwner, owner)) return null;
  const complete = readCoverage(body["coverage"]);
  const nfts = readItems(body["items"], networkId);
  if (complete === null || nfts === null) return null;
  return {
    coverage: complete && body["hasMore"] === false ? "complete" : "incomplete",
    nfts,
  };
};
