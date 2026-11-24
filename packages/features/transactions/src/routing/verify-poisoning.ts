/**
 * Address-poisoning primitives for ./verify: whether one address mimics another,
 * and which address a grant authorizes. ./verify owns the trusted set and the
 * refusal; this module only answers those two questions.
 *
 * Trust boundary: calls and candidates are untrusted. The spender position comes
 * from the selector alone (./verify-selectors `spenderFeltIndex`), never from
 * whether the call decoded, so the refusal still runs on a span the wallet
 * cannot describe.
 */

import { asFelt } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import type { VerificationContext } from "./verification-context";
import {
  canonical,
  isWatchedNftContract,
  readAddressAt,
  readUint256At,
  tokenFor,
} from "./verify-decode";
import { OPERATOR_APPROVAL_ENTRYPOINTS, spenderFeltIndex } from "./verify-selectors";

// The visible `0x` + four digits a felt shows in each zero-padded spelling,
// from the canonical form up to the 64-digit padded one. Past four leading
// zeros every spelling renders `0x0000`, so the set is at most five windows.
const displayPrefixes = (value: string): ReadonlySet<string> => {
  const digits = value.startsWith("0x") ? value.slice(2) : value;
  const maxZeros = Math.min(4, Math.max(0, 64 - digits.length));
  const prefixes = new Set<string>();
  for (let zeros = 0; zeros <= maxZeros; zeros += 1) {
    prefixes.add(`${"0".repeat(zeros)}${digits}`.slice(0, 4));
  }
  return prefixes;
};

/**
 * Detects address poisoning: a candidate that visually mimics a trusted
 * address (same leading and trailing digits) while being a different account.
 * Every spelling the wallet can render is compared, not only the canonical
 * form (accounts) and the 64-digit padded form (contacts): a typed recipient was
 * once labelled with the spelling the user pasted, so an attacker who handed out
 * a partially zero-padded address controlled which window was displayed. Matching
 * only the canonical window let 15 of every 16 twins of a padded contact pass,
 * and matching canonical plus padded still let a one-leading-zero spelling
 * render exactly like the padded contact (audit #242). Labels now always show
 * the padded window, but the check still compares every spelling rather than
 * trusting the label.
 */
export const isLookalikeAddress = (candidate: string, trusted: string): boolean => {
  const left = canonical(candidate).toLowerCase();
  const right = canonical(trusted).toLowerCase();
  if (left === right) {
    return false;
  }
  if (left.slice(-4) !== right.slice(-4)) {
    return false;
  }
  const trustedPrefixes = displayPrefixes(right);
  return [...displayPrefixes(left)].some((prefix) => trustedPrefixes.has(prefix));
};

// A grant that can only take reach away: ERC20 `approve(spender, 0)` on a token
// this wallet tracks, or `set_approval_for_all(operator, false)`. Both reset a
// grant that may already stand, and refusing them would leave a past poisoned
// grant unrevokable. ERC721 `approve(to, 0)` names token id zero — a real grant
// with the same calldata — so an `approve` on a contract that is not a tracked
// fungible token never counts as a revoke. An increase by zero is not exempt:
// it does nothing, so refusing it costs nothing.
const isRevokingGrant = (
  call: Call,
  calldata: readonly unknown[],
  context: VerificationContext,
): boolean => {
  if (OPERATOR_APPROVAL_ENTRYPOINTS.includes(call.entrypoint)) {
    return calldata.length === 2 && asFelt(calldata[1]) === 0n;
  }
  return (
    call.entrypoint === "approve" &&
    calldata.length === 3 &&
    readUint256At(calldata, 1, 2) === 0n &&
    tokenFor(context.tokens, call.contractAddress) !== undefined &&
    !isWatchedNftContract(context, call.contractAddress)
  );
};

/**
 * The spender or operator a grant authorizes, or "" when the entrypoint grants
 * nothing or the call only revokes (see `isRevokingGrant`). Fails toward
 * checking: a call whose revoke shape is not exact returns its spender.
 */
export const spenderForFlags = (
  call: Call,
  calldata: readonly unknown[],
  context: VerificationContext,
): string => {
  const index = spenderFeltIndex(call.entrypoint);
  return index === null || isRevokingGrant(call, calldata, context)
    ? ""
    : readAddressAt(calldata, index);
};
