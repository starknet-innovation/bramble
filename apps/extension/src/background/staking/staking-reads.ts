/**
 * Chain reads for native staking, pinned to one accepted block per group.
 *
 * Trust boundary: every answer is an untrusted RPC response, decoded by
 * @bramble/transactions/staking-decode and checked by `verifyStakingPool`
 * before anything is built from it. The staking contract comes only from the
 * network table. The staker address is a candidate from the directory or the
 * user, never trusted: it counts only once the staking contract lists a pool
 * for it here. The token comes only from the account's tracked registry AND
 * the staking contract's own active-token list.
 * Failure behaviour: an unreadable or inconsistent answer yields a refusal or
 * an "unavailable" row, never a guessed pool.
 */
import type { PinnedContractRead } from "@bramble/starknet/pinned-block";
import {
  decodeActiveTokens,
  decodeExitWindow,
  decodePoolMember,
  decodePoolParameters,
  decodeStakerPoolInfo,
  decodeStakerStatus,
  type PoolMember,
  type VerifiedStakingPool,
  verifyStakingPool,
} from "@bramble/transactions/staking-decode";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";

/**
 * One validator and token as read for an account: the verified pool and the
 * account's membership, or why it could not be verified.
 */
export type StakingPoolReading =
  | {
      readonly member: PoolMember | "none";
      readonly pool: VerifiedStakingPool;
      readonly staker: string;
      readonly token: string;
    }
  | { readonly refusal: string; readonly staker: string; readonly token: string };

/**
 * Reads and verifies one staker's pool for one token, plus the account's
 * membership in it, all through the same pinned reader. `staker` must already
 * be canonical (see `stakerAddress`).
 */
export const readStakingPool = async (
  read: PinnedContractRead,
  input: {
    readonly account: string;
    readonly staker: string;
    readonly stakingContract: string;
    readonly token: string;
  },
): Promise<StakingPoolReading> => {
  const { account, staker, stakingContract, token } = input;
  const [poolInfoRaw, statusRaw] = await Promise.all([
    read(stakingContract, "staker_pool_info", [staker]),
    read(stakingContract, "get_staker_info_v1", [staker]),
  ]);
  const poolInfo = decodeStakerPoolInfo(poolInfoRaw);
  const listed = poolInfo?.pools.find((pool) => sameFelt(pool.token, token));
  const [parametersRaw, memberRaw] = listed
    ? await Promise.all([
        read(listed.pool, "contract_parameters_v1", []),
        read(listed.pool, "get_pool_member_info_v1", [account]),
      ])
    : [null, null];
  const verified = verifyStakingPool(
    {
      parameters: parametersRaw ? decodePoolParameters(parametersRaw) : null,
      poolInfo,
      status: decodeStakerStatus(statusRaw),
    },
    { staker, stakingContract, token },
  );
  if ("refusal" in verified) return { refusal: verified.refusal, staker, token };
  const member = memberRaw ? decodePoolMember(memberRaw) : null;
  if (member === null) {
    return { refusal: "Couldn't read your stake with this validator.", staker, token };
  }
  return { member, pool: verified, staker, token };
};

/**
 * The staking contract's network-wide parameters the wallet shows.
 */
export type StakingChainFacts = {
  /** Tokens the staking contract currently accepts. */
  readonly activeTokens: readonly string[];
  /** Seconds an unstake waits before it can be withdrawn. */
  readonly exitWindowSeconds: number;
};

/**
 * Reads the active-token list and the exit wait (seconds), and confirms the
 * rewards token is STRK. Null when any answer is malformed or different, so
 * the caller shows staking as unavailable rather than guessing.
 */
export const readStakingChainFacts = async (
  read: PinnedContractRead,
  stakingContract: string,
): Promise<StakingChainFacts | null> => {
  const [tokensRaw, parametersRaw] = await Promise.all([
    read(stakingContract, "get_active_tokens", []),
    read(stakingContract, "contract_parameters_v1", []),
  ]);
  const activeTokens = decodeActiveTokens(tokensRaw);
  const exitWindowSeconds = decodeExitWindow(parametersRaw);
  // Rewards are paid in the staking contract's own token, for BTC pools too.
  // The wallet labels and scales them as STRK, so it confirms that first.
  const rewardsInStrk = sameFelt(parametersRaw[1], STRK_TOKEN_ADDRESS);
  return activeTokens && exitWindowSeconds !== null && rewardsInStrk
    ? { activeTokens, exitWindowSeconds }
    : null;
};
