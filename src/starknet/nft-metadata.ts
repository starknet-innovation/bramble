/**
 * Pure shapes and normalization for auto-discovered NFTs.
 *
 * The auto-discovery indexer client, the background ownership verifier, and the
 * gallery UI all speak one definition of a discovered collectible, so the
 * parsing and image-URL normalization live here as pure helpers with no network
 * or DOM access. `normalizeIndexerNft` folds an untrusted indexer record into a
 * canonical {@link DiscoveredNft}; `isDiscoveredNft` re-checks the shape at the
 * background boundary before it is trusted. Ownership itself is proven over RPC
 * elsewhere (`owner_of`); nothing here authorizes a transfer.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "./networks";

const MAX_TOKEN_ID_DIGITS = 78;
const MAX_TEXT_LENGTH = 128;
const MAX_IMAGE_URL_LENGTH = 2048;
// Public IPFS gateway used to turn an `ipfs://` metadata URI into an https URL
// the side panel can render in an <img>. Only the host is fixed; the CID path is
// taken verbatim from the (untrusted) record and length-capped.
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

/**
 * A collectible the wallet auto-discovered for the active account. `image` is
 * always either an empty string (render the placeholder) or an https URL safe to
 * drop into an <img src>; `id` is the deterministic
 * `${networkId}:${contract}:${tokenId}` key shared with watched NFTs so the two
 * lists dedupe cleanly.
 */
export type DiscoveredNft = {
  readonly collection: string;
  readonly contract: string;
  readonly id: string;
  readonly image: string;
  readonly networkId: StarknetNetworkId;
  readonly name: string;
  readonly tokenId: string;
};

const isTokenIdString = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_TOKEN_ID_DIGITS &&
  /^(?:0|[1-9][0-9]*)$/.test(value);

const isHttpsImage = (value: string): boolean =>
  value.length <= MAX_IMAGE_URL_LENGTH && value.startsWith("https://");

/**
 * Builds the deterministic NFT id shared by discovered and watched collectibles.
 */
export const nftId = (networkId: StarknetNetworkId, contract: string, tokenId: string): string =>
  `${networkId}:${contract}:${tokenId}`;

// Trims and length-caps a free-text metadata field (name/collection), returning
// "" for anything that is not a usable string.
const clampText = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, MAX_TEXT_LENGTH) : "";

/**
 * Normalizes an untrusted image reference into an https URL the panel can
 * render, or "" when it is unusable. `ipfs://<cid>` is rewritten through a fixed
 * public gateway; https URLs pass through; everything else (http, data, gopher,
 * empty) collapses to "" so the gallery falls back to its placeholder.
 */
export const normalizeImageUrl = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("ipfs://")) {
    const path = trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
    const gatewayed = `${IPFS_GATEWAY}${path}`;
    return path.length > 0 && gatewayed.length <= MAX_IMAGE_URL_LENGTH ? gatewayed : "";
  }
  return isHttpsImage(trimmed) ? trimmed : "";
};

/**
 * Checks a discovered-NFT record before it is trusted at the runtime boundary.
 */
export const isDiscoveredNft = (value: unknown): value is DiscoveredNft =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "collection",
    "contract",
    "id",
    "image",
    "networkId",
    "name",
    "tokenId",
  ]) &&
  typeof value["collection"] === "string" &&
  value["collection"].length <= MAX_TEXT_LENGTH &&
  typeof value["contract"] === "string" &&
  isNonZeroStarkFieldElement(value["contract"]) &&
  typeof value["name"] === "string" &&
  value["name"].length <= MAX_TEXT_LENGTH &&
  typeof value["image"] === "string" &&
  (value["image"] === "" || isHttpsImage(value["image"])) &&
  isTokenIdString(value["tokenId"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  typeof value["id"] === "string" &&
  value["id"] === nftId(value["networkId"], value["contract"], value["tokenId"]);

/**
 * Folds one untrusted indexer record into a canonical {@link DiscoveredNft} for
 * the given network, or null when it lacks a usable contract/token id. The
 * documented wire fields are `contract_address`, `token_id`, and the optional
 * `name`, `collection_name`, and `image_url`. Contract addresses are
 * canonicalized to `0x`-hex and token ids to decimal so the derived id matches
 * the watched-NFT key exactly.
 */
export const normalizeIndexerNft = (
  value: unknown,
  networkId: StarknetNetworkId,
): DiscoveredNft | null => {
  if (!isRecord(value)) {
    return null;
  }
  const rawContract = value["contract_address"];
  if (typeof rawContract !== "string") {
    return null;
  }
  const contract = canonicalFelt(rawContract);
  if (contract === null || !isNonZeroStarkFieldElement(contract)) {
    return null;
  }
  const rawTokenId = value["token_id"];
  const tokenId =
    typeof rawTokenId === "string" || typeof rawTokenId === "number"
      ? String(rawTokenId).trim()
      : "";
  if (!isTokenIdString(tokenId)) {
    return null;
  }
  return {
    collection: clampText(value["collection_name"]),
    contract,
    id: nftId(networkId, contract, tokenId),
    image: normalizeImageUrl(value["image_url"]),
    name: clampText(value["name"]),
    networkId,
    tokenId,
  };
};
