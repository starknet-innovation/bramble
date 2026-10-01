/**
 * Pure tracked-token mutations for the preferences store, kept apart from
 * `preferences.ts` to hold it under the file-size cap: the upsert that records
 * who added a token (audit 171) and the removal (audit 134).
 */
import { WalletError } from "@bramble/core/errors";
import { isDefaultToken } from "@bramble/wallet-model/networks";
import {
  isTokenConfig,
  isTokenId,
  type TokenConfig,
  withTokenId,
} from "@bramble/wallet-model/preferences";
import type { TokenSource, WalletPreferences } from "./preferences-types";

/**
 * Returns preferences with `token` added or replaced (by derived id). A "dapp"
 * source adds the id to `dappTokenIds`; a "user" source removes it, so the
 * user adding a token in the wallet is what makes a dapp-suggested one trusted.
 * Throws a WalletError for an invalid token or an unknown source, writing nothing.
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
  const tokens = preferences.tokens.filter((stored) => stored.id !== nextToken.id);
  const others = (preferences.dappTokenIds ?? []).filter((id) => id !== nextToken.id);
  return {
    ...preferences,
    dappTokenIds: source === "dapp" ? [...others, nextToken.id] : others,
    tokens: [...tokens, nextToken],
  };
};

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
