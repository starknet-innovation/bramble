/**
 * Shared active-account resolution for extension-owned STRK20 operations.
 * Split from ./strk20-wallet-ops so the shielding and private-send handlers
 * consume one context builder without an import cycle. Fails closed on a
 * missing network configuration, Ledger accounts, and untracked tokens.
 */

import { STARKNET_NETWORKS, STRK_TOKEN_ADDRESS, sameFelt } from "../starknet/networks";
import { canonicalStrk20PoolFee } from "../starknet/strk20/service";
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
 * Reads the active account's public balance of the context's token, in raw units.
 *
 * An unreadable balance is reported as zero, which fails closed: a deposit is
 * refused rather than proposed against a balance that could not be confirmed.
 */
export const publicBalance = async (
  deps: Strk20WalletOpsDeps,
  context: ActivePrivacyContext,
): Promise<bigint> => {
  const [balance] = await deps.runtimeRpc.getTokenBalances({
    accountAddress: context.accountContext.account.address,
    rpcUrls: context.accountContext.rpcUrls,
    tokens: [context.token],
  });
  return balance ? BigInt(balance.balance) : 0n;
};

const strkTokenFor = (context: ActivePrivacyContext): TokenConfig =>
  context.preferences.tokens.find(
    (token) =>
      token.networkId === context.accountContext.account.networkId &&
      sameFelt(token.address, STRK_TOKEN_ADDRESS),
  ) ?? {
    address: STRK_TOKEN_ADDRESS,
    decimals: 18,
    id: `${context.accountContext.account.networkId}:STRK:${STRK_TOKEN_ADDRESS}`,
    name: "Starknet Token",
    networkId: context.accountContext.account.networkId,
    symbol: "STRK",
  };

/**
 * Re-checks every public token the pool can pull immediately before a review
 * is created and again before submission. Missing or malformed RPC balances
 * fail closed; a STRK deposit accounts for its amount and pool fee together.
 */
export const assertPublicPoolSpendAffordable = async (
  deps: Pick<Strk20WalletOpsDeps, "runtimeRpc">,
  context: ActivePrivacyContext,
  poolFeeFri: string,
  depositAmountRaw?: string,
): Promise<void> => {
  const fee = BigInt(canonicalStrk20PoolFee(poolFeeFri));
  const strk = strkTokenFor(context);
  const depositIsStrk = sameFelt(context.token.address, STRK_TOKEN_ADDRESS);
  const tokens = depositAmountRaw === undefined || depositIsStrk ? [strk] : [context.token, strk];
  const balances = await deps.runtimeRpc.getTokenBalances({
    accountAddress: context.accountContext.account.address,
    rpcUrls: context.accountContext.rpcUrls,
    tokens,
  });
  const balanceOf = (address: string): bigint => {
    const entry = balances.find((balance) => sameFelt(balance.address, address));
    if (!entry || !/^\d+$/.test(entry.balance)) {
      throw new Error("Could not confirm the public balance required by this transaction");
    }
    return BigInt(entry.balance);
  };
  const amount = depositAmountRaw === undefined ? 0n : BigInt(depositAmountRaw);
  if (depositIsStrk) {
    if (balanceOf(STRK_TOKEN_ADDRESS) < amount + fee) {
      throw new Error("Not enough STRK for the amount and pool fee");
    }
    return;
  }
  if (depositAmountRaw !== undefined && balanceOf(context.token.address) < amount) {
    throw new Error(`Not enough ${context.token.symbol}`);
  }
  if (balanceOf(STRK_TOKEN_ADDRESS) < fee) {
    throw new Error("Not enough STRK for the pool fee");
  }
};

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
