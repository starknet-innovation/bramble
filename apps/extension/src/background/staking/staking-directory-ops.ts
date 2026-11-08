/**
 * `wallet.stakingDirectory` (issue 750): one page of Starkscan's validator
 * directory, read through the explorer lane's Starkscan client (same base,
 * per-network override and hardened transport). The request carries no
 * account address.
 *
 * Trust boundary: the answer is untrusted. The client reads it with a size and
 * time bound and validates it strictly (@bramble/transactions/staking-directory);
 * it is then filtered to active validators with an active pool for a tracked
 * token, and returned as display strings. Nothing from it is signed or used to
 * build a call: a validator picked from this list is verified on chain like a
 * pasted address.
 *
 * Failure behaviour: no client, or a network other than Mainnet, is "off"; a
 * coverage status other than `prepared` is "incomplete" with no validators;
 * any transport, status, size, deadline or schema failure is one refusal. The
 * screen then offers the pasted address, which always works.
 */
import { formatTokenAmount } from "@bramble/starknet/rpc";
import { directoryEntries } from "@bramble/transactions/staking-directory";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { type StakingOpsDeps, stakingContext } from "./staking-context";
import type { StakingDirectoryView } from "./staking-view";

/** The refusal for a directory that could not be read or did not validate. */
const STAKING_DIRECTORY_UNREADABLE = {
  error: "Couldn't load the validator list. Paste a validator address instead.",
} as const;

/**
 * Reads one directory page for the active account's network.
 */
export const stakingDirectoryResponse = async (
  deps: StakingOpsDeps,
  cursor: string | null,
): Promise<RuntimeResponse> => {
  const context = await stakingContext(deps, true);
  if ("error" in context) return { error: context.error };
  const { networkId, preferences } = context;
  const view = (state: StakingDirectoryView): RuntimeResponse => ({
    ok: true,
    stakingDirectory: state,
  });
  const starkscanFor = deps.runtimeRpc.starkscanFor;
  if (!starkscanFor || networkId !== "SN_MAIN") return view({ state: "off" });
  let page: Awaited<ReturnType<ReturnType<typeof starkscanFor>["getStakingValidators"]>>;
  try {
    page = await starkscanFor(networkId, preferences).getStakingValidators(
      networkId,
      cursor ?? undefined,
    );
  } catch {
    return STAKING_DIRECTORY_UNREADABLE;
  }
  if (page.coverage !== "prepared") return view({ state: "incomplete" });
  const tokens = preferences.tokens.filter((token) => token.networkId === networkId);
  return view({
    entries: directoryEntries(page, tokens, formatTokenAmount),
    nextCursor: page.nextCursor,
    state: "ready",
  });
};
