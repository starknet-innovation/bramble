/**
 * Pure decoding of the ERC20 calls that CHANGE a spending allowance — `approve`,
 * both spellings of OpenZeppelin's `increase_allowance` dual, and both spellings
 * of `decrease_allowance` — into allowance-log inputs. Network-free so every
 * rule is unit-testable. The revoke call itself is built with
 * `buildErc20ApproveCall` in ./rpc; persistence and the ERC20 arithmetic that
 * applies a decoded delta to the tracked total both live inside the allowance
 * store (../storage/allowance-store.ts), and ../background/allowance-recording.ts
 * is the one caller every submitting path goes through.
 */
import type { Call } from "starknet";
import type { AllowanceInput, AllowanceOwner } from "../storage/allowance-store";
import { uint256Felts } from "./networks";
import { isApproveEntrypoint, isDecreaseAllowanceEntrypoint } from "./verify-selectors";

/**
 * How a call changes the standing allowance, in ERC20's own terms: `approve`
 * SETS it to the decoded amount, an increase ADDS the amount to it, a decrease
 * SUBTRACTS the amount from it. Keeping the distinction in the decode is what
 * lets the log hold the running total instead of whichever amount was last
 * seen.
 */
export type AllowanceChangeKind = "decrease" | "increase" | "set";

/**
 * One decoded allowance-changing call: who may spend, by how much, and whether
 * the amount is an absolute cap or a delta.
 */
export type DecodedAllowanceCall = {
  readonly amount: bigint;
  readonly kind: AllowanceChangeKind;
  readonly spender: string;
};

// Which spellings mean what comes from the shared selector vocabulary
// (./verify-selectors), so the reviewer and the bookkeeping can never disagree
// about whether a call grants spend. Exact matching, no case folding: the
// entrypoint is untrusted text from a dapp or a stored proposal, and an
// unrecognized selector must decode as nothing rather than be normalized into a
// spelling the token would not honor.
const changeKind = (entrypoint: string): AllowanceChangeKind | null => {
  if (entrypoint === "approve") {
    return "set";
  }
  if (isApproveEntrypoint(entrypoint)) {
    return "increase";
  }
  return isDecreaseAllowanceEntrypoint(entrypoint) ? "decrease" : null;
};

/**
 * Decodes one ERC20 allowance-changing call `(spender, amount_low, amount_high)`
 * into its spender, amount, and {@link AllowanceChangeKind}.
 *
 * Trust boundary: the call is untrusted input (a dapp request, an aggregator
 * build, or a stored multisig proposal). Returns null — never a guess — for any
 * other entrypoint and for calldata that is not a well-formed spender plus
 * uint256 limb pair, so a malformed or unknown call is tracked as nothing
 * rather than as an allowance the token never granted.
 */
export const decodeAllowanceCall = (call: Call): DecodedAllowanceCall | null => {
  const kind = changeKind(call.entrypoint);
  if (!kind) {
    return null;
  }
  const calldata = Array.isArray(call.calldata) ? call.calldata : [];
  const spender = typeof calldata[0] === "string" ? calldata[0] : null;
  const amount = uint256Felts(calldata[1], calldata[2]);
  if (spender === null || amount === null) {
    return null;
  }
  return { amount, kind, spender };
};

/**
 * One allowance change to apply to the log: the store input naming the owner,
 * token, spender, and amount, plus how that amount relates to the standing
 * allowance.
 */
export type AllowanceChange = {
  readonly input: AllowanceInput;
  readonly kind: AllowanceChangeKind;
};

/**
 * Extracts every allowance change in a submitted transaction, scoped to the
 * account that submitted it (for a multisig execution, to the multisig that
 * owns the allowance — not to the signer that broadcast it).
 *
 * Pure and total: calls that change no allowance are dropped, and so is an
 * increase or decrease of zero — it moves nothing on chain, while the store
 * reads a zero amount as a removal, so recording one would erase a grant the
 * token still honors.
 */
export const allowanceChangesFromCalls = (
  calls: readonly Call[],
  owner: AllowanceOwner,
): readonly AllowanceChange[] =>
  calls.flatMap((call) => {
    const decoded = decodeAllowanceCall(call);
    if (!decoded || (decoded.kind !== "set" && decoded.amount === 0n)) {
      return [];
    }
    return [
      {
        input: {
          accountId: owner.accountId,
          amount: decoded.amount.toString(),
          networkId: owner.networkId,
          spender: decoded.spender,
          token: call.contractAddress,
        },
        kind: decoded.kind,
      },
    ];
  });
