/**
 * Per-token NFT metadata authoring for Create. Pure: the user writes a token's
 * name, description, image URI and traits, and this module returns the
 * ERC-721 / ERC-1155 metadata JSON to host at that token's URI. Nothing is
 * uploaded or fetched; hosting the file is the user's step.
 *
 * Field limits match what the Bramble wallet reads back (name 128,
 * description 1,024, 32 traits, trait 128, value 256), so nothing written
 * here is cut off when the token shows in the wallet.
 */
import { readTokenId } from "./token-create";
import { isPublicTokenUri, MAX_IMAGE_URI_LENGTH } from "./token-uri";

const MAX_NAME_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 1024;
/** Most traits one token can carry; the wallet reads no more. */
export const MAX_TRAITS = 32;
const MAX_TRAIT_LENGTH = 128;
const MAX_VALUE_LENGTH = 256;
// Any control character except a line break, which a description may use.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

/** One trait row as typed; a row with both cells empty is skipped. */
export type MetadataTrait = {
  readonly trait: string;
  readonly value: string;
};

/** Raw metadata form values for one token. */
export type MetadataDraft = {
  readonly description: string;
  readonly image: string;
  readonly name: string;
  readonly tokenId: string;
  readonly traits: readonly MetadataTrait[];
};

/** The metadata document, in the field order marketplaces and the wallet read. */
type TokenMetadataDocument = {
  readonly name: string;
  readonly description?: string;
  readonly image: string;
  readonly attributes?: readonly { readonly trait_type: string; readonly value: string }[];
};

/** A validated token metadata file, ready to copy or download. */
export type TokenMetadata = {
  readonly document: TokenMetadataDocument;
  readonly json: string;
  readonly tokenId: bigint;
};

const fail = (message: string): never => {
  throw new Error(message);
};

const readText = (value: string, label: string, max: number, required: boolean, multiline = false): string => {
  const text = value.trim();
  if (required && text.length === 0) fail(`Enter a ${label.toLowerCase()}.`);
  if (text.length > max) fail(`${label} must be up to ${max} characters.`);
  if (CONTROL.test(text) || (!multiline && text.includes("\n"))) fail(`${label} can't contain control characters.`);
  return text;
};

const readImage = (value: string): string => {
  const image = value.trim();
  if (!isPublicTokenUri(image, MAX_IMAGE_URI_LENGTH)) {
    fail("Image URI must be a public https:// or ipfs:// address, with no spaces.");
  }
  return image;
};

const readTraits = (traits: readonly MetadataTrait[]): TokenMetadataDocument["attributes"] => {
  const filled = traits.filter((row) => row.trait.trim() !== "" || row.value.trim() !== "");
  if (filled.length > MAX_TRAITS) fail(`Add up to ${MAX_TRAITS} traits.`);
  return filled.map((row) => {
    if (row.trait.trim() === "" || row.value.trim() === "") fail("Each trait needs a name and a value.");
    return {
      trait_type: readText(row.trait, "Trait", MAX_TRAIT_LENGTH, true),
      value: readText(row.value, "Value", MAX_VALUE_LENGTH, true),
    };
  });
};

/**
 * Validates a draft and builds its metadata JSON (two-space indented, with a
 * final newline). Empty description and traits are left out of the file.
 * Throws a user-facing sentence for the first invalid field.
 */
export const buildTokenMetadata = (draft: MetadataDraft): TokenMetadata => {
  const tokenId = readTokenId(draft.tokenId);
  const name = readText(draft.name, "Token name", MAX_NAME_LENGTH, true);
  const description = readText(draft.description, "Description", MAX_DESCRIPTION_LENGTH, false, true);
  const image = readImage(draft.image);
  const attributes = readTraits(draft.traits) ?? [];
  const document: TokenMetadataDocument = {
    name,
    ...(description === "" ? {} : { description }),
    image,
    ...(attributes.length === 0 ? {} : { attributes }),
  };
  return { document, json: `${JSON.stringify(document, null, 2)}\n`, tokenId };
};
