/**
 * Maps raw internal error strings surfaced by the background and runtime layers
 * to friendly, user-facing copy for toasts and status lines, and decides whether
 * a copy-to-clipboard affordance is warranted. The mapping is a pure lookup with
 * no DOM, clock, or network access so it can be unit-tested in isolation.
 */

import { WRONG_CHAIN_MESSAGE } from "@mc-wallet/starknet/provider";

/**
 * The result of classifying a raw error string for display.
 */
export interface FriendlyError {
  /** Human-readable message safe to show to the user. */
  message: string;
  /**
   * Whether the original error looked genuinely unexpected (internal) and is
   * therefore worth offering a copy-to-clipboard affordance for a bug report.
   * Known validation and user-facing conditions are `false`.
   */
  copyable: boolean;
}

const GENERIC_VALIDATION =
  "Something about that request wasn't right. Check the details and try again.";
const WALLET_UNAVAILABLE = "The wallet is locked or unavailable. Unlock it and try again.";
const NETWORK_UNREACHABLE = "Couldn't reach the network. Check your connection and try again.";
const UNEXPECTED_FALLBACK = "Something went wrong. Please try again.";

// Exact raw strings the background/runtime layers throw for recoverable,
// user-facing conditions. Matching here means we never show a copy control.
const EXACT: ReadonlyMap<string, string> = new Map([
  ["wallet unavailable", WALLET_UNAVAILABLE],
  // Platform fetch/network rejections bubble up with these messages.
  ["failed to fetch", NETWORK_UNREACHABLE],
  ["network error", NETWORK_UNREACHABLE],
  ["load failed", NETWORK_UNREACHABLE],
  // Swap (AVNU) conditions a user can act on — explained, never copyable.
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

/**
 * Classifies a raw error string into user-facing copy plus whether a
 * copy-to-clipboard affordance should be offered. Unrecognized non-empty
 * strings are treated as genuinely unexpected internal errors: the original
 * text is kept and marked copyable so a user can share it for a bug report.
 */
export const friendlyError = (raw: string): FriendlyError => {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { message: UNEXPECTED_FALLBACK, copyable: false };
  }

  const normalized = trimmed.toLowerCase();
  const exact = EXACT.get(normalized);
  if (exact) {
    return { message: exact, copyable: false };
  }

  if (VALIDATION_REQUEST.test(normalized)) {
    return { message: GENERIC_VALIDATION, copyable: false };
  }

  return { message: trimmed, copyable: true };
};
