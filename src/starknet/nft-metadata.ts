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
  readonly attributes?: readonly NftAttribute[];
  readonly collection: string;
  readonly contract: string;
  readonly description?: string;
  readonly externalUrl?: string;
  readonly id: string;
  readonly image: string;
  readonly networkId: StarknetNetworkId;
  readonly name: string;
  readonly tokenId: string;
};

/**
 * One normalized NFT trait safe to render in the detail receipt.
 */
export type NftAttribute = {
  readonly displayType?: string;
  readonly traitType: string;
  readonly value: string;
};

const isTokenIdString = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_TOKEN_ID_DIGITS &&
  /^(?:0|[1-9][0-9]*)$/.test(value);

const isPrivateIpv4 = (hostname: string): boolean => {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first = 0, second = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
};

/**
 * Normalizes a public HTTPS NFT resource URL, rejecting credentials and
 * literal local/private hosts.
 */
export const normalizeNftHttpsUrl = (value: unknown): string => {
  if (typeof value !== "string" || value.length > MAX_IMAGE_URL_LENGTH) {
    return "";
  }
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.includes(":") ||
      isPrivateIpv4(hostname)
    ) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
};

/**
 * Builds the deterministic NFT id shared by discovered and watched collectibles.
 */
export const nftId = (networkId: StarknetNetworkId, contract: string, tokenId: string): string =>
  `${networkId}:${contract}:${tokenId}`;

// Trims and length-caps a free-text metadata field (name/collection), returning
// "" for anything that is not a usable string.
/**
 * Trims and length-caps an untrusted NFT metadata field.
 */
export const clampNftText = (value: unknown, maxLength = MAX_TEXT_LENGTH): string =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const isNftAttribute = (value: unknown): value is NftAttribute =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["displayType", "traitType", "value"]) &&
  (value["displayType"] === undefined ||
    (typeof value["displayType"] === "string" && value["displayType"].length <= 64)) &&
  typeof value["traitType"] === "string" &&
  value["traitType"].length > 0 &&
  value["traitType"].length <= MAX_TEXT_LENGTH &&
  typeof value["value"] === "string" &&
  value["value"].length > 0 &&
  value["value"].length <= 256;

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
    return path.length > 0 ? normalizeNftHttpsUrl(gatewayed) : "";
  }
  return normalizeNftHttpsUrl(trimmed);
};

/**
 * Checks a discovered-NFT record before it is trusted at the runtime boundary.
 */
export const isDiscoveredNft = (value: unknown): value is DiscoveredNft =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "attributes",
    "collection",
    "contract",
    "description",
    "externalUrl",
    "id",
    "image",
    "networkId",
    "name",
    "tokenId",
  ]) &&
  (value["attributes"] === undefined ||
    (Array.isArray(value["attributes"]) &&
      value["attributes"].length <= 32 &&
      value["attributes"].every(isNftAttribute))) &&
  typeof value["collection"] === "string" &&
  value["collection"].length <= MAX_TEXT_LENGTH &&
  typeof value["contract"] === "string" &&
  isNonZeroStarkFieldElement(value["contract"]) &&
  (value["description"] === undefined ||
    (typeof value["description"] === "string" && value["description"].length <= 1_024)) &&
  (value["externalUrl"] === undefined ||
    (typeof value["externalUrl"] === "string" &&
      (value["externalUrl"] === "" ||
        normalizeNftHttpsUrl(value["externalUrl"]) === value["externalUrl"]))) &&
  typeof value["name"] === "string" &&
  value["name"].length <= MAX_TEXT_LENGTH &&
  typeof value["image"] === "string" &&
  (value["image"] === "" || normalizeImageUrl(value["image"]) === value["image"]) &&
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
    collection: clampNftText(value["collection_name"]),
    contract,
    id: nftId(networkId, contract, tokenId),
    image: normalizeImageUrl(value["image_url"]),
    name: clampNftText(value["name"]),
    networkId,
    tokenId,
  };
};
