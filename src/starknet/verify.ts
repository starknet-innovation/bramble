/**
 * Pre-sign verification: decodes known calldata, flags risky patterns, and
 * summarizes what a transaction will do before anything is signed. Pure and
 * network-free so every rule is unit-testable.
 */
import type { Call } from "starknet";
import type { AddressBookEntry, TokenConfig } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { asFelt, canonicalFelt, sameFelt } from "./networks";
import { formatTokenAmount } from "./rpc";

const UINT_128_SHIFT = 128n;
const UNLIMITED_THRESHOLD = 1n << 128n;

/**
 * Risk flag codes surfaced on the review step.
 */
export type RiskFlagCode =
  | "address-poisoning"
  | "self-transfer"
  | "unknown-contract"
  | "unlimited-approval";

/**
 * One reviewable risk with a user-facing explanation.
 */
export type RiskFlag = {
  readonly code: RiskFlagCode;
  readonly message: string;
};

/**
 * One decoded call with a user-facing summary.
 */
export type DecodedCall = {
  readonly contractAddress: string;
  readonly entrypoint: string;
  readonly kind: "approve" | "transfer" | "unknown";
  readonly summary: string;
};

/**
 * Wallet context the verifier checks calls against.
 */
export type VerificationContext = {
  readonly account: AccountRef;
  readonly addressBook: readonly AddressBookEntry[];
  readonly tokens: readonly TokenConfig[];
};

/**
 * Full pre-sign verification report.
 */
export type VerificationReport = {
  readonly calls: readonly DecodedCall[];
  readonly flags: readonly RiskFlag[];
};

const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

// Display-oriented canonicalization: unparseable values pass through so the
// summary still shows what the call carried.
const canonical = (value: string): string => canonicalFelt(value) ?? value;

/**
 * Detects address poisoning: a candidate that visually mimics a trusted
 * address (same leading and trailing digits) while being a different account.
 */
export const isLookalikeAddress = (candidate: string, trusted: string): boolean => {
  const left = canonical(candidate);
  const right = canonical(trusted);
  if (left === right || left.length < 14 || right.length < 14) {
    return false;
  }
  return left.slice(0, 8) === right.slice(0, 8) && left.slice(-4) === right.slice(-4);
};

// Reads the string felt at `index`, or "" when the slot is absent/non-string.
// Keeps calldata-shape guards in one place so every decoder reads positions the
// same way.
const readAddressAt = (calldata: readonly unknown[], index: number): string => {
  const value = calldata[index];
  return typeof value === "string" ? value : "";
};

// Reads a uint256 split across two felt slots (low, high), or null when either
// slot is not a parseable field element.
const readUint256At = (
  calldata: readonly unknown[],
  lowIndex: number,
  highIndex: number,
): bigint | null => {
  const low = asFelt(calldata[lowIndex]);
  const high = asFelt(calldata[highIndex]);
  return low === null || high === null ? null : low + (high << UINT_128_SHIFT);
};

const tokenFor = (
  tokens: readonly TokenConfig[],
  contractAddress: string,
): TokenConfig | undefined => tokens.find((token) => sameFelt(token.address, contractAddress));

const amountLabel = (amount: bigint, token: TokenConfig | undefined): string =>
  token ? `${formatTokenAmount(amount, token.decimals)} ${token.symbol}` : `${amount} units`;

// ERC20/ERC721 contracts expose transfer_from under both the Cairo snake_case
// name and its camelCase dual (`transferFrom`); a dApp may invoke either. The
// decoder must treat both as the same call, or a camelCase `transferFrom` to a
// poisoned or self address would fall through to the "unknown" summary and
// silently skip the amount decode and the self-transfer / address-poisoning
// flags. `transfer` and `approve` have no distinct camelCase spelling, so
// transfer_from is the only selector that needs this. One source of truth so
// the decode branch and the recipient-index flag logic never drift.
const isTransferFrom = (entrypoint: string): boolean =>
  entrypoint === "transfer_from" || entrypoint === "transferFrom";

// One decoder per known entrypoint shape: given the call, its guarded calldata,
// and the matching token (if any), it returns a decoded summary or null to fall
// through to the unknown-call summary.
type CallDecoder = (
  call: Call,
  calldata: readonly unknown[],
  token: TokenConfig | undefined,
) => DecodedCall | null;

// transfer_from(from, to, amountOrId_low, amountOrId_high): calldata is
// [from, to, low, high] and the recipient is calldata[1]. ERC20 and ERC721
// share this selector and arity, so the third/fourth felts are an ERC20 amount
// when this contract is a token the wallet knows and an ERC721 token id
// otherwise. Without that known-token disambiguation a token transferFrom would
// be mislabeled "Send NFT #<amount>", hiding the real value moved.
const decodeTransferFromCall: CallDecoder = (call, calldata, token) => {
  if (calldata.length < 4) {
    return null;
  }
  const from = readAddressAt(calldata, 0);
  const recipient = readAddressAt(calldata, 1);
  const amountOrId = readUint256At(calldata, 2, 3);
  if (!recipient || amountOrId === null) {
    return null;
  }
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

const decodeTransferOrApproveCall: CallDecoder = (call, calldata, token) => {
  if (calldata.length < 3) {
    return null;
  }
  const amount = readUint256At(calldata, 1, 2);
  const counterparty = readAddressAt(calldata, 0);
  if (amount === null || !counterparty) {
    return null;
  }
  const isTransfer = call.entrypoint === "transfer";
  const verb = isTransfer ? "Send" : "Allow";
  const detail = isTransfer
    ? `${verb} ${amountLabel(amount, token)} to ${shortAddress(canonical(counterparty))}`
    : `${verb} ${shortAddress(canonical(counterparty))} to spend ${amountLabel(amount, token)}`;
  return {
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    kind: isTransfer ? "transfer" : "approve",
    summary: detail,
  };
};

const decodeUnknownCall = (call: Call): DecodedCall => ({
  contractAddress: call.contractAddress,
  entrypoint: call.entrypoint,
  kind: "unknown",
  summary: `Call ${call.entrypoint} on ${shortAddress(canonical(call.contractAddress))}`,
});

// Dispatch table keyed by entrypoint. transfer_from and its camelCase dual share
// one decoder (see isTransferFrom); transfer and approve share another.
const CALL_DECODERS: Readonly<Record<string, CallDecoder>> = {
  approve: decodeTransferOrApproveCall,
  transfer: decodeTransferOrApproveCall,
  transferFrom: decodeTransferFromCall,
  transfer_from: decodeTransferFromCall,
};

const decodeCall = (call: Call, context: VerificationContext): DecodedCall => {
  const calldata = Array.isArray(call.calldata) ? call.calldata : [];
  const token = tokenFor(context.tokens, call.contractAddress);
  const decoder = CALL_DECODERS[call.entrypoint];
  return decoder?.(call, calldata, token) ?? decodeUnknownCall(call);
};

// Each rule is a pure predicate returning the flag it raises or null; the
// assembled list is filtered so absent rules simply drop out (see flagsForCall).
const unknownContractFlag = (call: Call, token: TokenConfig | undefined): RiskFlag | null =>
  token
    ? null
    : {
        code: "unknown-contract",
        message: `${shortAddress(canonical(call.contractAddress))} is not a token or contact this wallet knows. Verify the contract before continuing.`,
      };

const unlimitedApprovalFlag = (
  calldata: readonly unknown[],
  decoded: DecodedCall,
): RiskFlag | null => {
  if (decoded.kind !== "approve") {
    return null;
  }
  const amount = readUint256At(calldata, 1, 2);
  return amount !== null && amount >= UNLIMITED_THRESHOLD
    ? {
        code: "unlimited-approval",
        message:
          "This grants an effectively unlimited spending allowance. Approve only the amount you intend to spend.",
      }
    : null;
};

const selfTransferFlag = (recipient: string, context: VerificationContext): RiskFlag | null =>
  recipient && sameFelt(recipient, context.account.address)
    ? { code: "self-transfer", message: "The recipient is this wallet's own address." }
    : null;

const addressPoisoningFlag = (recipient: string, context: VerificationContext): RiskFlag | null => {
  if (!recipient) {
    return null;
  }
  const trusted = [context.account.address, ...context.addressBook.map((entry) => entry.address)];
  return trusted.some((known) => isLookalikeAddress(recipient, known))
    ? {
        code: "address-poisoning",
        message:
          "The recipient closely mimics one of your saved addresses but is a different account. Re-check every character before sending.",
      }
    : null;
};

// ERC20 transfer(to, ...) puts the recipient first; transfer_from(from, to, ...)
// — snake_case or its camelCase dual — puts it second. Empty unless the call
// decoded as a transfer, so the recipient-based rules only run then.
const recipientForFlags = (
  call: Call,
  calldata: readonly unknown[],
  decoded: DecodedCall,
): string =>
  decoded.kind === "transfer"
    ? readAddressAt(calldata, isTransferFrom(call.entrypoint) ? 1 : 0)
    : "";

const flagsForCall = (
  call: Call,
  decoded: DecodedCall,
  context: VerificationContext,
): readonly RiskFlag[] => {
  const calldata = Array.isArray(call.calldata) ? call.calldata : [];
  const token = tokenFor(context.tokens, call.contractAddress);
  const recipient = recipientForFlags(call, calldata, decoded);
  const candidates: readonly (RiskFlag | null)[] = [
    unknownContractFlag(call, token),
    unlimitedApprovalFlag(calldata, decoded),
    selfTransferFlag(recipient, context),
    addressPoisoningFlag(recipient, context),
  ];
  return candidates.filter((flag): flag is RiskFlag => flag !== null);
};

const dedupeFlags = (flags: readonly RiskFlag[]): readonly RiskFlag[] => {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    // Key on code *and* message, not code alone: two flags that render to the
    // same user-facing line are redundant, but distinct lines must all survive.
    // A multicall touching two different unknown contracts raises two
    // `unknown-contract` flags naming each address — collapsing by code would
    // silently hide every contract after the first.
    const key = `${flag.code}\u0000${flag.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * Verifies calls against wallet context: decoded summaries plus risk flags.
 */
export const verifyCalls = (
  calls: readonly Call[],
  context: VerificationContext,
): VerificationReport => {
  const decoded = calls.map((call) => decodeCall(call, context));
  const flags = calls.flatMap((call, index) => {
    const decodedCall = decoded[index];
    return decodedCall ? flagsForCall(call, decodedCall, context) : [];
  });
  return { calls: decoded, flags: dedupeFlags(flags) };
};
