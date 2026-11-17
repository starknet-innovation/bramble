/**
 * Portfolio balance reads for the account and multisig balance screens.
 *
 * Every tracked token on a network is read, including ones a dapp added with
 * `wallet_watchAsset`. A token whose `balanceOf` reverts must not freeze the
 * rest of the portfolio (Sherlock audit 134), so these reads isolate per-token
 * contract failures and keep that token's last known value. This is a display
 * path only: fee guards, privacy spend checks, onboarding and Ledger keep the
 * fail-closed `getTokenBalances` mode.
 */
import type { WalletPreferences, WalletPreferencesStore } from "@bramble/settings/preferences";
import type { TokenBalance } from "@bramble/starknet/rpc";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { curatedProbe, trackHeldCuratedTokens, untrackedCuratedTokens } from "./held-tokens";

/*
 * Orders the read balances by the requested tokens and fills each token the
 * read left out with its previous snapshot value, so a token whose read
 * failed keeps its last balance instead of vanishing. A token with no previous
 * value stays absent, which the UI already shows as unread. Tokens that were
 * not requested (removed since the last read) are dropped.
 */
const withCarriedBalances = (
  tokens: readonly TokenConfig[],
  balances: readonly TokenBalance[],
  previous: readonly TokenBalance[] | null,
): readonly TokenBalance[] =>
  tokens.flatMap((token) => {
    const read =
      balances.find((balance) => balance.id === token.id) ??
      previous?.find((balance) => balance.id === token.id);
    return read ? [read] : [];
  });

/**
 * Reads the portfolio balances for one account. Transport failures, and a read
 * where no token succeeded, still throw so the caller serves its stale
 * snapshot; a contract error on one token only keeps that token's previous
 * value.
 */
export const readPortfolioBalances = async (
  runtimeRpc: Pick<RuntimeRpc, "getTokenBalances">,
  input: {
    readonly accountAddress: string;
    readonly rpcUrls: readonly string[];
    readonly tokens: readonly TokenConfig[];
  },
  previous: readonly TokenBalance[] | null,
): Promise<readonly TokenBalance[]> =>
  withCarriedBalances(
    input.tokens,
    await runtimeRpc.getTokenBalances({ ...input, isolateTokenFailures: true }),
    previous,
  );

/**
 * Reads the active account's portfolio and tracks the curated tokens it holds
 * (issue 663). When a probe is due (`curatedProbe`: the first read after an
 * unlock or an account or network switch, then every ten minutes or on a
 * user's refresh), the one read also covers every untracked curated token for
 * the network — the registry's few entries, whichever the account holds. A
 * curated token with a non-zero balance is tracked through
 * `trackHeldCuratedTokens` and returned with the rest; the others are read and
 * dropped. Failure behaviour is {@link readPortfolioBalances}'s; a failed read
 * records no probe, so the next one probes again.
 */
export const readAccountPortfolio = async (
  deps: {
    readonly preferencesStore: WalletPreferencesStore;
    readonly runtimeRpc: Pick<RuntimeRpc, "getTokenBalances">;
  },
  input: {
    readonly accountAddress: string;
    readonly forced: boolean;
    readonly networkId: StarknetNetworkId;
    readonly now: number;
    readonly preferences: WalletPreferences;
    readonly rpcUrls: readonly string[];
    readonly scope: string;
  },
  previous: readonly TokenBalance[] | null,
): Promise<readonly TokenBalance[]> => {
  const tracked = input.preferences.tokens.filter((token) => token.networkId === input.networkId);
  const probe = curatedProbe(deps.preferencesStore, input.scope, input.now, input.forced);
  const curated = probe.due ? untrackedCuratedTokens(input.preferences, input.networkId) : [];
  const read = await deps.runtimeRpc.getTokenBalances({
    accountAddress: input.accountAddress,
    isolateTokenFailures: true,
    rpcUrls: input.rpcUrls,
    tokens: [...tracked, ...curated],
  });
  if (probe.due) probe.ran();
  const held = curated.filter((token) =>
    read.some((balance) => balance.id === token.id && BigInt(balance.balance) > 0n),
  );
  const added = await trackHeldCuratedTokens(
    deps.preferencesStore,
    input.networkId,
    held.map((token) => token.address),
  );
  return withCarriedBalances([...tracked, ...added], read, previous);
};
