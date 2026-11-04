/**
 * Call builders and the action rules for native staking.
 *
 * Trust boundary: every builder takes a pool the caller has ALREADY verified
 * (./staking-decode `verifyStakingPool`) and a member state read at the same
 * block, and decides from those alone whether the action is allowed. The UI
 * never supplies calldata; the background rebuilds these calls on every
 * request from the curated validator, the tracked token and the account.
 *
 * Amounts are exact: a stake approves the pool for exactly the amount it
 * stakes, in the same multicall, never an open-ended allowance.
 */
import { buildErc20ApproveCall } from "@bramble/starknet/rpc";
import { UINT128_LIMIT } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import type { PoolMember, VerifiedStakingPool } from "./staking-decode";

/**
 * The staking actions the wallet offers.
 * - `stake`: first stake or add stake (`approve` + enter/add).
 * - `claim`: claim the pool rewards to the member's reward address.
 * - `unstake`: start the exit window for an amount.
 * - `cancel-unstake`: cancel a pending exit (`exit_delegation_pool_intent(0)`).
 * - `withdraw`: withdraw a pending exit once its window has passed.
 */
export type StakingAction = "cancel-unstake" | "claim" | "stake" | "unstake" | "withdraw";

/**
 * Every staking action, in a fixed order; used by message validators.
 */
export const STAKING_ACTIONS: readonly StakingAction[] = [
  "stake",
  "claim",
  "unstake",
  "cancel-unstake",
  "withdraw",
];

/**
 * Where the account stands in one pool: not a member, staked with no exit
 * pending, an exit waiting out its window, or an exit ready to withdraw.
 */
export type StakingPositionState = "exit-pending" | "none" | "staked" | "withdrawable";

/**
 * Classifies a member at the given Unix second. `nowSeconds` is injected; pure.
 */
export const stakingPositionState = (
  member: PoolMember | "none",
  nowSeconds: number,
): StakingPositionState => {
  if (member === "none") return "none";
  if (member.unpoolTime === null) return member.amount > 0n ? "staked" : "none";
  return nowSeconds >= member.unpoolTime ? "withdrawable" : "exit-pending";
};

/**
 * Inputs for one action, all wallet-side.
 */
export type StakingBuildInput = {
  readonly account: string;
  readonly action: StakingAction;
  /** Base units; required for `stake` and `unstake`, ignored otherwise. */
  readonly amount: bigint | null;
  readonly member: PoolMember | "none";
  readonly nowSeconds: number;
  readonly pool: VerifiedStakingPool;
  readonly token: string;
};

const u128 = (value: bigint): string => `0x${value.toString(16)}`;

const validAmount = (amount: bigint | null): amount is bigint =>
  amount !== null && amount > 0n && amount < UINT128_LIMIT;

const stakeCalls = (input: StakingBuildInput, amount: bigint): readonly Call[] => [
  buildErc20ApproveCall(input.token, input.pool.pool, amount),
  input.member === "none"
    ? {
        calldata: [input.account, u128(amount)],
        contractAddress: input.pool.pool,
        entrypoint: "enter_delegation_pool",
      }
    : {
        calldata: [input.account, u128(amount)],
        contractAddress: input.pool.pool,
        entrypoint: "add_to_delegation_pool",
      },
];

const poolCall = (pool: string, entrypoint: string, calldata: readonly string[]): Call => ({
  calldata: [...calldata],
  contractAddress: pool,
  entrypoint,
});

type Built = readonly Call[] | { readonly refusal: string };

const PENDING_EXIT = { refusal: "Withdraw or cancel your unstake first." } as const;

const buildStake = (input: StakingBuildInput): Built => {
  if (!input.pool.accepting) return { refusal: "This validator is leaving staking." };
  if (!validAmount(input.amount)) return { refusal: "Enter an amount to stake." };
  // Adding while an exit is pending is allowed by the pool (checked by a
  // Mainnet simulation, 2026-11-04); the pending exit is unchanged.
  return stakeCalls(input, input.amount);
};

const buildClaim = (input: StakingBuildInput): Built =>
  input.member === "none" || input.member.unclaimedRewards === 0n
    ? { refusal: "No rewards to claim." }
    : [poolCall(input.pool.pool, "claim_rewards", [input.account])];

const buildUnstake = (input: StakingBuildInput, state: StakingPositionState): Built => {
  if (state === "exit-pending" || state === "withdrawable") return PENDING_EXIT;
  if (state !== "staked" || input.member === "none")
    return { refusal: "Nothing staked to unstake." };
  if (!validAmount(input.amount)) return { refusal: "Enter an amount to unstake." };
  if (input.amount > input.member.amount) return { refusal: "That's more than you have staked." };
  return [poolCall(input.pool.pool, "exit_delegation_pool_intent", [u128(input.amount)])];
};

const buildCancel = (input: StakingBuildInput, state: StakingPositionState): Built =>
  state === "exit-pending" || state === "withdrawable"
    ? [poolCall(input.pool.pool, "exit_delegation_pool_intent", ["0x0"])]
    : { refusal: "No unstake to cancel." };

const buildWithdraw = (input: StakingBuildInput, state: StakingPositionState): Built => {
  if (state === "withdrawable") {
    return [poolCall(input.pool.pool, "exit_delegation_pool_action", [input.account])];
  }
  return { refusal: state === "exit-pending" ? "Not withdrawable yet." : "Nothing to withdraw." };
};

/**
 * Builds the calls for one action, or returns the reason it is not allowed in
 * the account's current state. Never throws for a state refusal.
 */
export const buildStakingCalls = (input: StakingBuildInput): Built => {
  const state = stakingPositionState(input.member, input.nowSeconds);
  switch (input.action) {
    case "stake":
      return buildStake(input);
    case "claim":
      return buildClaim(input);
    case "unstake":
      return buildUnstake(input, state);
    case "cancel-unstake":
      return buildCancel(input, state);
    case "withdraw":
      return buildWithdraw(input, state);
  }
};

/**
 * The deterministic Activity summary for an action. Activity dedup and the
 * row classifier match on these words (stake / unstake / claim rewards), so
 * they must not drift.
 */
export const stakingActivitySummary = (input: {
  readonly action: StakingAction;
  readonly amount: string | null;
  readonly symbol: string;
  readonly validator: string;
}): string => {
  const figure = `${input.amount ?? ""} ${input.symbol}`.trim();
  switch (input.action) {
    case "stake":
      return `Stake ${figure} with ${input.validator}`;
    case "claim":
      return `Claim staking rewards from ${input.validator}`;
    case "unstake":
      return `Unstake ${figure} from ${input.validator}`;
    case "cancel-unstake":
      return `Keep ${input.symbol} staked with ${input.validator}`;
    case "withdraw":
      return `Withdraw unstaked ${figure} from ${input.validator}`;
  }
};
