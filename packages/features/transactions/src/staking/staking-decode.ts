/**
 * Decoders for the native staking reads (starkware-libs/starknet-staking,
 * staking contract + delegation pool, layouts checked against the deployed
 * Mainnet ABIs on 2026-11-04) and the pool verification rule.
 *
 * Trust boundary: every input here is an RPC answer and therefore untrusted.
 * A decoder returns null for anything that does not match the layout exactly
 * (wrong length, a non-felt, an out-of-range integer, an unknown Option
 * variant), and callers treat null as "unreadable" and build nothing.
 */
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
  UINT128_LIMIT,
} from "@bramble/wallet-model/networks";

const U16_LIMIT = 1n << 16n;
const U64_LIMIT = 1n << 64n;
// Cairo `Option` serializes its variant index first: Some = 0, None = 1.
const SOME = 0n;
const NONE = 1n;

const felt = (values: readonly string[], index: number): bigint | null => {
  const value = values[index];
  return typeof value === "string" && isStarkFieldElement(value) ? BigInt(value) : null;
};

const bounded = (values: readonly string[], index: number, limit: bigint): bigint | null => {
  const value = felt(values, index);
  return value !== null && value < limit ? value : null;
};

const address = (values: readonly string[], index: number): string | null => {
  const value = values[index];
  return typeof value === "string" && isNonZeroStarkFieldElement(value)
    ? canonicalFelt(value)
    : null;
};

/**
 * One delegation pool a staker runs, as the staking contract reports it.
 */
export type StakerPool = {
  readonly amount: bigint;
  readonly pool: string;
  readonly token: string;
};

/**
 * `staker_pool_info(staker)`: the staker's commission (basis points, when set)
 * and its pools, one per token.
 */
export type StakerPoolInfo = {
  readonly commission: number | null;
  readonly pools: readonly StakerPool[];
};

/**
 * Decodes `staker_pool_info`: `Option<u16>` commission, then a span of
 * `(pool_contract, token_address, amount)`.
 */
export const decodeStakerPoolInfo = (values: readonly string[]): StakerPoolInfo | null => {
  const variant = felt(values, 0);
  let cursor = 1;
  let commission: number | null = null;
  if (variant === SOME) {
    const value = bounded(values, 1, U16_LIMIT);
    if (value === null) return null;
    commission = Number(value);
    cursor = 2;
  } else if (variant !== NONE) {
    return null;
  }
  const count = bounded(values, cursor, 64n);
  if (count === null || values.length !== cursor + 1 + Number(count) * 3) return null;
  const pools: StakerPool[] = [];
  for (let index = 0; index < Number(count); index += 1) {
    const base = cursor + 1 + index * 3;
    const pool = address(values, base);
    const token = address(values, base + 1);
    const amount = bounded(values, base + 2, UINT128_LIMIT);
    if (pool === null || token === null || amount === null) return null;
    pools.push({ amount, pool, token });
  }
  return { commission, pools };
};

/**
 * Whether the staker exists and is not leaving, from `get_staker_info_v1`
 * (`Option<StakerInfoV1>`; `unstake_time` is its fourth field).
 */
export type StakerStatus = "active" | "leaving" | "unknown";

/**
 * Decodes the parts of `get_staker_info_v1` the wallet acts on. Null when the
 * answer is malformed.
 */
export const decodeStakerStatus = (values: readonly string[]): StakerStatus | null => {
  const variant = felt(values, 0);
  if (variant === NONE) return values.length === 1 ? "unknown" : null;
  if (variant !== SOME || address(values, 1) === null) return null;
  const unstake = felt(values, 3);
  if (unstake === NONE) return "active";
  return unstake === SOME && bounded(values, 4, U64_LIMIT) !== null ? "leaving" : null;
};

/**
 * A pool's own `contract_parameters_v1`.
 */
export type PoolParameters = {
  readonly commission: number;
  readonly staker: string;
  readonly stakerRemoved: boolean;
  readonly stakingContract: string;
  readonly token: string;
};

/**
 * Decodes a pool's `contract_parameters_v1`:
 * `(staker_address, staker_removed, staking_contract, token_address, commission)`.
 */
export const decodePoolParameters = (values: readonly string[]): PoolParameters | null => {
  if (values.length !== 5) return null;
  const staker = address(values, 0);
  const removed = bounded(values, 1, 2n);
  const stakingContract = address(values, 2);
  const token = address(values, 3);
  const commission = bounded(values, 4, U16_LIMIT);
  if (!staker || removed === null || !stakingContract || !token || commission === null) {
    return null;
  }
  return {
    commission: Number(commission),
    staker,
    stakerRemoved: removed === 1n,
    stakingContract,
    token,
  };
};

/**
 * The account's membership in one pool. `unpoolTime` is the Unix second the
 * pending exit becomes withdrawable, or null when no exit is pending.
 */
export type PoolMember = {
  readonly amount: bigint;
  readonly rewardAddress: string;
  readonly unclaimedRewards: bigint;
  readonly unpoolAmount: bigint;
  readonly unpoolTime: number | null;
};

/**
 * Decodes `get_pool_member_info_v1` (`Option<PoolMemberInfoV1>`). Returns
 * `"none"` when the account is not a member, null when malformed.
 */
export const decodePoolMember = (values: readonly string[]): PoolMember | "none" | null => {
  const variant = felt(values, 0);
  if (variant === NONE) return values.length === 1 ? "none" : null;
  if (variant !== SOME) return null;
  const rewardAddress = address(values, 1);
  const amount = bounded(values, 2, UINT128_LIMIT);
  const unclaimedRewards = bounded(values, 3, UINT128_LIMIT);
  const commission = bounded(values, 4, U16_LIMIT);
  const unpoolAmount = bounded(values, 5, UINT128_LIMIT);
  const timeVariant = felt(values, 6);
  if (
    !rewardAddress ||
    amount === null ||
    unclaimedRewards === null ||
    commission === null ||
    unpoolAmount === null
  ) {
    return null;
  }
  if (timeVariant === NONE && values.length === 7) {
    return { amount, rewardAddress, unclaimedRewards, unpoolAmount, unpoolTime: null };
  }
  const seconds = bounded(values, 7, U64_LIMIT);
  if (timeVariant !== SOME || seconds === null || values.length !== 8) return null;
  return { amount, rewardAddress, unclaimedRewards, unpoolAmount, unpoolTime: Number(seconds) };
};

/**
 * Decodes `get_active_tokens` (a span of token addresses).
 */
export const decodeActiveTokens = (values: readonly string[]): readonly string[] | null => {
  const count = bounded(values, 0, 64n);
  if (count === null || values.length !== Number(count) + 1) return null;
  const tokens: string[] = [];
  for (let index = 1; index <= Number(count); index += 1) {
    const token = address(values, index);
    if (token === null) return null;
    tokens.push(token);
  }
  return tokens;
};

/**
 * Decodes the staking contract's exit wait window (seconds), the last field of
 * `contract_parameters_v1`.
 */
export const decodeExitWindow = (values: readonly string[]): number | null => {
  if (values.length !== 6) return null;
  const seconds = bounded(values, 5, U64_LIMIT);
  return seconds === null ? null : Number(seconds);
};

/**
 * Everything read for one validator and token, pinned to one block.
 */
export type StakingPoolReads = {
  readonly parameters: PoolParameters | null;
  readonly poolInfo: StakerPoolInfo | null;
  readonly status: StakerStatus | null;
};

/**
 * A pool the wallet has verified for a curated validator and token.
 * `accepting` is false while the validator is leaving staking or has been
 * removed from the pool: members can still claim, exit and withdraw, but the
 * wallet builds no new stake into it.
 */
export type VerifiedStakingPool = {
  readonly accepting: boolean;
  readonly commission: number;
  readonly delegated: bigint;
  readonly pool: string;
};

/**
 * The pool verification rule. A pool is accepted only when the staking
 * contract lists it as this staker's pool for this token, and the pool's own
 * parameters name the same staker, staking contract and token. Anything else
 * is a refusal; nothing is built for an unverified pool.
 */
export const verifyStakingPool = (
  reads: StakingPoolReads,
  expected: { readonly staker: string; readonly stakingContract: string; readonly token: string },
): VerifiedStakingPool | { readonly refusal: string } => {
  const unverified = { refusal: "Couldn't verify this validator on chain." } as const;
  if (!reads.poolInfo || !reads.status || reads.status === "unknown") return unverified;
  const listed = reads.poolInfo.pools.find((pool) => sameFelt(pool.token, expected.token));
  if (!listed) {
    return { refusal: "This validator has no pool for this token." };
  }
  const parameters = reads.parameters;
  if (
    !parameters ||
    !sameFelt(parameters.staker, expected.staker) ||
    !sameFelt(parameters.stakingContract, expected.stakingContract) ||
    !sameFelt(parameters.token, expected.token)
  ) {
    return unverified;
  }
  return {
    accepting: reads.status === "active" && !parameters.stakerRemoved,
    commission: reads.poolInfo.commission ?? parameters.commission,
    delegated: listed.amount,
    pool: listed.pool,
  };
};
