/**
 * Encoding bounds for one dapp-provided Starknet invoke. Provider and
 * background parsers consume the same values so a payload accepted in the page
 * world cannot expand after crossing into the privileged worker.
 *
 * Starknet does not cap how many calls a multicall contains, and these bounds
 * do not copy the network's calldata or gas caps. The node enforces those at
 * submission, and a refusal is shown with the node's own reason. What decides
 * whether a batch can be shown is the side-panel review budget (`fitsSidePanel`,
 * "Request too large to review", Sherlock 157).
 *
 * `calls` is the most minimal calls that budget can ever admit: one calldata
 * felt, a one-character entrypoint and a single-digit address fit 56, and 57
 * do not. Realistic calls with full addresses fit fewer (about 47 to 55,
 * depending on calldata), and those are refused by the budget, not this
 * count. The count stays finite so both parsers reject an over-long list
 * before the privileged worker walks it.
 *
 * `calldataFelts` is that generic array budget (`JSON_BUDGETS` maxArrayLength,
 * 4,096) applied to one call's calldata, so a single array cannot exceed the
 * message cap. It is not Starknet's 5,000-felt transaction calldata limit.
 * That limit is on the compiled execute payload, the node enforces it when
 * the transaction is submitted, and this parser does not check it.
 *
 * `entrypointCharacters` is an identifier bound. A Starknet selector is a
 * felt; the protocol does not limit the name's length. The parser accepts a
 * Cairo-style identifier of at most 64 characters and refuses anything else
 * before it is hashed.
 *
 * `feltCharacters` is the character envelope of one felt before it is parsed:
 * 66 covers `0x` plus 64 hex digits, and 78 also admits the decimal form
 * starknet.js accepts. A longer string is not a field element.
 *
 * Frozen Argent multisig intents do not use these bounds. They keep
 * `ARGENT_MULTISIG_INVOKE_LIMITS`, the stored-proposal budget.
 */
export const INVOKE_LIMITS = {
  calldataFelts: 4_096,
  calls: 56,
  entrypointCharacters: 64,
  // 66 chars covers 0x-prefixed hex; 78 also admits the equivalent decimal
  // notation accepted by starknet.js without leaving the bounded envelope.
  feltCharacters: 78,
} as const;
