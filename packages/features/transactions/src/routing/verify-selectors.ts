/**
 * The wallet's selector vocabulary: which entrypoint names mean "grant spending
 * authority", "grant collection-wide transfer authority", and "move a token on
 * someone's behalf". Kept in one dependency-free module because every layer that
 * reasons about a call — the pre-sign reviewer (./verify), the allowance
 * bookkeeping (./allowances), and the swap build policy
 * (the extension's background/transactions/swap-build-policy.ts) — must agree on it exactly; a spelling that is a
 * grant to one layer and an opaque call to another is precisely how
 * `increase_allowance` once bypassed the review card.
 *
 * Every predicate here matches EXACTLY: the entrypoint is untrusted text from a
 * dapp, an aggregator response, or a stored proposal, so no case folding and no
 * normalization. An unrecognized selector reports false and is routed to the
 * opaque-call summary rather than being allowed to claim known semantics.
 *
 * Its one import is the pinned AVNU route layout, so the swap payee's position
 * is read from that pin rather than restated here.
 */

import {
  AVNU_BENEFICIARY_FELT_INDEX,
  AVNU_MULTI_ROUTE_SWAP,
} from "@bramble/wallet-model/avnu-route";

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
 * The plain `transfer_from(from, to, amount_or_id: u256)` duals: four felts,
 * shared by ERC20 and ERC721.
 */
export const PLAIN_TRANSFER_FROM_ENTRYPOINTS: readonly string[] = ["transferFrom", "transfer_from"];

/**
 * The single-item safe-transfer duals. ONE selector name covers two different
 * calldata shapes: ERC721's `(from, to, token_id: u256, data: Span<felt252>)` —
 * five felts when the data span is empty — and ERC1155's `(from, to, id: u256,
 * value: u256, data: Span<felt252>)` at seven. Listing the spelling here says
 * only "this moves a token on an owner's behalf"; deciding which shape a given
 * span is, or refusing to decide, is the decoder's job.
 */
export const SAFE_TRANSFER_FROM_ENTRYPOINTS: readonly string[] = [
  "safeTransferFrom",
  "safe_transfer_from",
];

/**
 * The ERC1155 batch safe-transfer duals, `(from, to, ids: Span<u256>, values:
 * Span<u256>, data: Span<felt252>)`. A separate list because the batch span is a
 * different shape from every other transfer, but the same first two arguments —
 * which is the whole reason recipient enforcement can cover it without the
 * wallet being able to summarize it.
 */
export const BATCH_TRANSFER_FROM_ENTRYPOINTS: readonly string[] = [
  "safeBatchTransferFrom",
  "safe_batch_transfer_from",
];

// Every spelling that moves a token on an owner's behalf, in every standard the
// wallet knows. Derived from the three shape lists rather than written out again
// so a spelling can never be enforced without also being dispatched, or the
// reverse — the gap that let a five-felt ERC721 safe transfer reach signing with
// its recipient never inspected.
const TRANSFER_FROM_ENTRYPOINTS: readonly string[] = [
  ...PLAIN_TRANSFER_FROM_ENTRYPOINTS,
  ...SAFE_TRANSFER_FROM_ENTRYPOINTS,
  ...BATCH_TRANSFER_FROM_ENTRYPOINTS,
];

/**
 * Which calldata felt carries the address a call PAYS, or null when the
 * entrypoint is not one the wallet recognizes as paying anyone.
 *
 * This is the wallet's recipient ENFORCEMENT vocabulary, and it answers from the
 * selector alone — never from whether a decoder managed to describe the call.
 * The two must stay separate: a summary decoder legitimately gives up on a span
 * it cannot attribute to one standard, and if enforcement were gated on that
 * decode succeeding, the address-poisoning refusal and the self-send warning
 * would silently switch off for exactly the shapes the wallet understands least.
 * Every `*transfer_from` spelling puts `to` second whatever follows it, and
 * ERC20 `transfer(to, amount)` puts it first, so the index is knowable from the
 * name even when the rest of the span is not. AVNU's `multi_route_swap` pays its
 * proceeds to the `beneficiary` felt of the pinned route layout, so a dapp swap
 * whose payee mimics a saved address is refused like any other poisoned send.
 *
 * Exact match; any other selector — including the allowance and operator grants,
 * whose first felt is a SPENDER the user is authorizing rather than an address
 * being paid — reports null, and callers must then run no recipient rule at all
 * rather than inventing a recipient from felt zero.
 */
export const recipientFeltIndex = (entrypoint: string): number | null => {
  if (entrypoint === "transfer") {
    return 0;
  }
  if (entrypoint === AVNU_MULTI_ROUTE_SWAP) {
    return AVNU_BENEFICIARY_FELT_INDEX;
  }
  return TRANSFER_FROM_ENTRYPOINTS.includes(entrypoint) ? 1 : null;
};
