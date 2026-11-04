/**
 * Deterministic staking chain for background tests: one staking contract, one
 * curated validator with a STRK pool, and a mutable membership for the account
 * under test. Answers use the deployed contracts' serialization (Cairo Option:
 * Some = 0, None = 1), so the production decoders run unmodified.
 */
import type { PinnedContractRead } from "@bramble/starknet/pinned-block";
import type { StakingNetworkTable } from "@bramble/transactions/staking-networks";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";

const STAKING_CONTRACT = "0x5a1";
export const STAKER = "0x5a2";
export const STAKING_POOL = "0x5a3";
export const VALIDATOR_ID = "test-validator";

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
  stakerLeaving: boolean;
  reads: string[];
};

const hex = (value: bigint | number): string => `0x${value.toString(16)}`;

/** A fresh chain with a verified STRK pool and no membership. */
export const makeStakingChain = (): StakingChainState => ({
  activeTokens: [STRK_TOKEN_ADDRESS],
  commission: 1000,
  member: null,
  poolStaker: STAKER,
  reads: [],
  stakerLeaving: false,
});

/** Mainnet switched on with the one test validator. */
export const testStakingNetworks: StakingNetworkTable = {
  SN_DEVNET: null,
  SN_MAIN: {
    enabled: true,
    stakingContract: STAKING_CONTRACT,
    validators: [{ id: VALIDATOR_ID, name: "Test Validator", staker: STAKER }],
  },
  SN_SEPOLIA: null,
};

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
        return ["0x1", STRK_TOKEN_ADDRESS, "0x7", "0x8", "0x9", hex(604_800)];
      case "staker_pool_info":
        return sameFelt(calldata[0], STAKER)
          ? ["0x0", hex(state.commission), "0x1", STAKING_POOL, STRK_TOKEN_ADDRESS, hex(10n ** 21n)]
          : ["0x1", "0x0"];
      case "get_staker_info_v1":
        if (!sameFelt(calldata[0], STAKER)) return ["0x1"];
        return state.stakerLeaving
          ? ["0x0", STAKER, STAKER, "0x0", hex(2_000_000_000), "0x0", "0x0", "0x1"]
          : ["0x0", STAKER, STAKER, "0x1", "0x0", "0x0", "0x1"];
    }
  }
  if (sameFelt(contract, STAKING_POOL)) {
    switch (entrypoint) {
      case "contract_parameters_v1":
        return [
          state.poolStaker,
          "0x0",
          STAKING_CONTRACT,
          STRK_TOKEN_ADDRESS,
          hex(state.commission),
        ];
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
