/**
 * Pure contract and metadata helpers for the terminal's OpenZeppelin ERC721
 * Punk collection. This module never signs or performs network I/O.
 */
import {
  byteArray,
  cairo,
  CallData,
  constants,
  hash,
  type Call,
  type CompiledSierra,
} from "starknet";
import { isNonZeroStarkFieldElement } from "../protocols/support/networks";

const PUNK_LIMIT = 10_000;
export const PUNK_CLASS_HASH = "0x5b5f364528b903513d36dce0aa5544d192c6a25865eeba9ba8a059d7f858263";
export const PUNK_COMPILED_CLASS_HASH =
  "0x7372305f2ffd87350af2927b3e484d91ba0e594d62f5a33d8c8ac656729560a";
export const PUNK_MAINNET_CONTRACT =
  "0xda8b762dcb301e6b144e521ede1e2870ce9c723e5b4e6856c870ad341098a9";

const OFFICIAL_PUNK_IMAGE_BASE = "https://www.larvalabs.com/public/images/cryptopunks/punk";
const OFFICIAL_PUNK_DETAILS_BASE = "https://www.cryptopunks.app/cryptopunks/details/";

const utf8Base64 = (value: string): string => {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

export type PunkDeployment = {
  readonly address: string;
  readonly call: Call;
  readonly constructorCalldata: readonly string[];
};

/** Parses a catalog id while rejecting decimals, exponents, and ids above 9999. */
export const parsePunkId = (value: string): number | null => {
  const normalized = value.trim();
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(normalized)) {
    return null;
  }
  const id = Number(normalized);
  return Number.isSafeInteger(id) && id < PUNK_LIMIT ? id : null;
};

/** Returns the official, zero-padded Larva Labs image URL for a catalog id. */
export const punkImageUrl = (id: number): string => {
  if (!Number.isSafeInteger(id) || id < 0 || id >= PUNK_LIMIT) {
    throw new Error("Punk id must be between 0 and 9999.");
  }
  return `${OFFICIAL_PUNK_IMAGE_BASE}${String(id).padStart(4, "0")}.png`;
};

/**
 * Builds self-contained ERC721 metadata. The artwork stays at its official
 * source rather than being copied into this repository.
 */
export const punkMetadataUri = (id: number): string => {
  const metadata = {
    name: `Starknet Test Punk #${id}`,
    description:
      "An ERC721 interoperability test token minted with Bramble. Uses the corresponding CryptoPunks catalog image for non-commercial testing; not affiliated with CryptoPunks.",
    image: punkImageUrl(id),
    external_url: `${OFFICIAL_PUNK_DETAILS_BASE}${id}`,
    attributes: [
      { trait_type: "Catalog", value: "CryptoPunks" },
      { display_type: "number", trait_type: "Punk ID", value: id },
      { trait_type: "Standard", value: "OpenZeppelin Cairo ERC721" },
    ],
  };
  return `data:application/json;base64,${utf8Base64(JSON.stringify(metadata))}`;
};

/**
 * Checks a user-entered Starknet address or salt without canonicalizing it.
 * Zero is refused by value, so `0x00` and `0x000` are refused like `0x0`
 * (Sherlock 167).
 */
export const isFelt = (value: string): boolean =>
  isNonZeroStarkFieldElement(value.trim().toLowerCase());

const byteArrayCalldata = (value: string): ReturnType<typeof byteArray.byteArrayFromString> =>
  byteArray.byteArrayFromString(value);

/** Builds the UDC deployment call and its deterministic contract address. */
export const buildPunkDeployment = (
  name: string,
  symbol: string,
  owner: string,
  salt: string,
): PunkDeployment => {
  if (name.trim().length === 0 || name.trim().length > 48) {
    throw new Error("Collection name must be between 1 and 48 characters.");
  }
  if (!/^[A-Z0-9]{2,10}$/.test(symbol.trim())) {
    throw new Error("Symbol must be 2–10 uppercase letters or numbers.");
  }
  if (!isFelt(owner) || !isFelt(salt)) {
    throw new Error("Owner and deployment salt must be valid non-zero Starknet felts.");
  }
  const constructorCalldata = CallData.compile([
    byteArrayCalldata(name.trim()),
    byteArrayCalldata(symbol.trim()),
    owner.trim(),
  ]);
  const normalizedSalt = salt.trim().toLowerCase();
  return {
    address: hash.calculateContractAddressFromHash(
      normalizedSalt,
      PUNK_CLASS_HASH,
      constructorCalldata,
      0,
    ),
    call: {
      calldata: CallData.compile([PUNK_CLASS_HASH, normalizedSalt, 0, constructorCalldata]),
      contractAddress: constants.UDC.ADDRESS,
      entrypoint: constants.UDC.ENTRYPOINT,
    },
    constructorCalldata,
  };
};

/** Builds the owner-only `mint` call with a complete per-token metadata URI. */
export const buildPunkMintCall = (contractAddress: string, recipient: string, id: number): Call => {
  if (!isFelt(contractAddress) || !isFelt(recipient)) {
    throw new Error("Collection and recipient must be valid Starknet addresses.");
  }
  return {
    calldata: CallData.compile([
      recipient.trim(),
      cairo.uint256(id),
      byteArrayCalldata(punkMetadataUri(id)),
    ]),
    contractAddress: contractAddress.trim(),
    entrypoint: "mint",
  };
};

/** Builds an ERC721 wallet-to-wallet transfer after the UI ownership check. */
export const buildPunkTransferCall = (
  contractAddress: string,
  from: string,
  recipient: string,
  id: number,
): Call => {
  if (![contractAddress, from, recipient].every(isFelt)) {
    throw new Error("Collection, sender, and recipient must be valid Starknet addresses.");
  }
  return {
    calldata: CallData.compile([from.trim(), recipient.trim(), cairo.uint256(id)]),
    contractAddress: contractAddress.trim(),
    entrypoint: "transfer_from",
  };
};

/** Narrows the fetched public artifact and re-proves its pinned class hash. */
export const readPunkContractClass = (value: unknown): CompiledSierra => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("abi" in value) ||
    !("sierra_program" in value) ||
    !Array.isArray((value as { readonly sierra_program?: unknown }).sierra_program)
  ) {
    throw new Error("Bundled Punk contract artifact is malformed.");
  }
  const contract = value as CompiledSierra;
  if (BigInt(hash.computeContractClassHash(contract)) !== BigInt(PUNK_CLASS_HASH)) {
    throw new Error("Bundled Punk contract artifact does not match its pinned class hash.");
  }
  return contract;
};
