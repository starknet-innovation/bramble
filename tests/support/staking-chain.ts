/**
 * Deterministic staking chain for background tests: one staking contract, one
 * validator (staker) with a STRK pool, and a mutable membership for the account
 * under test. Answers use the deployed contracts' serialization (Cairo Option:
 * Some = 0, None = 1), so the production decoders run unmodified.
 */
import type { PinnedContractRead } from "@bramble/starknet/pinned-block";
import type { StakingNetworkTable } from "@bramble/transactions/staking-networks";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";

const STAKING_CONTRACT = "0x5a1";
export const STAKER = `0x5a2${"0".repeat(56)}beef`;
export const STAKING_POOL = "0x5a3";

/** Mutable chain state; tests change it between requests. */
export type StakingChainState = {
  activeTokens: string[];
  /** Pool commission in basis points. */
  commission: number;
  /** Membership of the account under test, or null when not a member. */
  member: {
    amount: bigint;
    rewardAddress: string;
    unclaimed: bigint;
    unpoolAmount: bigint;
    unpoolTime: number | null;
  } | null;
  /** Staker the pool's own parameters name (a mismatch must be refused). */
  poolStaker: string;
  /** The staking contract's own token, in which rewards are paid. */
  rewardToken: string;
  stakerLeaving: boolean;
  /** More verified validators, each with its own STRK pool (see `poolFor`). */
  extraStakers: string[];
  reads: string[];
};

const hex = (value: bigint | number): string => `0x${value.toString(16)}`;

/** A fresh chain with a verified STRK pool and no membership. */
export const makeStakingChain = (): StakingChainState => ({
  activeTokens: [STRK_TOKEN_ADDRESS],
  commission: 1000,
  extraStakers: [],
  member: null,
  poolStaker: STAKER,
  reads: [],
  rewardToken: STRK_TOKEN_ADDRESS,
  stakerLeaving: false,
});

/** Mainnet switched on against the test staking contract. */
export const testStakingNetworks: StakingNetworkTable = {
  SN_DEVNET: null,
  SN_MAIN: { enabled: true, stakingContract: STAKING_CONTRACT },
  SN_SEPOLIA: null,
};

/** Every network switched off: the "staking is off here" refusals. */
export const offStakingNetworks: StakingNetworkTable = {
  SN_DEVNET: null,
  SN_MAIN: { enabled: false, stakingContract: STAKING_CONTRACT },
  SN_SEPOLIA: null,
};

/** The STRK pool of `staker`: STAKING_POOL for STAKER, one each for the extras. */
const poolFor = (state: StakingChainState, staker: unknown): string | null => {
  if (sameFelt(staker, STAKER)) return STAKING_POOL;
  const index = state.extraStakers.findIndex((extra) => sameFelt(extra, staker));
  return index < 0 ? null : hex(0x5b00 + index);
};

const stakerOfPool = (state: StakingChainState, pool: string): string | null =>
  sameFelt(pool, STAKING_POOL)
    ? state.poolStaker
    : (state.extraStakers.find((extra) => sameFelt(poolFor(state, extra), pool)) ?? null);

const answer = (
  state: StakingChainState,
  contract: string,
  entrypoint: string,
  calldata: readonly string[],
): readonly string[] => {
  if (sameFelt(contract, STAKING_CONTRACT)) {
    switch (entrypoint) {
      case "get_active_tokens":
        return [hex(state.activeTokens.length), ...state.activeTokens];
      case "contract_parameters_v1":
        return ["0x1", state.rewardToken, "0x7", "0x8", "0x9", hex(604_800)];
      case "staker_pool_info": {
        const pool = poolFor(state, calldata[0]);
        return pool
          ? ["0x0", hex(state.commission), "0x1", pool, STRK_TOKEN_ADDRESS, hex(10n ** 21n)]
          : ["0x1", "0x0"];
      }
      case "get_staker_info_v1": {
        const staker = calldata[0] ?? "";
        if (!poolFor(state, staker)) return ["0x1"];
        return state.stakerLeaving
          ? ["0x0", staker, staker, "0x0", hex(2_000_000_000), "0x0", "0x0", "0x1"]
          : ["0x0", staker, staker, "0x1", "0x0", "0x0", "0x1"];
      }
    }
  }
  const poolStaker = stakerOfPool(state, contract);
  if (poolStaker) {
    switch (entrypoint) {
      case "contract_parameters_v1":
        return [poolStaker, "0x0", STAKING_CONTRACT, STRK_TOKEN_ADDRESS, hex(state.commission)];
      case "get_pool_member_info_v1": {
        const member = state.member;
        if (!member) return ["0x1"];
        const time = member.unpoolTime === null ? ["0x1"] : ["0x0", hex(member.unpoolTime)];
        return [
          "0x0",
          member.rewardAddress,
          hex(member.amount),
          hex(member.unclaimed),
          hex(state.commission),
          hex(member.unpoolAmount),
          ...time,
        ];
      }
    }
  }
  throw new Error(`unexpected staking read ${entrypoint} on ${contract}`);
};

/** The `readAtPinnedBlock` stand-in answering from `state`. */
export const stakingReader =
  (state: StakingChainState) =>
  <T>(_rpcUrls: readonly string[], run: (read: PinnedContractRead) => Promise<T>): Promise<T> =>
    run(async (contract, entrypoint, calldata) => {
      state.reads.push(entrypoint);
      return answer(state, contract, entrypoint, calldata);
    });
