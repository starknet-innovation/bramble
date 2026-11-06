/**
 * Native staking operations dispatched from the background message handler
 * (issue 750). All three messages are privileged (extension pages only) and
 * absent from the dapp allowlist.
 *
 * - `wallet.stakingDirectory` is one page of the validator directory
 *   (./staking-directory-ops): untrusted display data, never signed.
 * - `wallet.stakingOverview` lists one staker's pools for each tracked token
 *   with the account's position, verified on chain at one pinned block. The
 *   staker comes from the directory or is pasted; either way it is only a
 *   candidate until the staking contract lists its pool. Both reads are
 *   panel-poll traffic, so they read the session without renewing it.
 * - `wallet.stakingPrepare` / `wallet.stakingExecute` are ./staking-action.
 *
 * Failure behaviour: anything unverifiable is an error or an "unavailable"
 * row, and nothing is signed.
 */
import { formatTokenAmount } from "@bramble/starknet/rpc";
import { stakingPositionState } from "@bramble/transactions/staking-calls";
import type { StakingNetworkTable } from "@bramble/transactions/staking-networks";
import { canonicalFelt, STRK_TOKEN_DECIMALS, sameFelt } from "@bramble/wallet-model/networks";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { executeStakingResponse, prepareStakingResponse } from "./staking-action";
import {
  nowSeconds,
  STAKING_UNAVAILABLE,
  STAKING_UNREADABLE,
  type StakingOpsDeps,
  stakingContext,
} from "./staking-context";
import {
  DEFAULT_STAKING_DIRECTORY,
  type StakingDirectoryRouting,
  stakingDirectoryResponse,
} from "./staking-directory-ops";
import {
  readStakingDirectoryInput,
  readStakingExecuteInput,
  readStakingOverviewInput,
  readStakingPrepareInput,
} from "./staking-inputs";
import type { StakingPreparationStore } from "./staking-preparations";
import { readStakingChainFacts, readStakingPool, type StakingPoolReading } from "./staking-reads";
import type { StakingRowView } from "./staking-view";

const percent = (basisPoints: number): string =>
  `${(basisPoints / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

const rowView = (
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

const overviewResponse = async (deps: StakingOpsDeps, staker: string): Promise<RuntimeResponse> => {
  const context = await stakingContext(deps, true);
  if ("error" in context) return { error: context.error };
  const now = nowSeconds(deps);
  if (now === null) return STAKING_UNAVAILABLE;
  const { account, network, networkId, preferences, read, rpcUrls } = context;
  try {
    return await read(rpcUrls, async (pinned) => {
      const facts = await readStakingChainFacts(pinned, network.stakingContract);
      if (!facts) return STAKING_UNREADABLE;
      const tokens = preferences.tokens.filter(
        (token) =>
          token.networkId === networkId &&
          facts.activeTokens.some((active) => sameFelt(active, token.address)),
      );
      const rows: StakingRowView[] = [];
      for (const token of tokens) {
        const reading = await readStakingPool(pinned, {
          account: account.address,
          staker,
          stakingContract: network.stakingContract,
          token: token.address,
        });
        rows.push(rowView(reading, token, account.address, now));
      }
      return { ok: true, staking: { exitWindowSeconds: facts.exitWindowSeconds, rows } };
    });
  } catch {
    return STAKING_UNREADABLE;
  }
};

/**
 * Router-supplied staking collaborators: the one-time preparation store and,
 * in tests only, a staking table and directory override.
 */
export type StakingRouting = {
  readonly directory?: StakingDirectoryRouting;
  readonly networks?: StakingNetworkTable;
  readonly preparations: StakingPreparationStore;
};

/**
 * Handles staking messages; returns null for other message types.
 */
export const handleStakingOps = async (
  base: Omit<StakingOpsDeps, "stakingNetworks" | "stakingPreparations">,
  messageType: string,
  message: unknown,
  routing: StakingRouting,
): Promise<RuntimeResponse | null> => {
  const deps: StakingOpsDeps = {
    ...base,
    ...(routing.networks ? { stakingNetworks: routing.networks } : {}),
    stakingPreparations: routing.preparations,
  };
  switch (messageType) {
    case "wallet.stakingDirectory": {
      const input = readStakingDirectoryInput(message);
      return input
        ? stakingDirectoryResponse(
            deps,
            routing.directory ?? DEFAULT_STAKING_DIRECTORY,
            input.cursor,
          )
        : { error: "invalid staking request" };
    }
    case "wallet.stakingOverview": {
      const input = readStakingOverviewInput(message);
      return input ? overviewResponse(deps, input.staker) : { error: "invalid staking request" };
    }
    case "wallet.stakingPrepare": {
      const input = readStakingPrepareInput(message);
      return input ? prepareStakingResponse(deps, input) : { error: "invalid staking request" };
    }
    case "wallet.stakingExecute": {
      const input = readStakingExecuteInput(message);
      return input
        ? executeStakingResponse(deps, input.preparationId)
        : { error: "invalid staking request" };
    }
    default:
      return null;
  }
};
