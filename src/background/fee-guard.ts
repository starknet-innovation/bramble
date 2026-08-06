/**
 * Background half of the fee-affordability guard (issue 191): reads the
 * account's raw STRK balance so the pure predicate
 * (`src/starknet/fee-funds.ts`) can compare it against a fee estimate. Shared
 * by the Send review and the dApp invoke estimate so the two journeys read the
 * balance the same way. Fails open: any read failure returns null, which the
 * predicate maps to "unknown" — a missing balance never blocks a transaction.
 */
import {
  STARKNET_NETWORKS,
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
  sameFelt,
} from "../starknet/networks";
import type { TokenConfig, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";

// The canonical STRK token for a network: the user's tracked entry when one
// exists, otherwise a synthetic config — fees are payable whether or not the
// user tracks STRK in the panel.
const strkToken = (networkId: StarknetNetworkId, preferences: WalletPreferences): TokenConfig =>
  preferences.tokens.find(
    (token) => token.networkId === networkId && sameFelt(token.address, STRK_TOKEN_ADDRESS),
  ) ?? {
    address: STRK_TOKEN_ADDRESS,
    decimals: 18,
    id: `${networkId}:STRK:${STRK_TOKEN_ADDRESS}`,
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
  account: AccountRef,
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
