/**
 * Safe ERC721/ERC1155 metadata-URI decoding and remote resolution.
 *
 * On-chain data URIs are decoded locally. HTTPS/IPFS metadata is fetched only
 * when the caller explicitly opts in (the background does this for manually
 * watched NFTs), with credentials omitted, redirects rejected, response bytes
 * capped, and private/local hosts refused. Every JSON field is normalized
 * before it can cross into the side panel.
 */
import { isRecord } from "../shared/json";
import {
  clampNftText,
  type NftAttribute,
  normalizeAnimationUri,
  normalizeImageUrl,
  normalizeNftHttpsUrl,
} from "./nft-metadata";

const MAX_DATA_URI_BYTES = 32_768;
const MAX_METADATA_BYTES = 65_536;
const MAX_ATTRIBUTES = 32;

/**
 * Display-safe metadata resolved for one ERC721 or ERC1155 token.
 */
export type NftTokenMetadata = {
  readonly animationUrl: string;
  readonly attributes: readonly NftAttribute[];
  readonly collection: string;
  readonly description: string;
  readonly externalUrl: string;
  readonly image: string;
  readonly name: string;
};

/**
 * Injected HTTPS transport used for metadata documents.
 */
export type NftMetadataHttp = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, "body" | "headers" | "ok" | "text" | "url">>;

const decodedSize = (value: string): number => new TextEncoder().encode(value).length;

const decodeDataUri = (uri: string): string | null => {
  const comma = uri.indexOf(",");
  if (comma < 0) {
    return null;
  }
  const header = uri.slice(0, comma).toLowerCase();
  if (
    header !== "data:application/json" &&
    header !== "data:application/json;charset=utf-8" &&
    header !== "data:application/json;base64" &&
    header !== "data:application/json;charset=utf-8;base64"
  ) {
    return null;
  }
  try {
    const payload = uri.slice(comma + 1);
    const decoded = header.endsWith(";base64")
      ? new TextDecoder().decode(
          Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)),
        )
      : decodeURIComponent(payload);
    return decodedSize(decoded) <= MAX_DATA_URI_BYTES ? decoded : null;
  } catch {
    return null;
  }
};

const normalizedExternalUrl = (value: unknown): string => {
  return normalizeNftHttpsUrl(value);
};

const normalizedAttribute = (value: unknown): NftAttribute | null => {
  if (!isRecord(value)) {
    return null;
  }
  const rawValue = value["value"];
  if (
    typeof rawValue !== "string" &&
    typeof rawValue !== "number" &&
    typeof rawValue !== "boolean"
  ) {
    return null;
  }
  const traitType = clampNftText(value["trait_type"], 128);
  const attributeValue = clampNftText(String(rawValue), 256);
  if (!traitType || !attributeValue) {
    return null;
  }
  const displayType = clampNftText(value["display_type"], 64);
  return {
    ...(displayType ? { displayType } : {}),
    traitType,
    value: attributeValue,
  };
};

const metadataFromJson = (text: string): NftTokenMetadata | null => {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) {
      return null;
    }
    const rawCollection = value["collection"];
    const collection = clampNftText(
      isRecord(rawCollection) ? rawCollection["name"] : rawCollection,
      128,
    );
    const attributes = Array.isArray(value["attributes"])
      ? value["attributes"]
          .slice(0, MAX_ATTRIBUTES)
          .map(normalizedAttribute)
          .filter((attribute): attribute is NftAttribute => attribute !== null)
      : [];
    const metadata: NftTokenMetadata = {
      animationUrl: normalizeAnimationUri(value["animation_url"]),
      attributes,
      collection,
      description: clampNftText(value["description"], 1_024),
      externalUrl: normalizedExternalUrl(value["external_url"]),
      image: normalizeImageUrl(value["image"]),
      name: clampNftText(value["name"], 128),
    };
    return Object.values(metadata).some((field) =>
      Array.isArray(field) ? field.length > 0 : field.length > 0,
    )
      ? metadata
      : null;
  } catch {
    return null;
  }
};

const safeMetadataUrl = (uri: string): string | null => {
  const normalized = normalizeImageUrl(uri);
  return normalized || null;
};

const limitedResponseText = async (
  response: Pick<Response, "body" | "headers" | "text">,
): Promise<string | null> => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_METADATA_BYTES) {
    return null;
  }
  if (!response.body) {
    const text = await response.text();
    return decodedSize(text) <= MAX_METADATA_BYTES ? text : null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      return text + decoder.decode();
    }
    bytes += chunk.value.byteLength;
    if (bytes > MAX_METADATA_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
};

/**
 * Resolves an ERC721 or ERC1155 metadata URI into display-safe fields.
 *
 * Percent-encoded and Base64 JSON data URIs are handled locally so already
 * minted tokens remain compatible. Remote metadata is limited to public HTTPS
 * (including IPFS through the fixed gateway), and any fault returns null rather
 * than breaking NFT ownership or transfer operations.
 */
export const resolveNftMetadataUri = async (
  uri: string,
  http: NftMetadataHttp,
): Promise<NftTokenMetadata | null> => {
  if (decodedSize(uri) > MAX_DATA_URI_BYTES) {
    return null;
  }
  if (uri.startsWith("data:")) {
    const decoded = decodeDataUri(uri);
    return decoded === null ? null : metadataFromJson(decoded);
  }
  const url = safeMetadataUrl(uri);
  if (url === null) {
    return null;
  }
  try {
    const response = await http(url, {
      credentials: "omit",
      headers: { accept: "application/json" },
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok || (response.url && safeMetadataUrl(response.url) === null)) {
      return null;
    }
    const text = await limitedResponseText(response);
    return text === null ? null : metadataFromJson(text);
  } catch {
    return null;
  }
};
