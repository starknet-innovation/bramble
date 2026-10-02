/**
 * Pure tracked-token mutations for the preferences store, kept apart from
 * `preferences.ts` to hold it under the file-size cap: the upsert that records
 * who added a token (audit 171) and the removal (audit 134).
 */
import { WalletError } from "@bramble/core/errors";
import { isDefaultToken, sameFelt } from "@bramble/wallet-model/networks";
import {
  isTokenConfig,
  isTokenId,
  type TokenConfig,
  withTokenId,
} from "@bramble/wallet-model/preferences";
import type { TokenSource, WalletPreferences } from "./preferences-types";

/**
 * Removes one tracked token and its hidden flag (Sherlock audit 134). This is the
 * user's way out of a token a dapp added through `wallet_watchAsset`. Throws
 * {@link WalletError} for a malformed or unknown id, and for a built-in default
 * token, which fee guards and onboarding read.
 */
export const withoutToken = (
  preferences: WalletPreferences,
  tokenId: string,
): WalletPreferences => {
  if (!isTokenId(tokenId)) {
    throw new WalletError("Invalid token");
  }
  const token = preferences.tokens.find((stored) => stored.id === tokenId);
  if (!token) {
    throw new WalletError("Token not found");
  }
  if (isDefaultToken(token)) {
    throw new WalletError("Built-in tokens can't be removed");
  }
  const tokens = preferences.tokens.filter((stored) => stored.id !== tokenId);
  return preferences.hiddenTokens === undefined
    ? { ...preferences, tokens }
    : {
        ...preferences,
        hiddenTokens: preferences.hiddenTokens.filter((stored) => stored !== tokenId),
        tokens,
      };
};

/**
 * Most tokens a user or dapp may add on one network, on top of the built-in
 * defaults. Every tracked token is read for the private balance, which takes
 * at most 64 tokens, so an uncapped list let approved watch-asset cards break
 * private balances the way audit 134 broke public ones.
 */
export const MAX_ADDED_TOKENS_PER_NETWORK = 50;

const capMessage = `You can track up to ${MAX_ADDED_TOKENS_PER_NETWORK} added tokens on a network. Remove one first.`;

// Refuses one more added token on a network already at the cap. Replacing a
// tracked address or a built-in default never counts against it.
const requireRoomFor = (
  onNetwork: readonly TokenConfig[],
  token: TokenConfig,
  tracked: boolean,
): void => {
  const added = onNetwork.filter((stored) => !isDefaultToken(stored)).length;
  if (!tracked && !isDefaultToken(token) && added >= MAX_ADDED_TOKENS_PER_NETWORK) {
    throw new WalletError(capMessage);
  }
};

// Moves a hide flag from a replaced record's id to its successor's.
const carriedHiddenTokens = (
  hiddenTokens: readonly string[],
  replaced: string,
  successor: string,
): readonly string[] => {
  const others = hiddenTokens.filter((id) => id !== replaced);
  return hiddenTokens.includes(replaced) ? [...new Set([...others, successor])] : others;
};

/**
 * Returns preferences with `token` added or replaced (by derived id), recording
 * who added it (audit 171): a "dapp" source adds the id to `dappTokenIds`, a
 * "user" source removes it, so the user adding a token in the wallet is what
 * makes a dapp-suggested one trusted.
 *
 * One record per address on a network (audit 134/153): when the address is
 * already tracked under another id (another symbol from a second dapp, or a
 * token that renamed itself), a dapp source leaves the preferences unchanged
 * and returns the same object; a user source replaces that record with the
 * user's, carrying its hidden flag, so the chain metadata the wallet fetched is
 * what becomes trusted. Throws {@link WalletError}, writing nothing, for an
 * invalid token or unknown source, and rather than evicting when the network
 * already holds {@link MAX_ADDED_TOKENS_PER_NETWORK} added tokens.
 */
export const withUpsertedToken = (
  preferences: WalletPreferences,
  token: Omit<TokenConfig, "id">,
  source: TokenSource,
): WalletPreferences => {
  const nextToken = withTokenId(token);
  if (!isTokenConfig(nextToken) || (source !== "dapp" && source !== "user")) {
    throw new WalletError("Invalid token");
  }
  const onNetwork = preferences.tokens.filter((stored) => stored.networkId === nextToken.networkId);
  const sameAddress = onNetwork.find((stored) => sameFelt(stored.address, nextToken.address));
  const replaced = sameAddress && sameAddress.id !== nextToken.id ? sameAddress.id : undefined;
  if (replaced !== undefined && source === "dapp") {
    return preferences;
  }
  requireRoomFor(onNetwork, nextToken, sameAddress !== undefined);
  const dropped = new Set([nextToken.id, ...(replaced === undefined ? [] : [replaced])]);
  const tokens = preferences.tokens.filter((stored) => !dropped.has(stored.id));
  const others = (preferences.dappTokenIds ?? []).filter((id) => !dropped.has(id));
  const next: WalletPreferences = {
    ...preferences,
    dappTokenIds: source === "dapp" ? [...others, nextToken.id] : others,
    tokens: [...tokens, nextToken],
  };
  return replaced === undefined || preferences.hiddenTokens === undefined
    ? next
    : {
        ...next,
        hiddenTokens: carriedHiddenTokens(preferences.hiddenTokens, replaced, nextToken.id),
      };
};
