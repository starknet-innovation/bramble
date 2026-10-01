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

import { isLikelySpam } from "@bramble/portfolio/token-registry";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { AVNU_MULTI_ROUTE_SWAP, decodeAvnuRoute } from "@bramble/wallet-model/avnu-route";
import {
  asFelt,
  canonicalFelt,
  type StarknetNetworkId,
  sameFelt,
  uint256Felts,
} from "@bramble/wallet-model/networks";
import type { AddressBookEntry, TokenConfig } from "@bramble/wallet-model/preferences";
import type { Call } from "starknet";
import {
  APPROVE_ENTRYPOINTS,
  BATCH_TRANSFER_FROM_ENTRYPOINTS,
  OPERATOR_APPROVAL_ENTRYPOINTS,
  PLAIN_TRANSFER_FROM_ENTRYPOINTS,
  recipientFeltIndex,
  SAFE_TRANSFER_FROM_ENTRYPOINTS,
} from "./verify-selectors";

/**
 * What a decoded call does, in the terms the review card explains:
 * `approve` grants or raises an ERC20 spending allowance, `nft-approval` grants
 * transfer rights over ONE item of a collection the wallet watches,
 * `operator-approval` grants transfer rights over an ENTIRE collection,
 * `transfer` moves value, `swap` is an AVNU route whose payee and minimum
 * output were decoded, and `unknown` is a call the wallet cannot describe.
 * Each grant has its own kind so no risk rule has to infer authority from a
 * summary string.
 */
export type DecodedCallKind =
  | "approve"
  | "nft-approval"
  | "operator-approval"
  | "swap"
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
  readonly account: Pick<AccountRef, "address" | "networkId">;
  readonly addressBook: readonly AddressBookEntry[];
  /** Wallet-pinned application contracts that should not raise an unknown-contract warning. */
  readonly knownContracts?: readonly string[];
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
  account: Pick<AccountRef, "address" | "networkId">,
  preferences: {
    readonly addressBook: readonly AddressBookEntry[];
    // Structurally typed rather than importing `WatchedNft` from the
    // portfolio package: only these two fields are read, and a `WatchedNft`
    // still satisfies the shape at every call site.
    readonly nfts?: readonly { readonly contract: string; readonly networkId: StarknetNetworkId }[];
    readonly tokens: readonly TokenConfig[];
  },
): VerificationContext => ({
  account,
  addressBook: preferences.addressBook.filter((entry) => entry.networkId === account.networkId),
  nftContracts: (preferences.nfts ?? [])
    .filter((nft) => nft.networkId === account.networkId)
    .map((nft) => nft.contract),
  // A tracked token that trips the spam heuristic (a ticker borrowed from a
  // different contract, malformed metadata) is not trusted: it stays an
  // unknown contract and its calls are summarized in raw units, never under the
  // ticker it impersonates (audit 171). Curated contracts never trip it, so a
  // user hiding STRK changes nothing here; `hiddenTokens` is deliberately not
  // consulted.
  tokens: preferences.tokens.filter(
    (token) => token.networkId === account.networkId && !isLikelySpam(token),
  ),
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
 *
 * Takes only the watched-collection list, not a whole {@link
 * VerificationContext}, so the allowance bookkeeping — which has no acting
 * account to build a context around — asks this exact question rather than
 * re-deriving the felt comparison locally.
 */
export const isWatchedNftContract = (
  context: Pick<VerificationContext, "nftContracts">,
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
  if (calldata.length !== 4) {
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

// Whether the span is EXACTLY an ERC721 safe transfer: [from, to, id_low,
// id_high, data_len, ...data]. Exactness is the point — a `length >= 5` guard
// would also swallow the ERC1155 shape and describe its value limb as data.
const isErc721SafeTransferSpan = (calldata: readonly unknown[]): boolean => {
  const dataLength = asFelt(calldata[4]);
  return calldata.length >= 5 && dataLength === BigInt(calldata.length - 5);
};

// The ERC1155 single-transfer reading of the same selector: [from, to, id_low,
// id_high, value_low, value_high, data_len, ...data]. Returns the value moved,
// or null when the span is not exactly that shape — including when the value
// limbs are not a uint256 Cairo could hold, because a summary is only worth
// showing if every number in it is real.
const erc1155SafeTransferValue = (calldata: readonly unknown[]): bigint | null => {
  const dataLength = asFelt(calldata[6]);
  return calldata.length >= 7 && dataLength === BigInt(calldata.length - 7)
    ? readUint256At(calldata, 4, 5)
    : null;
};

// safe_transfer_from / safeTransferFrom: one selector, two standards. ERC721
// and ERC1155 share the name, the recipient position, and the token id, and
// differ only in whether a value pair sits between the id and the data span —
// so a span can fit both readings at once (`[from, to, id, 0, 2, v, 0]` is an
// ERC1155 transfer of `(2, v)` editions and equally an ERC721 transfer with a
// two-felt data span). There is no trustworthy discriminator: the wallet's
// watched-collection list records no standard, and a contract's own claim about
// itself is exactly what an attacker controls. So an ambiguous span is
// summarized WITHOUT a quantity rather than with a guessed one — the id and the
// recipient are the same under both readings and are stated, the count is not
// invented. A span that fits neither reading decodes as opaque; the recipient
// rules still run on it, because they never consulted this decoder.
const decodeSafeTransferCall: CallDecoder = (call, calldata) => {
  const recipient = readAddressAt(calldata, 1);
  const tokenId = readUint256At(calldata, 2, 3);
  if (!recipient || tokenId === null) {
    return null;
  }
  const value = erc1155SafeTransferValue(calldata);
  const erc721 = isErc721SafeTransferSpan(calldata);
  if (value === null && !erc721) {
    return null;
  }
  const party = shortAddress(canonical(recipient));
  const summary =
    value !== null && erc721
      ? `Safe transfer of NFT #${tokenId} to ${party}`
      : value !== null
        ? `Send ${value} of NFT #${tokenId} to ${party}`
        : `Send NFT #${tokenId} to ${party}`;
  return {
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    kind: "transfer",
    summary,
  };
};

// ERC1155 safe_batch_transfer_from(from, to, ids: Span<u256>, values:
// Span<u256>, data: Span<felt252>), which serializes to [from, to, ids_len,
// ...2*ids_len, values_len, ...2*values_len, data_len, ...data]. The span is
// walked rather than length-checked so a trailing felt, an ids/values length
// mismatch, or a data length that does not consume the remainder all fail to
// decode: the counts are attacker-chosen, and a summary built from a
// half-matching span would state a number the chain will never execute.
// Deliberately quantity-free at the item level — the batch may move many
// editions of many ids, and the honest thing to state is how many ids move and
// where, not a total the user would read as a single amount.
const decodeErc1155BatchTransferCall: CallDecoder = (call, calldata) => {
  const recipient = readAddressAt(calldata, 1);
  const ids = asFelt(calldata[2]);
  if (!recipient || ids === null || ids < 0n || 5n + 4n * ids > BigInt(calldata.length)) {
    return null;
  }
  const count = Number(ids);
  const valuesIndex = 3 + 2 * count;
  const dataIndex = valuesIndex + 1 + 2 * count;
  const dataLength = asFelt(calldata[dataIndex]);
  if (
    asFelt(calldata[valuesIndex]) !== ids ||
    dataLength !== BigInt(calldata.length - dataIndex - 1)
  ) {
    return null;
  }
  const collection = shortAddress(canonical(call.contractAddress));
  return {
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    kind: "transfer",
    summary: `Send ${count} token id${count === 1 ? "" : "s"} of collection ${collection} to ${shortAddress(canonical(recipient))}`,
  };
};

// set_approval_for_all(operator, approved): the operator grant. `approved` is a
// bool felt, so the whole grant is two words wide and carries no amount at all —
// which is exactly why it must not be summarized like an allowance. A non-zero
// `approved` hands one address every item the account holds in this collection,
// now and in future, until it is revoked.
const decodeOperatorApprovalCall: CallDecoder = (call, calldata) => {
  if (calldata.length !== 2) {
    return null;
  }
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
  if (calldata.length !== 3) {
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
  if (!token) {
    return {
      contractAddress: call.contractAddress,
      entrypoint: call.entrypoint,
      kind: "approve",
      summary: `Authorize ${party} for amount or NFT #${amount} on unknown contract ${shortAddress(canonical(call.contractAddress))}`,
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

// A route amount with the token it is in: decimals and symbol for a tracked
// token, base units and the token's address otherwise, so the line never
// states a quantity without saying what it is a quantity of.
const routeAmountLabel = (amount: bigint, tokenAddress: string, context: VerificationContext) => {
  const token = tokenFor(context.tokens, tokenAddress);
  return token ? amountLabel(amount, token) : `${amount} units of ${shortAddress(tokenAddress)}`;
};

// AVNU multi_route_swap, read through the wallet's one pinned route decoder —
// the same one the wallet-built swap is bound with — so a dapp-sent swap states
// the payee and the floor the chain will enforce instead of "Call
// multi_route_swap on 0x…". Calldata that is not all strings, or that the
// decoder cannot consume exactly, returns null and stays opaque; the verifier
// flags that fallback rather than letting it read as an ordinary call.
const decodeAvnuSwapCall: CallDecoder = (call, calldata, context) => {
  const felts = calldata.filter((felt): felt is string => typeof felt === "string");
  const route = felts.length === calldata.length ? decodeAvnuRoute(call.entrypoint, felts) : null;
  if (route === null) {
    return null;
  }
  const sell = routeAmountLabel(route.sellAmount, route.sellToken, context);
  const floor = routeAmountLabel(route.minBuyAmount, route.buyToken, context);
  return {
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    kind: "swap",
    summary: `Swap ${sell} for at least ${floor}, paid to ${shortAddress(route.beneficiary)}`,
  };
};

const decodeUnknownCall = (call: Call): DecodedCall => ({
  contractAddress: call.contractAddress,
  entrypoint: call.entrypoint,
  kind: "unknown",
  summary: `Call ${call.entrypoint} on ${shortAddress(canonical(call.contractAddress))}`,
});

// Dispatch table keyed by entrypoint. EVERY row is derived from a shared
// selector list rather than written out again, so a spelling added to
// ./verify-selectors is decoded here — and enforced by `recipientForFlags` —
// without a second edit. A hand-written row is how the two ERC1155 batch
// spellings once had recipient enforcement and no decoder at the same time.
const CALL_DECODERS: Readonly<Record<string, CallDecoder>> = {
  ...Object.fromEntries(
    APPROVE_ENTRYPOINTS.map((entrypoint) => [entrypoint, decodeTransferOrApproveCall]),
  ),
  ...Object.fromEntries(
    OPERATOR_APPROVAL_ENTRYPOINTS.map((entrypoint) => [entrypoint, decodeOperatorApprovalCall]),
  ),
  ...Object.fromEntries(
    PLAIN_TRANSFER_FROM_ENTRYPOINTS.map((entrypoint) => [entrypoint, decodeTransferFromCall]),
  ),
  ...Object.fromEntries(
    SAFE_TRANSFER_FROM_ENTRYPOINTS.map((entrypoint) => [entrypoint, decodeSafeTransferCall]),
  ),
  ...Object.fromEntries(
    BATCH_TRANSFER_FROM_ENTRYPOINTS.map((entrypoint) => [
      entrypoint,
      decodeErc1155BatchTransferCall,
    ]),
  ),
  [AVNU_MULTI_ROUTE_SWAP]: decodeAvnuSwapCall,
  transfer: decodeTransferOrApproveCall,
};

/**
 * Every entrypoint name the decoder table recognizes, derived from its keys so a
 * spelling added to ./verify-selectors reaches selector-hash lookups (for
 * example the SNIP-9 OutsideExecution reader) with no second edit.
 */
export const DECODED_ENTRYPOINTS: readonly string[] = Object.keys(CALL_DECODERS);

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
 * The address a call pays, for the recipient-based risk rules, or "" when the
 * entrypoint pays nobody the wallet can name.
 *
 * Reads the position {@link recipientFeltIndex} assigns to the SELECTOR, and is
 * deliberately blind to whether this module produced a summary for the call: a
 * recipient whose position is knowable must reach the address-poisoning refusal
 * and the self-send warning even when the wallet cannot describe the rest of the
 * span. Gating this on a successful decode is what let the canonical five-felt
 * ERC721 safe transfer, and every ERC1155 batch transfer, carry a lookalike
 * recipient past the one rule that refuses.
 */
export const recipientForFlags = (call: Call, calldata: readonly unknown[]): string => {
  const index = recipientFeltIndex(call.entrypoint);
  return index === null ? "" : readAddressAt(calldata, index);
};
