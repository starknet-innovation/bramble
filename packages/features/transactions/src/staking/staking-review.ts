/**
 * The review sentence for a staking action: what the reviewed calls do, in
 * the wording the user confirms. This is signing text, edited only as part of
 * the reviewed approval group ("did we lose a fact?").
 *
 * Rewards are STRK for every pool, BTC pools included, so a claim names STRK.
 *
 * The facts it carries are the ones the calls themselves cannot show: a stake
 * also approves exactly its amount for the pool; an unstake earns nothing
 * while it waits; and a membership whose on-chain reward address is not this
 * account pays its rewards there, which another app may have set.
 */
import { sameFelt } from "@bramble/wallet-model/networks";
import { type ReviewText, reviewEnglish, reviewText } from "../routing/review-messages";
import { canonical, shortAddress } from "../routing/verify-decode";
import type { StakingAction } from "./staking-calls";
import type { PoolMember } from "./staking-decode";

/**
 * Builds the review sentence as a reference. `member` is the membership read
 * at the same block the calls were built from.
 */
export const stakingReviewText = (input: {
  readonly account: string;
  readonly action: StakingAction;
  readonly amount: string | null;
  readonly member: PoolMember | "none";
  readonly symbol: string;
  /** The validator as display text, or as a reference (`stakingValidatorText`). */
  readonly validator: string | ReviewText;
}): ReviewText => {
  const { action, amount, symbol, validator } = input;
  const figure = `${amount ?? ""} ${symbol}`.trim();
  const reward = input.member === "none" ? null : input.member.rewardAddress;
  const elsewhere =
    reward !== null && !sameFelt(reward, input.account) ? shortAddress(canonical(reward)) : null;
  switch (action) {
    case "cancel-unstake":
      return reviewText("review.stakeAction.cancelUnstake", { symbol, validator });
    case "claim":
      return elsewhere === null
        ? reviewText("review.stakeAction.claim", { validator })
        : reviewText("review.stakeAction.claimElsewhere", { reward: elsewhere, validator });
    case "stake":
      return elsewhere === null
        ? reviewText("review.stakeAction.stake", { figure, validator })
        : reviewText("review.stakeAction.stakeElsewhere", { figure, reward: elsewhere, validator });
    case "unstake":
      return reviewText("review.stakeAction.unstake", { figure, validator });
    case "withdraw":
      return reviewText("review.stakeAction.withdraw", { symbol, validator });
  }
};

/** A validator named by its staker address, as the background's review names it. */
export const stakingValidatorText = (staker: string): ReviewText =>
  reviewText("review.stakeAction.validator", { address: staker });

/** The English of {@link stakingReviewText}, as the staking review has always read. */
export const stakingReviewSentence = (input: Parameters<typeof stakingReviewText>[0]): string =>
  reviewEnglish(stakingReviewText(input));
