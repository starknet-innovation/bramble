/**
 * Cross-layer limits for one dapp-provided Starknet invoke. Provider and
 * background parsers consume the same values so a payload accepted in the page
 * world cannot expand after crossing into the privileged worker.
 */
export const INVOKE_LIMITS = {
  calldataFelts: 4_096,
  calls: 16,
  entrypointCharacters: 64,
  // 66 chars covers 0x-prefixed hex; 78 also admits the equivalent decimal
  // notation accepted by starknet.js without leaving the bounded envelope.
  feltCharacters: 78,
} as const;
