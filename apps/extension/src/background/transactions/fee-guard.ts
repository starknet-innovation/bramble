/**
 * Background half of the fee-affordability guard (issue 191): reads the
 * account's raw STRK balance so the pure predicate
 * (`packages/features/transactions/src/routing/fee-funds.ts`) can compare it against a fee estimate. Shared
 * by the Send review and the dApp invoke estimate so the two journeys read the
 * balance the same way. Fails open: any read failure returns null, which the
 * predicate maps to "unknown" — a missing balance never blocks a transaction.
 */

import type { TokenConfig, WalletPreferences } from "@mc-wallet/settings/preferences";
import {
  STARKNET_NETWORKS,
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { tokenConfigId } from "@mc-wallet/wallet-model/preferences";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";

/**
 * Returns the canonical STRK token for a network: the tracked entry when one
 * exists, otherwise the same synthetic fee-token configuration.
 */
export const strkToken = (
  networkId: StarknetNetworkId,
  preferences: WalletPreferences,
): TokenConfig =>
  preferences.tokens.find(
    (token) => token.networkId === networkId && sameFelt(token.address, STRK_TOKEN_ADDRESS),
  ) ?? {
    address: STRK_TOKEN_ADDRESS,
    decimals: 18,
    id: tokenConfigId(networkId, "STRK", STRK_TOKEN_ADDRESS),
    name: "Starknet Token",
    networkId,
    symbol: "STRK",
  };

/**
 * Reads the account's raw STRK balance (base units) for the fee-affordability
 * guard, or null when it cannot be read. Read-only and fail-open: every
 * failure — transport, RPC, or a partial runtime — degrades to null so the
 * guard makes no claim instead of blocking on missing data.
 */
export const readStrkBalance = async (
  deps: { readonly runtimeRpc: Pick<RuntimeRpc, "getTokenBalances"> },
  account: { readonly address: string; readonly networkId: StarknetNetworkId },
  preferences: WalletPreferences,
): Promise<string | null> => {
  try {
    const balances = await deps.runtimeRpc.getTokenBalances({
      accountAddress: account.address,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
      tokens: [strkToken(account.networkId, preferences)],
    });
    return balances[0]?.balance ?? null;
  } catch {
    return null;
  }
};
