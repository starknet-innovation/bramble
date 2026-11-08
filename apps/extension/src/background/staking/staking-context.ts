/**
 * Shared resolution for the staking handlers: the account, the enabled
 * staking network, the pinned reader and the RPC endpoints. Anything missing
 * is "staking isn't available here", never a guess.
 */
import {
  STAKING_NETWORKS,
  type StakingNetworkTable,
  stakingNetwork,
} from "@bramble/transactions/staking-networks";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { WalletOpsDeps } from "../accounts/wallet-ops";
import {
  activeAccountContext,
  networkRpcUrls,
  observedAccountContext,
} from "../runtime/runtime-state";
import { withTrustedRecipients } from "../transactions/trusted-recipients";
import type { StakingPreparationStore } from "./staking-preparations";

/**
 * Dependencies: the shared wallet-ops set, the one-time preparation store,
 * and the staking network table (injected so tests can switch a network on;
 * production uses the bundled table, which is off everywhere).
 */
export type StakingOpsDeps = WalletOpsDeps & {
  readonly stakingNetworks?: StakingNetworkTable;
  readonly stakingPreparations: StakingPreparationStore;
};

/** The refusal for a network without staking, or a build without the reader. */
export const STAKING_UNAVAILABLE = { error: "Staking isn't available on this network." } as const;

/** The refusal for an unreadable staking state. */
export const STAKING_UNREADABLE = {
  error: "Couldn't read staking on this network. Try again.",
} as const;

/**
 * The injected wall clock in whole Unix seconds, or null when none is wired
 * (callers then refuse rather than guess an exit window).
 */
export const nowSeconds = (deps: StakingOpsDeps): number | null =>
  deps.now ? Math.floor(deps.now() / 1000) : null;

/**
 * Resolves the active account and its staking network. `observe` reads the
 * session without renewing it: the overview is panel-poll traffic and must not
 * hold the wallet unlocked. A prepare or execute is the user's own tap, so it
 * takes the renewing read like every other signing lane.
 */
export const stakingContext = async (deps: StakingOpsDeps, observe = false) => {
  const context = await (observe ? observedAccountContext : activeAccountContext)(
    deps.wallet,
    deps.session,
    deps.preferencesStore,
  );
  if (context.error !== undefined) return { error: context.error } as const;
  const network = stakingNetwork(context.networkId, deps.stakingNetworks ?? STAKING_NETWORKS);
  const read = deps.runtimeRpc.readAtPinnedBlock;
  if (!network || !read) return STAKING_UNAVAILABLE;
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    context.accounts,
  );
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  return { ...context, network, preferences, read, rpcUrls } as const;
};

/**
 * A resolved staking context.
 */
export type StakingContext = Exclude<
  Awaited<ReturnType<typeof stakingContext>>,
  { readonly error: string }
>;
