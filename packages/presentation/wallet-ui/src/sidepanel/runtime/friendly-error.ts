/**
 * Maps raw internal error strings surfaced by the background and runtime layers
 * to friendly, user-facing copy for toasts and status lines. The mapping is a
 * pure lookup with no DOM, clock, or network access so it can be unit-tested in
 * isolation. Error toasts retain the original diagnostic for copying.
 */

import { friendlyNetworkError } from "@mc-wallet/core/network-error";
import { WRONG_CHAIN_MESSAGE } from "@mc-wallet/starknet/provider";

/**
 * The result of classifying a raw error string for display.
 */
export interface FriendlyError {
  /** Human-readable message safe to show to the user. */
  message: string;
}

const GENERIC_VALIDATION =
  "Something about that request wasn't right. Check the details and try again.";
const WALLET_UNAVAILABLE = "The wallet is locked or unavailable. Unlock it and try again.";
const NETWORK_UNREACHABLE = "Couldn't reach the network. Check your connection and try again.";
const UNEXPECTED_FALLBACK = "Something went wrong. Please try again.";
const RPC_REJECTED = "The RPC rejected this request. Copy the error details for the full response.";
const SERVICE_REJECTED =
  "A wallet service rejected this request. Copy the error details for the full response.";
const RATE_LIMITED = "This service is rate limiting requests. Wait a moment and try again.";

// Exact raw strings the background/runtime layers throw for recoverable,
// user-facing conditions.
const EXACT: ReadonlyMap<string, string> = new Map([
  ["wallet unavailable", WALLET_UNAVAILABLE],
  // Platform fetch/network rejections bubble up with these messages.
  ["failed to fetch", NETWORK_UNREACHABLE],
  ["network error", NETWORK_UNREACHABLE],
  ["load failed", NETWORK_UNREACHABLE],
  // Swap (AVNU) conditions a user can act on.
  [
    "no swap route available for this pair",
    "No route found for this pair right now. Try a different amount or pair.",
  ],
  ["swap quote failed", "Couldn't fetch a quote. Check your connection and try again."],
  ["swap build failed", "AVNU couldn't prepare this swap. Get a fresh quote and try again."],
  ["swaps are not available on this network", "Swaps aren't available on this network."],
  [
    "swap build touched an unexpected token approval",
    "Blocked for safety: the swap asked to approve the wrong token. Nothing was signed.",
  ],
  ["token list unavailable", "Couldn't load the token list. Check your connection and try again."],
  // Fires on every network, so the copy stays endpoint-generic; the devnet-only
  // `--chain-id SN_DEVNET` flag is stated by the network picker instead.
  [
    WRONG_CHAIN_MESSAGE.toLowerCase(),
    "That endpoint reports a different Starknet chain, so nothing was submitted. Check the endpoint under Network → Advanced.",
  ],
]);

// Every "invalid <...> request" validation string shares one friendly message.
const VALIDATION_REQUEST = /^invalid .+ request$/;
const RATE_LIMIT = /(?:\b429\b|rate[- ]?limit|too many requests)/i;
const RAW_RPC = /(?:^\s*RPC:|\bstarknet_[a-zA-Z0-9_]+\b[\s\S]*\bparams\b|\bwith params\s*\{)/i;
const RAW_RPC_RESPONSE =
  /(?:^\s*(?:20|24|41|55):|\baccount validation failed\b|\bblock not found(?:: undefined)?\b|\bcontract not found(?:: undefined)?\b|\bresource bounds? (?:were )?not satisfied\b|\btransaction execution error\b)/i;
const RAW_HTTP = /(?:\bHTTP\s+[45]\d\d\b|\bresponse body\b|\brequest rejected\s*[:{[])/i;
const rawServiceDiagnostic = (value: string): boolean =>
  value.length > 240 ||
  /[\r\n]/.test(value) ||
  RAW_HTTP.test(value) ||
  /^\s*[[{][\s\S]*[\]}]\s*$/.test(value);

/**
 * Classifies a raw error string into user-facing copy. Unrecognized non-empty
 * strings remain visible while the toast's copy control retains the original
 * diagnostic for a bug report.
 */
export const friendlyError = (raw: string): FriendlyError => {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { message: UNEXPECTED_FALLBACK };
  }

  const normalized = trimmed.toLowerCase();
  const exact = EXACT.get(normalized);
  if (exact) {
    return { message: exact };
  }

  if (VALIDATION_REQUEST.test(normalized)) {
    return { message: GENERIC_VALIDATION };
  }

  const networkError = friendlyNetworkError(trimmed);
  if (networkError) {
    return { message: networkError };
  }

  if (RATE_LIMIT.test(trimmed)) {
    return { message: RATE_LIMITED };
  }

  if (RAW_RPC.test(trimmed) || RAW_RPC_RESPONSE.test(trimmed)) {
    return { message: RPC_REJECTED };
  }

  if (rawServiceDiagnostic(trimmed)) {
    return { message: SERVICE_REJECTED };
  }

  return { message: trimmed };
};
