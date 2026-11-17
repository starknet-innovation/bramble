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
import { canonical, shortAddress } from "../routing/verify-decode";
import type { StakingAction } from "./staking-calls";
import type { PoolMember } from "./staking-decode";

/**
 * Builds the review sentence. `member` is the membership read at the same
 * block the calls were built from.
 */
export const stakingReviewSentence = (input: {
  readonly account: string;
  readonly action: StakingAction;
  readonly amount: string | null;
  readonly member: PoolMember | "none";
  readonly symbol: string;
  readonly validator: string;
}): string => {
  const { action, amount, symbol, validator } = input;
  const figure = `${amount ?? ""} ${symbol}`.trim();
  const what: Readonly<Record<StakingAction, string>> = {
    "cancel-unstake": `Cancel your unstake and keep the ${symbol} staked with ${validator}.`,
    claim: `Claim your STRK rewards from ${validator}.`,
    stake: `Stake ${figure} with ${validator}. This approves exactly ${figure} for its pool.`,
    unstake: `Unstake ${figure} from ${validator}. It earns no rewards until you withdraw it.`,
    withdraw: `Withdraw your unstaked ${symbol} from ${validator}.`,
  };
  const reward = input.member === "none" ? null : input.member.rewardAddress;
  const paysElsewhere =
    reward !== null &&
    !sameFelt(reward, input.account) &&
    (action === "claim" || action === "stake");
  return paysElsewhere
    ? `${what[action]} Rewards are paid to ${shortAddress(canonical(reward))}, not this account.`
    : what[action];
};
