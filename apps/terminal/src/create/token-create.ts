/**
 * Pure input validation and calldata for Create. Nothing here signs or reads
 * the network: the screen hands the single UDC call to the connected wallet,
 * and `create-runtime.ts` checks the result on chain.
 *
 * Every user-entered field is validated before any calldata exists, so a
 * request can only reach the wallet with bounded, canonical values.
 */
import { byteArray, cairo, CallData, constants, hash, type Call } from "starknet";
import { isFelt } from "../nft/punk-contract";
import { ERC20_PRESET_DECIMALS, TOKEN_PRESETS } from "./token-presets";

const U256_LIMIT = 1n << 256n;
const MAX_NAME_LENGTH = 48;
const MAX_URI_LENGTH = 200;
const MAX_TOKEN_IDS = 50;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const SYMBOL_PATTERN = /^[A-Za-z0-9]{1,11}$/;
const URI_PATTERN = /^(?:https|ipfs):\/\/[\x21-\x7e]+$/;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;

/** Raw form values for an ERC-20 create. */
type Erc20Draft = {
  readonly name: string;
  readonly recipient: string;
  readonly supply: string;
  readonly symbol: string;
};

/** Raw form values for an ERC-721 create; `tokenIds` is a comma list. */
type Erc721Draft = {
  readonly baseUri: string;
  readonly name: string;
  readonly recipient: string;
  readonly symbol: string;
  readonly tokenIds: string;
};

/** Raw form values for an ERC-1155 create; ids and amounts pair by position. */
type Erc1155Draft = {
  readonly amounts: string;
  readonly baseUri: string;
  readonly recipient: string;
  readonly tokenIds: string;
};

/** A create request for one standard, owned by the connected account. */
export type TokenDraft =
  | ({ readonly standard: "erc20" } & Erc20Draft)
  | ({ readonly standard: "erc721" } & Erc721Draft)
  | ({ readonly standard: "erc1155" } & Erc1155Draft);

/** A validated create, ready for review: the UDC call and its fixed outcome. */
export type TokenDeployment = {
  readonly address: string;
  readonly call: Call;
  readonly classHash: string;
  readonly constructorCalldata: readonly string[];
  readonly details: readonly { readonly label: string; readonly value: string }[];
};

const fail = (message: string): never => {
  throw new Error(message);
};

const readName = (value: string): string => {
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || !PRINTABLE_ASCII.test(name)) {
    fail(`Name must be 1–${MAX_NAME_LENGTH} plain characters.`);
  }
  return name;
};

const readSymbol = (value: string): string => {
  const symbol = value.trim();
  if (!SYMBOL_PATTERN.test(symbol)) fail("Symbol must be 1–11 letters or numbers.");
  return symbol;
};

const readAddress = (value: string, label: string): string => {
  const address = value.trim().toLowerCase();
  if (!isFelt(address)) fail(`Enter a valid Starknet ${label} address.`);
  return address;
};

const readUri = (value: string): string => {
  const uri = value.trim();
  if (uri.length > MAX_URI_LENGTH || !URI_PATTERN.test(uri)) {
    fail(`Base URI must start with https:// or ipfs://, with no spaces, up to ${MAX_URI_LENGTH} characters.`);
  }
  return uri;
};

/**
 * Parses whole tokens with up to 18 decimal places into base units. Refuses
 * zero, signs, exponents, and anything at or above 2^256.
 */
export const parseTokenAmount = (value: string, decimals: number = ERC20_PRESET_DECIMALS): bigint => {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value.trim());
  if (match === null || (match[2] ?? "").length > decimals) {
    return fail(`Supply must be a positive number with up to ${decimals} decimal places.`);
  }
  const units = BigInt(match[1] ?? "0") * 10n ** BigInt(decimals) + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
  if (units === 0n || units >= U256_LIMIT) fail("Supply must be greater than zero and fit in a u256.");
  return units;
};

const readU256 = (part: string, label: string): bigint => {
  if (!INTEGER_PATTERN.test(part)) return fail(`${label} must be whole numbers.`);
  const value = BigInt(part);
  if (value >= U256_LIMIT) fail(`${label} must fit in a u256.`);
  return value;
};

/** Parses a comma- or space-separated list of 1–50 whole numbers below 2^256. */
export const parseU256List = (value: string, label: string): readonly bigint[] => {
  const parts = value.split(/[\s,]+/).filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > MAX_TOKEN_IDS) {
    fail(`Enter 1–${MAX_TOKEN_IDS} ${label.toLowerCase()}.`);
  }
  return parts.map((part) => readU256(part, label));
};

const readTokenIds = (value: string): readonly bigint[] => {
  const ids = parseU256List(value, "Token ids");
  if (new Set(ids).size !== ids.length) fail("Token ids must not repeat.");
  return ids;
};

/** A `Span<u256>` argument: CallData.compile adds the length prefix. */
const u256List = (values: readonly bigint[]): ReturnType<typeof cairo.uint256>[] =>
  values.map((value) => cairo.uint256(value));

const text = (value: string): ReturnType<typeof byteArray.byteArrayFromString> =>
  byteArray.byteArrayFromString(value);

/** Formats base units back to whole tokens for the review, without rounding. */
export const formatTokenAmount = (units: bigint, decimals: number = ERC20_PRESET_DECIMALS): string => {
  const scale = 10n ** BigInt(decimals);
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length === 0 ? (units / scale).toString() : `${units / scale}.${fraction}`;
};

type Built = {
  readonly calldata: readonly string[];
  readonly details: readonly { readonly label: string; readonly value: string }[];
};

const erc20 = (draft: Erc20Draft, owner: string): Built => {
  const name = readName(draft.name);
  const symbol = readSymbol(draft.symbol);
  const supply = parseTokenAmount(draft.supply);
  const recipient = readAddress(draft.recipient, "recipient");
  return {
    calldata: CallData.compile([text(name), text(symbol), cairo.uint256(supply), recipient, owner]),
    details: [
      { label: "Name", value: name },
      { label: "Symbol", value: symbol },
      { label: "Supply", value: `${formatTokenAmount(supply)} ${symbol}` },
      { label: "Decimals", value: String(ERC20_PRESET_DECIMALS) },
      { label: "Supply goes to", value: recipient },
    ],
  };
};

const erc721 = (draft: Erc721Draft, owner: string): Built => {
  const name = readName(draft.name);
  const symbol = readSymbol(draft.symbol);
  const baseUri = readUri(draft.baseUri);
  const recipient = readAddress(draft.recipient, "recipient");
  const ids = readTokenIds(draft.tokenIds);
  return {
    calldata: CallData.compile([text(name), text(symbol), text(baseUri), recipient, u256List(ids), owner]),
    details: [
      { label: "Name", value: name },
      { label: "Symbol", value: symbol },
      { label: "Base URI", value: baseUri },
      { label: "Token ids", value: ids.join(", ") },
      { label: "Minted to", value: recipient },
    ],
  };
};

const erc1155 = (draft: Erc1155Draft, owner: string): Built => {
  const baseUri = readUri(draft.baseUri);
  const recipient = readAddress(draft.recipient, "recipient");
  const ids = readTokenIds(draft.tokenIds);
  const amounts = parseU256List(draft.amounts, "Amounts");
  if (amounts.length !== ids.length) fail("Enter one amount for each token id.");
  if (amounts.some((amount) => amount === 0n)) fail("Amounts must be greater than zero.");
  return {
    calldata: CallData.compile([text(baseUri), recipient, u256List(ids), u256List(amounts), owner]),
    details: [
      { label: "Base URI", value: baseUri },
      { label: "Tokens", value: ids.map((id, index) => `#${id} × ${amounts[index]}`).join(", ") },
      { label: "Minted to", value: recipient },
    ],
  };
};

const build = (draft: TokenDraft, owner: string): Built => {
  switch (draft.standard) {
    case "erc20":
      return erc20(draft, owner);
    case "erc721":
      return erc721(draft, owner);
    case "erc1155":
      return erc1155(draft, owner);
  }
};

/**
 * Validates a draft and builds the single UDC `deploy_contract` call for the
 * pinned preset. `not_from_zero` is false, so the address depends only on the
 * salt, class and constructor arguments and is fixed before signing. Anyone
 * deploying the same arguments first creates the same contract, owned by the
 * same account; the user's transaction then reverts and nothing is lost but
 * its fee. Throws a user-facing message for any invalid field.
 */
export const buildTokenDeployment = (draft: TokenDraft, owner: string, salt: string): TokenDeployment => {
  const ownerAddress = readAddress(owner, "owner");
  const normalizedSalt = salt.trim().toLowerCase();
  if (!isFelt(normalizedSalt)) fail("Deployment salt must be a non-zero Starknet felt.");
  const preset = TOKEN_PRESETS[draft.standard];
  const built = build(draft, ownerAddress);
  const constructorCalldata = built.calldata.map((felt) => `0x${BigInt(felt).toString(16)}`);
  return {
    address: hash.calculateContractAddressFromHash(normalizedSalt, preset.classHash, constructorCalldata, 0),
    call: {
      calldata: CallData.compile([preset.classHash, normalizedSalt, 0, constructorCalldata]),
      contractAddress: constants.UDC.ADDRESS,
      entrypoint: constants.UDC.ENTRYPOINT,
    },
    classHash: preset.classHash,
    constructorCalldata,
    details: [
      ...built.details,
      { label: "Owner (can upgrade)", value: ownerAddress },
      { label: "Contract", value: `${preset.presetName} · ${preset.classHash}` },
    ],
  };
};
