/**
 * Cross-layer limits for one dapp-provided Starknet invoke. Provider and
 * background parsers consume the same values so a payload accepted in the page
 * world cannot expand after crossing into the privileged worker.
 *
 * These bound each field for parsing. They are not a promise that an invoke
 * within all of them can be reviewed: one call may still spend the whole
 * approval budget on calldata, and the approval queue refuses that at enqueue
 * with "Request too large to review" (Sherlock 157). The binding check is
 * `fitsSidePanel` against `REVIEWABLE_APPROVAL_BUDGET` (the provider JSON
 * budget minus 16 KiB and 512 nodes, the headroom a fee review adds after
 * admission). Its worst case charges every call one 300-character summary,
 * seven flag slots, and one review asset, which is what a fully flagged card
 * has to render.
 *
 * `calls` is the largest count of minimal calls that still passes that check:
 * one calldata felt, a one-character entrypoint, and a single-digit address.
 * 56 fits and 57 does not. An empty calldata array fits 57, and the same call
 * with a 66-character address fits 55; a longer call is refused by the review
 * budget rather than by this count. The count stays finite so the privileged
 * worker rejects an over-long list before it walks it. The page message's
 * array budget is 4,096 and a runtime message of these minimal calls still
 * fits the provider JSON budget past 2,500, so neither is the limit.
 *
 * Nothing in the protocol is tighter. Starknet 0.14.4 caps transaction
 * calldata at 5,000 felts. Cairo 1 execute calldata for this shape is one
 * length felt plus four felts per call (to, selector, calldata length, and the
 * one argument): 225 felts at 56 calls, and 1,249 calls before the cap. Argent
 * Account 0.4, the OpenZeppelin account, and Braavos loop the calls array with
 * no length assert. Fee estimation submits that same calldata in one
 * `starknet_estimateFee`. A Ledger account blind-signs the transaction hash;
 * the calls are reviewed on the card, which lists every summary and every
 * exact call in the scrolling approval panel.
 *
 * The other per-field bounds stay wider than the 56-call worst case on
 * purpose. A site may spend the budget on one long call or on many short ones,
 * and lowering calldata to what 56 calls leave over would refuse a shorter
 * batch that fits.
 *
 * Frozen Argent multisig intents do not use this count. They keep
 * `ARGENT_MULTISIG_INVOKE_LIMITS` (16 calls, 512 calldata felts, execute
 * calldata 1 + 16 * 3 + 512). That budget is the stored proposal, and raising
 * it means re-deriving the encoding and re-checking the gift wrap.
 */
export const INVOKE_LIMITS = {
  calldataFelts: 4_096,
  calls: 56,
  entrypointCharacters: 64,
  // 66 chars covers 0x-prefixed hex; 78 also admits the equivalent decimal
  // notation accepted by starknet.js without leaving the bounded envelope.
  feltCharacters: 78,
} as const;
