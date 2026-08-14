/**
 * Pure decoding of the ERC20 calls that CHANGE a spending allowance — `approve`,
 * both spellings of OpenZeppelin's `increase_allowance` dual, and both spellings
 * of `decrease_allowance` — into allowance-log inputs. Network-free so every
 * rule is unit-testable. The revoke call itself is built with
 * `buildErc20ApproveCall` in @mc-wallet/starknet/rpc; persistence and the ERC20
 * arithmetic that applies a decoded delta to the tracked total both live inside
 * the allowance store (./allowance-store.ts), and the background
 * allowance-recording module is the one caller every submitting path goes
 * through.
 *
 * An ERC721 `approve(to, token_id)` is byte-for-byte an ERC20
 * `approve(spender, amount)`, so nothing here can tell them apart from the call
 * alone. {@link approvedAssetKind} states what the wallet's own registries can
 * say about the contract, and every consumer decides on that answer rather than
 * assuming ERC20.
 */

import { isBaseUnitsAmount } from "@mc-wallet/core/json";
import type {
  AllowanceInput,
  AllowanceOwner,
  AllowanceRecord,
} from "@mc-wallet/transactions/allowance-store";
import { allowancePairKey } from "@mc-wallet/transactions/verify";
import { uint256Felts } from "@mc-wallet/wallet-model/networks";
import type { Call } from "starknet";
import { isWatchedNftContract, tokenFor, type VerificationContext } from "../routing/verify-decode";
import { isApproveEntrypoint, isDecreaseAllowanceEntrypoint } from "../routing/verify-selectors";

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
// (@mc-wallet/transactions/verify-selectors), so the reviewer and the
// bookkeeping can never disagree
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
 * build, or a frozen multisig intent). Returns null — never a guess — for any
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
 * What the wallet's own registries can say about the contract an
 * approve-shaped call targets: `collection` for an NFT contract this account
 * watches (its second argument is an item id, never an amount), `fungible` for
 * a token this account tracks, and `unknown` for a contract in neither list.
 *
 * `unknown` is genuinely unknown, not "probably ERC20": the two calls share an
 * arity, so a contract the wallet has never been told about could be either.
 * Callers must fail closed on it rather than act as if the second argument were
 * a spendable amount.
 */
export type ApprovedAssetKind = "collection" | "fungible" | "unknown";

/**
 * The two registries {@link approvedAssetKind} decides from. A narrowed
 * {@link VerificationContext}, so the trusted set is scoped by the one shared
 * builder (`verificationContext`) rather than by a second per-network filter.
 */
export type ApprovedAssets = Pick<VerificationContext, "nftContracts" | "tokens">;

/**
 * Classifies the contract an approve-shaped call targets against the account's
 * trusted registries.
 *
 * Pure and total: it reads only the lists it is handed, and a contract in
 * neither is reported as `unknown` rather than guessed either way.
 */
export const approvedAssetKind = (
  assets: ApprovedAssets,
  contractAddress: string,
): ApprovedAssetKind => {
  if (isWatchedNftContract(assets, contractAddress)) {
    return "collection";
  }
  return tokenFor(assets.tokens, contractAddress) === undefined ? "unknown" : "fungible";
};

/**
 * Turns the allowance log into the standing totals the pre-sign reviewer seeds
 * its unlimited-approval rule from, for one owner scope.
 *
 * Trust boundary: every record is one this wallet wrote when it submitted a
 * grant, never a figure a site supplied. Two rules keep a seeded total from
 * inventing a warning rather than merely missing one:
 *   - only contracts {@link approvedAssetKind} calls `fungible` are seeded, so
 *     an ERC721 item id can never be added to an amount;
 *   - a record marked `lowerBound` is seeded at its bound, which understates the
 *     true allowance at worst.
 * A record whose amount is not a decimal integer is skipped. The result may be
 * stale — a spender may have consumed part of the allowance since — so a seeded
 * total can over-state a grant the user really did make, and the reviewer may
 * then warn about a cap that no longer stands. Over-warning is the direction
 * this is allowed to be wrong in: the flag it feeds annotates the review card
 * and refuses nothing.
 */
export const standingAllowanceTotals = (
  records: readonly AllowanceRecord[],
  owner: AllowanceOwner,
  assets: ApprovedAssets,
): ReadonlyMap<string, bigint> => {
  const totals = new Map<string, bigint>();
  for (const record of records) {
    if (
      record.accountId !== owner.accountId ||
      record.networkId !== owner.networkId ||
      approvedAssetKind(assets, record.token) !== "fungible" ||
      !isBaseUnitsAmount(record.amount)
    ) {
      continue;
    }
    totals.set(allowancePairKey(record.token, record.spender), BigInt(record.amount));
  }
  return totals;
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
 *
 * A call on a collection this account watches is dropped too: its second
 * argument is an item id, and an item id filed as an allowance amount is both a
 * meaningless figure and a row whose "revoke" would broadcast
 * `approve(spender, 0)` at an ERC721 — under that standard an approval of item
 * #0, the opposite of a revocation. For a contract of `unknown` kind the log
 * still holds the grant (a dapp's own ERC20 is the common case, and an
 * unrecorded grant can never be revoked), but the amount is only an ERC20
 * allowance once the manager can confirm the contract is fungible — see
 * {@link approvedAssetKind} and the background allowance-ops module.
 */
export const allowanceChangesFromCalls = (
  calls: readonly Call[],
  owner: AllowanceOwner,
  assets: ApprovedAssets,
): readonly AllowanceChange[] =>
  calls.flatMap((call) => {
    const decoded = decodeAllowanceCall(call);
    if (!decoded || (decoded.kind !== "set" && decoded.amount === 0n)) {
      return [];
    }
    if (approvedAssetKind(assets, call.contractAddress) === "collection") {
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
