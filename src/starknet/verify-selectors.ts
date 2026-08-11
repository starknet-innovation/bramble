/**
 * The wallet's selector vocabulary: which entrypoint names mean "grant spending
 * authority", "grant collection-wide transfer authority", and "move a token on
 * someone's behalf". Kept in one dependency-free module because every layer that
 * reasons about a call — the pre-sign reviewer (./verify), the allowance
 * bookkeeping (./allowances), and the swap build policy
 * (../background/swap-ops) — must agree on it exactly; a spelling that is a
 * grant to one layer and an opaque call to another is precisely how
 * `increase_allowance` once bypassed the review card.
 *
 * Every predicate here matches EXACTLY: the entrypoint is untrusted text from a
 * dapp, an aggregator response, or a stored proposal, so no case folding and no
 * normalization. An unrecognized selector reports false and is routed to the
 * opaque-call summary rather than being allowed to claim known semantics.
 */

/**
 * Entrypoints that grant an ERC20 spending allowance, all sharing the
 * `(spender, amount_low, amount_high)` calldata shape. OpenZeppelin's Cairo
 * ERC20 shipped `increase_allowance` (and its camelCase dual
 * `increaseAllowance`) for years, so a one-word selector change must not change
 * what the user is shown. Exported so the reviewer's decoder table enumerates
 * this set rather than listing the spellings a second time.
 */
export const APPROVE_ENTRYPOINTS: readonly string[] = [
  "approve",
  "increaseAllowance",
  "increase_allowance",
];

// The duals that LOWER an allowance. Deliberately not part of the grant list: a
// decrease hands out no spending authority, so the reviewer must not summarize
// it as a grant — but bookkeeping still has to see it, or the log keeps
// reporting an allowance the user has already pulled back.
const DECREASE_ENTRYPOINTS: readonly string[] = ["decreaseAllowance", "decrease_allowance"];

/**
 * Entrypoints that grant collection-wide operator authority over an NFT
 * contract, with `(operator, approved)` calldata. A different SHAPE from the
 * ERC20 allowance duals, which is why this is a separate list rather than more
 * rows in {@link APPROVE_ENTRYPOINTS}: folding it in would make the allowance
 * decoders read a bool as a uint256 limb and would silently widen the swap
 * build policy's approval filter.
 */
export const OPERATOR_APPROVAL_ENTRYPOINTS: readonly string[] = [
  "setApprovalForAll",
  "set_approval_for_all",
];

/**
 * Reports whether an entrypoint grants an ERC20 spending allowance: `approve`
 * or either spelling of OpenZeppelin's `increase_allowance` dual. Exact match;
 * any other selector reports false.
 */
export const isApproveEntrypoint = (entrypoint: string): boolean =>
  APPROVE_ENTRYPOINTS.includes(entrypoint);

/**
 * Reports whether an entrypoint LOWERS an ERC20 allowance (either spelling of
 * the `decrease_allowance` dual). Exact match; any other selector reports false.
 */
export const isDecreaseAllowanceEntrypoint = (entrypoint: string): boolean =>
  DECREASE_ENTRYPOINTS.includes(entrypoint);

/**
 * Reports whether an entrypoint grants collection-wide operator authority over
 * an NFT contract (either spelling of `set_approval_for_all`). Exact match; any
 * other selector reports false.
 *
 * This grants strictly MORE than any ERC20 allowance — every item the owner
 * holds in that collection, present and future, until revoked — so callers must
 * treat a true result as at least as dangerous as an unlimited approval.
 */
export const isOperatorApprovalEntrypoint = (entrypoint: string): boolean =>
  OPERATOR_APPROVAL_ENTRYPOINTS.includes(entrypoint);

/**
 * Reports whether an entrypoint moves a token on an owner's behalf
 * (`transfer_from`, `safe_transfer_from`, or either camelCase dual). Exact
 * match; any other selector reports false. Shared so the decode branch and the
 * recipient-index flag logic can never drift on which felt is the recipient.
 */
export const isTransferFromEntrypoint = (entrypoint: string): boolean =>
  entrypoint === "transfer_from" ||
  entrypoint === "transferFrom" ||
  entrypoint === "safe_transfer_from" ||
  entrypoint === "safeTransferFrom";
