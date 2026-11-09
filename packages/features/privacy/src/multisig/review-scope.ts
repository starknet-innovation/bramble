/**
 * The scope every multisig STRK20 review is decoded against, and the lines it
 * contributes. Every field comes from this wallet's own records, never from a
 * co-owner's package.
 */

import { formatTokenAmount } from "@bramble/starknet/rpc";
import { sameFelt } from "@bramble/wallet-model/networks";

/** A token the wallet tracks on this network. */
export type MultisigStrk20ReviewToken = {
  readonly address: string;
  readonly decimals: number;
  readonly symbol: string;
};

/** The account, network, pool, and tracked tokens a review is decoded against. */
export type MultisigStrk20ReviewScope = {
  readonly accountAddress: string;
  readonly chainId: string;
  readonly network: string;
  readonly poolAddress: string;
  readonly tokens: readonly MultisigStrk20ReviewToken[];
};

/** A decoded card: the contract and function, then one line per fact. */
export type MultisigStrk20Review = {
  readonly lines: readonly string[];
  readonly title: string;
};

/**
 * `1.5 STRK` for a tracked token, in that token's decimals. Returns null for a
 * token the wallet does not track, so the caller refuses the review.
 */
export const reviewAmount = (
  token: string,
  raw: bigint,
  tokens: readonly MultisigStrk20ReviewToken[],
): string | null => {
  const known = tokens.find((candidate) => sameFelt(candidate.address, token));
  return known ? `${formatTokenAmount(raw, known.decimals)} ${known.symbol}` : null;
};

/** The account and network lines every card starts with. */
export const reviewScopeLines = (scope: MultisigStrk20ReviewScope): readonly string[] => [
  `Account ${scope.accountAddress}`,
  `Network ${scope.network}`,
];
