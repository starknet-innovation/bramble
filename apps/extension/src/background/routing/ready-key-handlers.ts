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
 *
 * The import-by-address lookup (issue 779) runs under the same guards: the
 * key and a pasted address arrive, and the answer is the one public account
 * the key was proved to control there, or a refusal.
 */
import { WalletError } from "@bramble/core/errors";
import {
  readDiscoverReadyKeyAccountsInput,
  readFindKeyAccountByAddressInput,
} from "../accounts/import-inputs";
import { discoverReadyKeyAccounts } from "../accounts/ready-key-accounts";
import { findKeyAccountByAddress } from "../accounts/ready-key-address";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import type { RouterHandler } from "./account-creation-handlers";
import type { RouterContext } from "./message-context";

// Runs a Ready-key chain read under the session it started in: once a vault
// exists, a lock or re-unlock before or after the reads refuses; on first run,
// a vault created meanwhile refuses.
const underSession = async (
  ctx: RouterContext,
  read: () => Promise<RuntimeResponse>,
): Promise<RuntimeResponse> => {
  const { hasVault } = await ctx.wallet.status();
  const authorization = hasVault ? captureSessionAuthorization(ctx.session) : null;
  const authorized = (): boolean => authorization === null || authorization.isCurrent();
  if (!authorized()) {
    throw new WalletError("wallet locked");
  }
  const response = await read();
  if (!authorized()) {
    throw new WalletError("wallet locked");
  }
  if (authorization === null && (await ctx.wallet.status()).hasVault) {
    throw new WalletError("Wallet already exists");
  }
  return response;
};

/** Handles `wallet.discoverReadyKeyAccounts`; null for every other message. */
export const handleDiscoverReadyKeyAccounts: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.discoverReadyKeyAccounts") {
    return null;
  }
  const input = readDiscoverReadyKeyAccountsInput(message);
  if (!input) {
    return { error: "invalid ready key discovery request" };
  }
  return underSession(ctx, async () => ({
    candidates: await discoverReadyKeyAccounts(ctx, input),
    ok: true,
  }));
};

/** Handles `wallet.findKeyAccountByAddress`; null for every other message. */
export const handleFindKeyAccountByAddress: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.findKeyAccountByAddress") {
    return null;
  }
  const input = readFindKeyAccountByAddressInput(message);
  if (!input) {
    return { error: "invalid account lookup request" };
  }
  return underSession(ctx, () => findKeyAccountByAddress(ctx, input));
};
