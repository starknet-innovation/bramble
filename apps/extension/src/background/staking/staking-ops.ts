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
 * - `wallet.stakingPositions` is "Your stakes" (./staking-positions-ops):
 *   Starkscan's candidates for the active account, each confirmed on chain.
 * - `wallet.stakingPrepare` / `wallet.stakingExecute` are ./staking-action.
 *
 * Failure behaviour: anything unverifiable is an error or an "unavailable"
 * row, and nothing is signed.
 */
import type { StakingNetworkTable } from "@bramble/transactions/staking-networks";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { executeStakingResponse, prepareStakingResponse } from "./staking-action";
import {
  nowSeconds,
  STAKING_UNAVAILABLE,
  STAKING_UNREADABLE,
  type StakingOpsDeps,
  stakingContext,
} from "./staking-context";
import { stakingDirectoryResponse } from "./staking-directory-ops";
import {
  isStakingPositionsInput,
  readStakingDirectoryInput,
  readStakingExecuteInput,
  readStakingOverviewInput,
  readStakingPrepareInput,
} from "./staking-inputs";
import { stakingPositionsResponse } from "./staking-positions-ops";
import type { StakingPreparationStore } from "./staking-preparations";
import { readStakingChainFacts, readStakingPool } from "./staking-reads";
import { rowView } from "./staking-row-view";
import type { StakingRowView } from "./staking-view";

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
 * in tests only, a staking table.
 */
export type StakingRouting = {
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
        ? stakingDirectoryResponse(deps, input.cursor)
        : { error: "invalid staking request" };
    }
    case "wallet.stakingPositions":
      return isStakingPositionsInput(message)
        ? stakingPositionsResponse(deps)
        : { error: "invalid staking request" };
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
