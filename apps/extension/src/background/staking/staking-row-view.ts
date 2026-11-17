/**
 * The display row for one staker and token, shared by a validator's own
 * screen (`wallet.stakingOverview`) and "Your stakes"
 * (`wallet.stakingPositions`). Every figure comes from a verified on-chain
 * reading (./staking-reads); nothing here is read from Starkscan.
 */
import { formatTokenAmount } from "@bramble/starknet/rpc";
import { stakingPositionState } from "@bramble/transactions/staking-calls";
import { canonicalFelt, STRK_TOKEN_DECIMALS, sameFelt } from "@bramble/wallet-model/networks";
import type { StakingPoolReading } from "./staking-reads";
import type { StakingRowView } from "./staking-view";

const percent = (basisPoints: number): string =>
  `${(basisPoints / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/**
 * One verified reading as a screen row: figures formatted in the token's own
 * decimals, rewards in STRK, and the membership's reward address when it is
 * not this account. A refusal row carries only the refusal. Pure.
 */
export const rowView = (
  reading: StakingPoolReading,
  token: { readonly decimals: number; readonly id: string; readonly symbol: string },
  account: string,
  now: number,
): StakingRowView => {
  const base = { staker: reading.staker, symbol: token.symbol, tokenId: token.id };
  if ("refusal" in reading) return { ...base, refusal: reading.refusal };
  const member = reading.member === "none" ? null : reading.member;
  const format = (value: bigint): string => formatTokenAmount(value, token.decimals);
  // Rewards follow the membership's on-chain reward address, which another
  // app may have set; the row says so rather than implying this account.
  const rewardsTo =
    member && !sameFelt(member.rewardAddress, account)
      ? (canonicalFelt(member.rewardAddress) ?? undefined)
      : undefined;
  return {
    ...base,
    accepting: reading.pool.accepting,
    commission: percent(reading.pool.commission),
    delegated: format(reading.pool.delegated),
    ...(rewardsTo ? { rewardsTo } : {}),
    staked: format(member?.amount ?? 0n),
    state: stakingPositionState(reading.member, now),
    // Rewards are STRK whatever the staked token (checked in the chain facts).
    rewardSymbol: "STRK",
    unclaimed: formatTokenAmount(member?.unclaimedRewards ?? 0n, STRK_TOKEN_DECIMALS),
    unpoolAmount: format(member?.unpoolAmount ?? 0n),
    ...(member?.unpoolTime == null ? {} : { unpoolTime: member.unpoolTime }),
  };
};
