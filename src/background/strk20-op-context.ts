/**
 * Shared active-account resolution for extension-owned STRK20 operations.
 * Split from ./strk20-wallet-ops so the shielding and private-send handlers
 * consume one context builder without an import cycle. Fails closed on a
 * missing network configuration, Ledger accounts, and untracked tokens.
 */

import { STARKNET_NETWORKS } from "../starknet/networks";
import type { TokenConfig, WalletPreferences } from "../storage/preferences-store";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import { strk20AccountContext } from "./strk20-account-context";
import type { Strk20WalletPreparationStore } from "./strk20-wallet-preparations";
import type { WalletOpsDeps } from "./wallet-ops";

/**
 * Extension-owned privacy dependencies, including the one-time preparation
 * store that keeps executable payloads out of the side panel.
 */
export type Strk20WalletOpsDeps = WalletOpsDeps & {
  readonly strk20Preparations: Strk20WalletPreparationStore;
};

/**
 * Resolved active account, its privacy configuration, and the selected token.
 */
export type ActivePrivacyContext = {
  readonly accountContext: ReturnType<typeof strk20AccountContext>;
  readonly preferences: WalletPreferences;
  readonly token: TokenConfig;
};

/**
 * Shortens an unknown error to a displayable message with a stable fallback.
 */
export const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.length > 0 ? error.message : fallback;

const firstNetworkToken = (preferences: WalletPreferences, networkId: string): TokenConfig | null =>
  preferences.tokens.find((token) => token.networkId === networkId) ?? null;

/**
 * Builds the protected account context for one privacy operation, selecting
 * `tokenId` or the network's first tracked token. Returns a displayable error
 * instead of throwing so handlers stay single-shape.
 */
export const resolvePrivacyContext = async (
  deps: Strk20WalletOpsDeps,
  tokenId?: string,
): Promise<ActivePrivacyContext | { readonly error: string }> => {
  const active = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (active.error !== undefined) {
    return { error: active.error };
  }
  const preferences = await deps.preferencesStore.read();
  const config = preferences.strk20Networks?.[active.networkId] ?? null;
  if (!config) {
    return { error: "Private balances are not configured for this network" };
  }
  if (active.account.derivation.kind === "ledger") {
    return { error: "Private balances are not available for Ledger accounts" };
  }
  const token = tokenId
    ? preferences.tokens.find(
        (stored) => stored.id === tokenId && stored.networkId === active.networkId,
      )
    : firstNetworkToken(preferences, active.networkId);
  if (!token) {
    return { error: "Track a token before activating private balances" };
  }
  return {
    accountContext: strk20AccountContext(
      {
        ...(deps.ledgerSignQueue ? { ledgerSignQueue: deps.ledgerSignQueue } : {}),
        wallet: deps.wallet,
      },
      {
        account: active.account,
        passphrase: active.vaultPassphrase,
        preferences,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[active.networkId], preferences),
      },
    ),
    preferences,
    token,
  };
};
