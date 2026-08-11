/**
 * Pure calldata decoding for the pre-sign reviewer: turns one untrusted {@link
 * Call} into a typed {@link DecodedCall} with a user-facing summary, or into an
 * explicitly opaque one. Network-free, so every rule is unit-testable. The risk
 * rules that read these decodes live in ./verify; the selector vocabulary they
 * both classify against lives in ./verify-selectors.
 *
 * Nothing here guesses: a selector this module does not know, or calldata that
 * does not fit the known shape, decodes as `unknown` rather than as an invented
 * summary.
 */
import type { Call } from "starknet";
import type { WatchedNft } from "../storage/nft";
import type { AddressBookEntry, TokenConfig } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { asFelt, canonicalFelt, sameFelt, uint256Felts } from "./networks";
import { formatTokenAmount } from "./rpc";
import {
  APPROVE_ENTRYPOINTS,
  isTransferFromEntrypoint,
  OPERATOR_APPROVAL_ENTRYPOINTS,
} from "./verify-selectors";

/**
 * What a decoded call does, in the terms the review card explains:
 * `approve` grants or raises an ERC20 spending allowance, `nft-approval` grants
 * transfer rights over ONE item of a collection the wallet watches,
 * `operator-approval` grants transfer rights over an ENTIRE collection,
 * `transfer` moves value, and `unknown` is a call the wallet cannot describe.
 * Each grant has its own kind so no risk rule has to infer authority from a
 * summary string.
 */
export type DecodedCallKind =
  | "approve"
  | "nft-approval"
  | "operator-approval"
  | "transfer"
  | "unknown";

/**
 * One decoded call with a user-facing summary.
 */
export type DecodedCall = {
  readonly contractAddress: string;
  readonly entrypoint: string;
  readonly kind: DecodedCallKind;
  readonly summary: string;
};

/**
 * Wallet context the verifier checks calls against: the acting account, the
 * contacts and tokens it trusts, and the NFT collections it watches. The
 * collection list is what lets an ERC721 `approve(to, token_id)` be told apart
 * from an ERC20 `approve(spender, amount)` — the two are indistinguishable by
 * calldata alone.
 */
export type VerificationContext = {
  readonly account: AccountRef;
  readonly addressBook: readonly AddressBookEntry[];
  /**
   * Collections this account watches. Optional because a context can be built
   * where the wallet holds no NFT knowledge at all; absent means "no collection
   * is known", under which an ERC721 `approve` is indistinguishable from an
   * ERC20 one and is described in ERC20 terms. Every production context comes
   * from {@link verificationContext}, which always fills it in.
   */
  readonly nftContracts?: readonly string[];
  readonly tokens: readonly TokenConfig[];
};

/**
 * Builds the wallet context the verifier checks calls against, scoped to the
 * account's network.
 *
 * This is the single definition of "which contacts, tokens, and collections does
 * this account trust". It lives beside the verifier rather than in one product
 * line's handler so the ERC20 send, the NFT send, the allowance flows, the swap,
 * the dapp invoke, and the privacy pool routes all scope the trusted set the
 * same way; a fourth local copy of these filters is how a contact saved on
 * another network once made a foreign recipient read as trusted. Pure — it only
 * filters the preferences it is handed and never reads storage itself.
 */
export const verificationContext = (
  account: AccountRef,
  preferences: {
    readonly addressBook: readonly AddressBookEntry[];
    readonly nfts?: readonly WatchedNft[];
    readonly tokens: readonly TokenConfig[];
  },
): VerificationContext => ({
  account,
  addressBook: preferences.addressBook.filter((entry) => entry.networkId === account.networkId),
  nftContracts: (preferences.nfts ?? [])
    .filter((nft) => nft.networkId === account.networkId)
    .map((nft) => nft.contract),
  tokens: preferences.tokens.filter((token) => token.networkId === account.networkId),
});

/**
 * Abbreviates an address for display as `0x1234…abcd`.
 */
export const shortAddress = (address: string): string =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Display-oriented canonicalization: an unparseable value passes through
 * unchanged so a summary still shows exactly what the call carried.
 */
export const canonical = (value: string): string => canonicalFelt(value) ?? value;

/**
 * Reads the string felt at `index`, or "" when the slot is absent or not a
 * string. Keeps calldata-shape guards in one place so every decoder and every
 * flag rule reads positions the same way.
 */
export const readAddressAt = (calldata: readonly unknown[], index: number): string => {
  const value = calldata[index];
  return typeof value === "string" ? value : "";
};

/**
 * Reads a uint256 split across two felt slots (low, high), or null when either
 * slot is not a parseable field element.
 */
export const readUint256At = (
  calldata: readonly unknown[],
  lowIndex: number,
  highIndex: number,
): bigint | null => uint256Felts(calldata[lowIndex], calldata[highIndex]);

/**
 * Finds the tracked token a call targets, or undefined when the contract is not
 * one the wallet knows.
 */
export const tokenFor = (
  tokens: readonly TokenConfig[],
  contractAddress: string,
): TokenConfig | undefined => tokens.find((token) => sameFelt(token.address, contractAddress));

/**
 * Reports whether the contract is an NFT collection this account watches, i.e.
 * a contract whose `approve` second argument is a token id rather than an
 * amount.
 */
export const isWatchedNftContract = (
  context: VerificationContext,
  contractAddress: string,
): boolean => (context.nftContracts ?? []).some((contract) => sameFelt(contract, contractAddress));

const amountLabel = (amount: bigint, token: TokenConfig | undefined): string =>
  token ? `${formatTokenAmount(amount, token.decimals)} ${token.symbol}` : `${amount} units`;

// One decoder per known entrypoint shape: given the call, its guarded calldata,
// and the wallet context, it returns a decoded summary or null to fall through
// to the unknown-call summary.
type CallDecoder = (
  call: Call,
  calldata: readonly unknown[],
  context: VerificationContext,
) => DecodedCall | null;

// transfer_from(from, to, amountOrId_low, amountOrId_high): calldata is
// [from, to, low, high] and the recipient is calldata[1]. ERC20 and ERC721
// share this selector and arity, so the third/fourth felts are an ERC20 amount
// when this contract is a token the wallet knows and an ERC721 token id
// otherwise. Without that known-token disambiguation a token transferFrom would
// be mislabeled "Send NFT #<amount>", hiding the real value moved.
const decodeTransferFromCall: CallDecoder = (call, calldata, context) => {
  if (calldata.length < 4) {
    return null;
  }
  const from = readAddressAt(calldata, 0);
  const recipient = readAddressAt(calldata, 1);
  const amountOrId = readUint256At(calldata, 2, 3);
  if (!recipient || amountOrId === null) {
    return null;
  }
  const token = tokenFor(context.tokens, call.contractAddress);
  const fromLabel = from ? ` from ${shortAddress(canonical(from))}` : "";
  return {
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    // Treated as a transfer so self-send and address-poisoning checks run.
    kind: "transfer",
    summary: token
      ? `Send ${amountLabel(amountOrId, token)}${fromLabel} to ${shortAddress(canonical(recipient))}`
      : `Send NFT #${amountOrId} to ${shortAddress(canonical(recipient))}`,
  };
};

// ERC1155 safe_transfer_from(from, to, id_low, id_high, value_low,
// value_high, data_len, ...data): the wallet uses this shape to move one
// edition while preserving the same recipient safety checks as ERC721.
const decodeErc1155TransferCall: CallDecoder = (call, calldata) => {
  if (calldata.length < 7) {
    return null;
  }
  const recipient = readAddressAt(calldata, 1);
  const tokenId = readUint256At(calldata, 2, 3);
  const amount = readUint256At(calldata, 4, 5);
  if (!recipient || tokenId === null || amount === null) {
    return null;
  }
  return {
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    kind: "transfer",
    summary: `Send ${amount} of NFT #${tokenId} to ${shortAddress(canonical(recipient))}`,
  };
};

// set_approval_for_all(operator, approved): the operator grant. `approved` is a
// bool felt, so the whole grant is two words wide and carries no amount at all —
// which is exactly why it must not be summarized like an allowance. A non-zero
// `approved` hands one address every item the account holds in this collection,
// now and in future, until it is revoked.
const decodeOperatorApprovalCall: CallDecoder = (call, calldata) => {
  const operator = readAddressAt(calldata, 0);
  const approved = asFelt(calldata[1]);
  if (!operator || approved === null) {
    return null;
  }
  const party = shortAddress(canonical(operator));
  const collection = shortAddress(canonical(call.contractAddress));
  return {
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    kind: "operator-approval",
    summary:
      approved === 0n
        ? `Revoke ${party}'s permission to transfer every item in collection ${collection}`
        : `Allow ${party} to transfer EVERY item you own in collection ${collection}`,
  };
};

// transfer(to, amount_low, amount_high) and the ERC20 allowance grants
// approve/increase_allowance(spender, amount_low, amount_high) — one shape,
// three felts. An ERC721 `approve(to, token_id_low, token_id_high)` is
// byte-for-byte the same shape, so it is told apart by the contract being a
// collection this wallet watches; without that it would read as "spend N units"
// of a fungible token that does not exist.
const decodeTransferOrApproveCall: CallDecoder = (call, calldata, context) => {
  if (calldata.length < 3) {
    return null;
  }
  const amount = readUint256At(calldata, 1, 2);
  const counterparty = readAddressAt(calldata, 0);
  if (amount === null || !counterparty) {
    return null;
  }
  const token = tokenFor(context.tokens, call.contractAddress);
  const party = shortAddress(canonical(counterparty));
  if (call.entrypoint === "transfer") {
    return {
      contractAddress: call.contractAddress,
      entrypoint: call.entrypoint,
      kind: "transfer",
      summary: `Send ${amountLabel(amount, token)} to ${party}`,
    };
  }
  if (isWatchedNftContract(context, call.contractAddress)) {
    return {
      contractAddress: call.contractAddress,
      entrypoint: call.entrypoint,
      kind: "nft-approval",
      summary: `Allow ${party} to transfer NFT #${amount} of collection ${shortAddress(canonical(call.contractAddress))}`,
    };
  }
  // An increase adds to whatever allowance already stands, and the resulting
  // cap is not knowable from the call alone, so it is summarized as "more"
  // rather than as an absolute limit the wallet would be guessing at.
  const extra = call.entrypoint === "approve" ? "" : " more";
  return {
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    kind: "approve",
    summary: `Allow ${party} to spend ${amountLabel(amount, token)}${extra}`,
  };
};

const decodeUnknownCall = (call: Call): DecodedCall => ({
  contractAddress: call.contractAddress,
  entrypoint: call.entrypoint,
  kind: "unknown",
  summary: `Call ${call.entrypoint} on ${shortAddress(canonical(call.contractAddress))}`,
});

// Dispatch table keyed by entrypoint. transfer_from and its camelCase dual share
// one decoder (see isTransferFromEntrypoint); transfer and every
// allowance-granting entrypoint share another. The approve and operator rows are
// derived from the shared selector lists rather than listed again, so a spelling
// added there is decoded here without a second edit.
const CALL_DECODERS: Readonly<Record<string, CallDecoder>> = {
  ...Object.fromEntries(
    APPROVE_ENTRYPOINTS.map((entrypoint) => [entrypoint, decodeTransferOrApproveCall]),
  ),
  ...Object.fromEntries(
    OPERATOR_APPROVAL_ENTRYPOINTS.map((entrypoint) => [entrypoint, decodeOperatorApprovalCall]),
  ),
  safeTransferFrom: decodeErc1155TransferCall,
  safe_transfer_from: decodeErc1155TransferCall,
  transfer: decodeTransferOrApproveCall,
  transferFrom: decodeTransferFromCall,
  transfer_from: decodeTransferFromCall,
};

/**
 * Decodes one call against the wallet context. Total: an unrecognized selector
 * or malformed calldata yields the opaque `unknown` summary rather than an
 * invented one.
 */
export const decodeCall = (call: Call, context: VerificationContext): DecodedCall => {
  const calldata = Array.isArray(call.calldata) ? call.calldata : [];
  const decoder = CALL_DECODERS[call.entrypoint];
  return decoder?.(call, calldata, context) ?? decodeUnknownCall(call);
};

/**
 * The recipient a transfer pays, for the recipient-based risk rules. ERC20
 * `transfer(to, ...)` puts it first; `transfer_from(from, to, ...)` — snake_case
 * or camelCase dual — puts it second. Empty unless the call decoded as a
 * transfer, so those rules only run then.
 */
export const recipientForFlags = (
  call: Call,
  calldata: readonly unknown[],
  decoded: DecodedCall,
): string =>
  decoded.kind === "transfer"
    ? readAddressAt(calldata, isTransferFromEntrypoint(call.entrypoint) ? 1 : 0)
    : "";
