/**
 * The Ready-key discovery message (issue 776): before a "Ready Account" key is
 * imported, list every Argent release at which it controls an address in use,
 * so the user picks instead of the wallet guessing. The raw key arrives only in
 * this extension-page message; the answer carries public addresses, ids and
 * classes, never the key.
 *
 * It runs on first run, before any vault exists, and in the unlocked wallet.
 * Once a vault exists, a locked or changed session refuses before and after
 * the chain reads, so a lock during discovery returns nothing. A first-run
 * read that ends after a vault was created meanwhile returns nothing either:
 * that vault was never this request's to read for.
 */
import { WalletError } from "@bramble/core/errors";
import { readDiscoverReadyKeyAccountsInput } from "../accounts/import-inputs";
import { discoverReadyKeyAccounts } from "../accounts/ready-key-accounts";
import { captureSessionAuthorization } from "../runtime/session";
import type { RouterHandler } from "./account-creation-handlers";

/** Handles `wallet.discoverReadyKeyAccounts`; null for every other message. */
export const handleDiscoverReadyKeyAccounts: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.discoverReadyKeyAccounts") {
    return null;
  }
  const input = readDiscoverReadyKeyAccountsInput(message);
  if (!input) {
    return { error: "invalid ready key discovery request" };
  }
  const { hasVault } = await ctx.wallet.status();
  const authorization = hasVault ? captureSessionAuthorization(ctx.session) : null;
  const authorized = (): boolean => authorization === null || authorization.isCurrent();
  if (!authorized()) {
    throw new WalletError("wallet locked");
  }
  const candidates = await discoverReadyKeyAccounts(ctx, input);
  if (!authorized()) {
    throw new WalletError("wallet locked");
  }
  if (authorization === null && (await ctx.wallet.status()).hasVault) {
    throw new WalletError("Wallet already exists");
  }
  return { candidates, ok: true };
};
