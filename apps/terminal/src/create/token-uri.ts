/**
 * Token URI rules for Create. Pure: nothing here fetches a URI. The terminal
 * never requests a user-supplied URI; it only checks the text, so a base URI
 * or image URI it accepts is one the Bramble wallet will later read (public
 * https, or ipfs through its fixed gateway).
 *
 * How the pinned OpenZeppelin v3.0.0 presets resolve a token's URI:
 * - ERC-721 `token_uri(id)` returns the base URI followed by the id in
 *   decimal, so base `ipfs://cid/` gives `ipfs://cid/7`.
 * - ERC-1155 `uri(id)` returns the base URI unchanged. Per EIP-1155, readers
 *   replace `{id}` with the id as 64 lowercase hex digits, so one base URI can
 *   still point at one file per token.
 */
import type { TokenStandard } from "./token-presets";

/** On-chain base URI cap: it is stored in the contract, so keep it short. */
const MAX_BASE_URI_LENGTH = 200;
/** Off-chain image URI cap; matches the wallet's NFT image URL bound. */
export const MAX_IMAGE_URI_LENGTH = 2048;

const URI_PATTERN = /^(?:https|ipfs):\/\/[\x21-\x7e]+$/;
const ID_PLACEHOLDER = "{id}";
const FILE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

const isPublicHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host.includes(".") &&
    !host.includes(":") &&
    !host.startsWith("[") &&
    !/^[0-9.]+$/.test(host) &&
    !host.endsWith(".localhost") &&
    !host.endsWith(".local")
  );
};

/**
 * True for an `https://` URL on a public hostname (no credentials, no IP
 * literal, no localhost or `.local` name) or a non-empty `ipfs://` path, with
 * no spaces or control characters and at most `maxLength` characters.
 */
export const isPublicTokenUri = (value: string, maxLength: number): boolean => {
  if (value.length > maxLength || !URI_PATTERN.test(value)) return false;
  if (value.startsWith("ipfs://")) return value.length > "ipfs://".length;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && isPublicHost(url.hostname);
  } catch {
    return false;
  }
};

/**
 * Validates a collection base URI for the given standard and returns it
 * trimmed. Throws a user-facing sentence when it is not a public https or ipfs
 * URI, or when an ERC-721 base uses `{id}` (that preset appends the id).
 */
export const readBaseUri = (value: string, standard: TokenStandard): string => {
  const uri = value.trim();
  if (!isPublicTokenUri(uri, MAX_BASE_URI_LENGTH)) {
    throw new Error(
      `Base URI must be a public https:// or ipfs:// address, with no spaces, up to ${MAX_BASE_URI_LENGTH} characters.`,
    );
  }
  if (standard === "erc721" && uri.includes(ID_PLACEHOLDER)) {
    throw new Error("An ERC-721 base URI can't contain {id}. The token id is added to the end.");
  }
  return uri;
};

/** The id as EIP-1155 `{id}` text: 64 lowercase hex digits, no `0x`. */
export const erc1155IdText = (tokenId: bigint): string => tokenId.toString(16).padStart(64, "0");

/**
 * The URI a reader resolves for one token, exactly as the pinned preset and
 * EIP-1155 define it (see the module comment).
 */
export const resolveTokenUri = (standard: "erc721" | "erc1155", baseUri: string, tokenId: bigint): string =>
  standard === "erc721"
    ? `${baseUri}${tokenId.toString()}`
    : baseUri.replaceAll(ID_PLACEHOLDER, erc1155IdText(tokenId));

/** True when every ERC-1155 token id resolves to the same file. */
export const isSharedErc1155Uri = (baseUri: string): boolean => !baseUri.includes(ID_PLACEHOLDER);

/**
 * The file name to host the metadata under: the resolved URI's last path
 * segment when it is a plain file name, otherwise `<id>.json`.
 */
export const metadataFileName = (tokenUri: string | null, tokenId: bigint): string => {
  const segment =
    tokenUri
      ?.replace(/[?#].*$/, "")
      .split("/")
      .pop() ?? "";
  return FILE_NAME_PATTERN.test(segment) && segment !== "." && segment !== ".." ? segment : `${tokenId}.json`;
};
