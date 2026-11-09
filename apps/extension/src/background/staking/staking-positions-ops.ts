/**
 * `wallet.stakingPositions` ("Your stakes", issue 750): the active account's
 * staking positions across validators. Starkscan lists candidates through the
 * explorer lane's client (same base, per-network override and hardened
 * transport); the chain decides what is shown.
 *
 * Trust boundary: the request carries the active account's address and
 * `limit=1`, which only bounds the history the wallet doesn't read; no other
 * identifier. It is sent only where the user's per-network explorer choice
 * (`explorerFallbackAllowed`) lets Starkscan see this account's addresses.
 * The answer is untrusted: it is read with a size and time bound and validated
 * strictly (@bramble/transactions/staking-positions). Each candidate is then
 * read on chain at one pinned block, through the same verified pool read as a
 * validator's own screen, and shown only when the staking contract lists the
 * pool, the pool's own parameters agree, and the account holds a stake,
 * rewards or a pending unstake in it. Starkscan's own amounts are never shown,
 * and nothing here prepares or signs anything.
 *
 * Failure behaviour: no client, a network other than Mainnet, or the explorer
 * lane turned off for this network is "off" with no request. Any transport,
 * status, size, deadline, schema or chain-read failure is one refusal:
 * "Couldn't load your stakes.". Incomplete coverage, a truncated list, a candidate the chain could
 * not verify, a token the account doesn't track, or more candidates than the
 * wallet reads all make the answer incomplete, never "no stakes".
 */
import { MAX_CHECKED_POSITIONS } from "@bramble/transactions/staking-positions";
import { sameFelt } from "@bramble/wallet-model/networks";
import { explorerFallbackAllowed } from "@bramble/wallet-model/preferences";
import type { RuntimeResponse } from "../runtime/runtime-types";
import {
  nowSeconds,
  STAKING_UNAVAILABLE,
  type StakingOpsDeps,
  stakingContext,
} from "./staking-context";
import { readStakingChainFacts, readStakingPool } from "./staking-reads";
import { rowView } from "./staking-row-view";
import type { StakingPositionsView, StakingRowView } from "./staking-view";

/** The refusal for positions that could not be read or did not validate. */
const STAKING_POSITIONS_UNREADABLE = { error: "Couldn't load your stakes." } as const;

// A row worth listing: the account holds something in this verified pool.
const holds = (row: StakingRowView): boolean =>
  row.refusal === undefined &&
  [row.staked, row.unclaimed, row.unpoolAmount].some(
    (value) => value !== undefined && value !== "0",
  );

/**
 * Reads the active account's positions on the active network.
 */
export const stakingPositionsResponse = async (deps: StakingOpsDeps): Promise<RuntimeResponse> => {
  const context = await stakingContext(deps, true);
  if ("error" in context) return { error: context.error };
  const { account, network, networkId, preferences, read, rpcUrls } = context;
  const view = (stakingPositions: StakingPositionsView): RuntimeResponse => ({
    ok: true,
    stakingPositions,
  });
  const starkscanFor = deps.runtimeRpc.starkscanFor;
  // The address reaches Starkscan only where the explorer lane may see this
  // account's addresses (the user's per-network choice, as for history).
  if (
    !starkscanFor ||
    networkId !== "SN_MAIN" ||
    !explorerFallbackAllowed(preferences, networkId)
  ) {
    return view({ state: "off" });
  }
  const now = nowSeconds(deps);
  if (now === null) return STAKING_UNAVAILABLE;
  let page: Awaited<ReturnType<ReturnType<typeof starkscanFor>["getStakingAddress"]>>;
  try {
    page = await starkscanFor(networkId, preferences).getStakingAddress(networkId, account.address);
  } catch {
    return STAKING_POSITIONS_UNREADABLE;
  }
  let complete = page.complete && page.positions.length <= MAX_CHECKED_POSITIONS;
  try {
    return await read(rpcUrls, async (pinned) => {
      const facts = await readStakingChainFacts(pinned, network.stakingContract);
      if (!facts) return STAKING_POSITIONS_UNREADABLE;
      const checks = page.positions.slice(0, MAX_CHECKED_POSITIONS).flatMap((position) => {
        const token = preferences.tokens.find(
          (item) =>
            item.networkId === networkId &&
            sameFelt(item.address, position.token) &&
            facts.activeTokens.some((active) => sameFelt(active, item.address)),
        );
        // A stake in a token the account doesn't track can't be shown in its
        // decimals, so the list says it may be missing something.
        if (!token) complete = false;
        return token ? [{ staker: position.staker, token }] : [];
      });
      const rows = await Promise.all(
        checks.map(async ({ staker, token }) =>
          rowView(
            await readStakingPool(pinned, {
              account: account.address,
              staker,
              stakingContract: network.stakingContract,
              token: token.address,
            }),
            token,
            account.address,
            now,
          ),
        ),
      );
      // A candidate the chain could not verify is not shown, and the list
      // admits it may be missing something rather than claiming it is whole.
      if (rows.some((row) => row.refusal !== undefined)) complete = false;
      return view({ complete, rows: rows.filter(holds), state: "ready" });
    });
  } catch {
    return STAKING_POSITIONS_UNREADABLE;
  }
};
