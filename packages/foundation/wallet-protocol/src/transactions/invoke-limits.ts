/**
 * Cross-layer limits for one dapp-provided Starknet invoke. Provider and
 * background parsers consume the same values so a payload accepted in the page
 * world cannot expand after crossing into the privileged worker.
 *
 * These bound each field for parsing; they are not a promise that an invoke
 * within all of them can be reviewed. Together they allow far more than the
 * side panel can show (16 calls of 4,096 felts is several megabytes), so the
 * binding limit is the approval queue's review budget, which refuses a larger
 * request at enqueue with "Request too large to review" (Sherlock 157). The
 * per-field bounds stay wider on purpose: a site may spend its budget on one
 * long call or on many short ones, and lowering them to the budget's worst case
 * would refuse ordinary requests that fit.
 */
export const INVOKE_LIMITS = {
  calldataFelts: 4_096,
  calls: 16,
  entrypointCharacters: 64,
  // 66 chars covers 0x-prefixed hex; 78 also admits the equivalent decimal
  // notation accepted by starknet.js without leaving the bounded envelope.
  feltCharacters: 78,
} as const;
