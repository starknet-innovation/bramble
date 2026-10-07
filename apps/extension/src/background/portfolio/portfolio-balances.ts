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
import type { TokenBalance } from "@bramble/starknet/rpc";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import type { RuntimeRpc } from "../runtime/runtime-rpc";

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
