/** Local-only association of wallet activity with verified public score rows. */
import { canonicalFelt } from "@mc-wallet/wallet-model/networks";
import type { WithdrawalScore } from "./score-schema";
import {
  type AvailablePrivacyScore,
  type PrivacyScoreState,
  privacyScoreBand,
} from "./score-types";

/**
 * Public transaction evidence retained by the wallet activity log.
 */
export type PrivacyScoreTransaction = {
  readonly hash: string;
};

const median = (scores: readonly number[]): number => {
  const sorted = [...scores].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const indexWithdrawals = (
  withdrawals: readonly WithdrawalScore[],
): ReadonlyMap<string, readonly WithdrawalScore[]> => {
  const byTransaction = new Map<string, WithdrawalScore[]>();
  for (const withdrawal of withdrawals) {
    const key = canonicalFelt(withdrawal.transactionHash);
    if (key) {
      const scores = byTransaction.get(key) ?? [];
      scores.push(withdrawal);
      byTransaction.set(key, scores);
    }
  }
  return byTransaction;
};

const localMatches = (
  withdrawals: readonly WithdrawalScore[],
  transactions: readonly PrivacyScoreTransaction[],
): { readonly ambiguous: boolean; readonly matched: readonly WithdrawalScore[] } => {
  const byTransaction = indexWithdrawals(withdrawals);
  const matched: WithdrawalScore[] = [];
  let ambiguous = false;
  for (const transaction of transactions) {
    const key = canonicalFelt(transaction.hash);
    const candidates = key ? (byTransaction.get(key) ?? []) : [];
    if (candidates.length === 1) {
      matched.push(candidates[0] as WithdrawalScore);
    } else if (candidates.length > 1) {
      ambiguous = true;
    }
  }
  return { ambiguous, matched };
};

/**
 * Matches only transaction hashes with exactly one withdrawal row. A
 * multi-withdrawal transaction is deliberately ambiguous without the SDK's
 * local event identity and never receives a guessed score.
 */
export const summarizePrivacyScores = (
  withdrawals: readonly WithdrawalScore[],
  transactions: readonly PrivacyScoreTransaction[],
  snapshot: { readonly generatedAt: string; readonly snapshotBlockNumber: number },
): PrivacyScoreState => {
  const { ambiguous, matched } = localMatches(withdrawals, transactions);
  if (ambiguous) {
    return { status: "unavailable" };
  }
  if (matched.length === 0) {
    return { status: "pending" };
  }
  const unique = [...new Map(matched.map((score) => [score.eventId, score])).values()];
  const lowest = unique.reduce((current, candidate) =>
    candidate.score < current.score ? candidate : current,
  );
  const scores = unique.map((score) => score.score);
  const summary: AvailablePrivacyScore = {
    band: privacyScoreBand(lowest.score),
    candidateCount: lowest.candidateCount,
    confidence: lowest.confidence,
    effectiveAnonymitySet: lowest.effectiveAnonymitySet,
    factors: lowest.factors,
    generatedAt: snapshot.generatedAt,
    matchedWithdrawals: unique.length,
    maximumScore: Math.max(...scores),
    medianScore: median(scores),
    minimumScore: lowest.score,
    score: lowest.score,
    snapshotBlockNumber: snapshot.snapshotBlockNumber,
    status: "available",
  };
  return summary;
};
