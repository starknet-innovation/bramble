/**
 * Pre-sign verification: decodes known calldata, flags risky patterns, and
 * summarizes what a transaction will do before anything is signed. Pure and
 * network-free so every rule is unit-testable.
 */
import type { Call } from "starknet";
import type { AddressBookEntry, TokenConfig } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
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

const asFelt = (value: unknown): bigint | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const sameFelt = (a: unknown, b: unknown): boolean => {
  const left = asFelt(a);
  const right = asFelt(b);
  return left !== null && right !== null && left === right;
};

const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

const canonical = (value: string): string => {
  const felt = asFelt(value);
  return felt === null ? value : `0x${felt.toString(16)}`;
};

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

const uint256Amount = (calldata: readonly unknown[]): bigint | null => {
  const low = asFelt(calldata[1]);
  const high = asFelt(calldata[2]);
  return low === null || high === null ? null : low + (high << UINT_128_SHIFT);
};

const tokenFor = (
  tokens: readonly TokenConfig[],
  contractAddress: string,
): TokenConfig | undefined => tokens.find((token) => sameFelt(token.address, contractAddress));

const amountLabel = (amount: bigint, token: TokenConfig | undefined): string =>
  token ? `${formatTokenAmount(amount, token.decimals)} ${token.symbol}` : `${amount} units`;

const decodeCall = (call: Call, context: VerificationContext): DecodedCall => {
  const calldata = Array.isArray(call.calldata) ? call.calldata : [];
  const token = tokenFor(context.tokens, call.contractAddress);
  if ((call.entrypoint === "transfer" || call.entrypoint === "approve") && calldata.length >= 3) {
    const amount = uint256Amount(calldata);
    const counterparty = typeof calldata[0] === "string" ? calldata[0] : "";
    if (amount !== null && counterparty) {
      const verb = call.entrypoint === "transfer" ? "Send" : "Allow";
      const detail =
        call.entrypoint === "transfer"
          ? `${verb} ${amountLabel(amount, token)} to ${shortAddress(canonical(counterparty))}`
          : `${verb} ${shortAddress(canonical(counterparty))} to spend ${amountLabel(amount, token)}`;
      return {
        contractAddress: call.contractAddress,
        entrypoint: call.entrypoint,
        kind: call.entrypoint,
        summary: detail,
      };
    }
  }
  return {
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    kind: "unknown",
    summary: `Call ${call.entrypoint} on ${shortAddress(canonical(call.contractAddress))}`,
  };
};

const flagsForCall = (
  call: Call,
  decoded: DecodedCall,
  context: VerificationContext,
): readonly RiskFlag[] => {
  const flags: RiskFlag[] = [];
  const calldata = Array.isArray(call.calldata) ? call.calldata : [];
  const token = tokenFor(context.tokens, call.contractAddress);

  if (!token) {
    flags.push({
      code: "unknown-contract",
      message: `${shortAddress(canonical(call.contractAddress))} is not a token or contact this wallet knows. Verify the contract before continuing.`,
    });
  }

  if (decoded.kind === "approve") {
    const amount = uint256Amount(calldata);
    if (amount !== null && amount >= UNLIMITED_THRESHOLD) {
      flags.push({
        code: "unlimited-approval",
        message:
          "This grants an effectively unlimited spending allowance. Approve only the amount you intend to spend.",
      });
    }
  }

  if (decoded.kind === "transfer") {
    const recipient = typeof calldata[0] === "string" ? calldata[0] : "";
    if (recipient && sameFelt(recipient, context.account.address)) {
      flags.push({
        code: "self-transfer",
        message: "The recipient is this wallet's own address.",
      });
    }
    const trusted = [context.account.address, ...context.addressBook.map((entry) => entry.address)];
    if (recipient && trusted.some((known) => isLookalikeAddress(recipient, known))) {
      flags.push({
        code: "address-poisoning",
        message:
          "The recipient closely mimics one of your saved addresses but is a different account. Re-check every character before sending.",
      });
    }
  }

  return flags;
};

const dedupeFlags = (flags: readonly RiskFlag[]): readonly RiskFlag[] => {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    if (seen.has(flag.code)) {
      return false;
    }
    seen.add(flag.code);
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
