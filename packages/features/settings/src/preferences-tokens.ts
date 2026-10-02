/** Tracked-token upsert, recording who added the token (audit 171). */
import { WalletError } from "@bramble/core/errors";
import { isTokenConfig, type TokenConfig, withTokenId } from "@bramble/wallet-model/preferences";
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
