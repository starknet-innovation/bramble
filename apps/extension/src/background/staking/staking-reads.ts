/**
 * Chain reads for native staking, pinned to one accepted block per group.
 *
 * Trust boundary: every answer is an untrusted RPC response, decoded by
 * @bramble/transactions/staking-decode and checked by `verifyStakingPool`
 * before anything is built from it. The staking contract and the validators
 * come only from the curated network table; the token comes only from the
 * account's tracked registry AND the staking contract's own active-token list.
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
import type { StakingValidator } from "@bramble/transactions/staking-networks";
import { sameFelt } from "@bramble/wallet-model/networks";

/**
 * One validator and token as read for an account: the verified pool and the
 * account's membership, or why it could not be verified.
 */
export type StakingPoolReading =
  | {
      readonly member: PoolMember | "none";
      readonly pool: VerifiedStakingPool;
      readonly token: string;
      readonly validator: StakingValidator;
    }
  | { readonly refusal: string; readonly token: string; readonly validator: StakingValidator };

/**
 * Reads and verifies one validator's pool for one token, plus the account's
 * membership in it, all through the same pinned reader.
 */
export const readStakingPool = async (
  read: PinnedContractRead,
  input: {
    readonly account: string;
    readonly stakingContract: string;
    readonly token: string;
    readonly validator: StakingValidator;
  },
): Promise<StakingPoolReading> => {
  const { account, stakingContract, token, validator } = input;
  const [poolInfoRaw, statusRaw] = await Promise.all([
    read(stakingContract, "staker_pool_info", [validator.staker]),
    read(stakingContract, "get_staker_info_v1", [validator.staker]),
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
    { staker: validator.staker, stakingContract, token },
  );
  if ("refusal" in verified) return { refusal: verified.refusal, token, validator };
  const member = memberRaw ? decodePoolMember(memberRaw) : null;
  if (member === null) {
    return { refusal: "Couldn't read your stake with this validator.", token, validator };
  }
  return { member, pool: verified, token, validator };
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
 * Reads the active-token list and the exit window. Null when either answer is
 * malformed, so the caller shows staking as unavailable rather than guessing.
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
  return activeTokens && exitWindowSeconds !== null ? { activeTokens, exitWindowSeconds } : null;
};
