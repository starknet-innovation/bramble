/**
 * The three dapp-connection routes: reading an origin's granted accounts,
 * listing pending approvals, and requesting a connection.
 *
 * All three answer an untrusted page, so each re-checks the claimed origin
 * against the real sender and the blocklist before reading anything, and each
 * *peeks* the unlock session rather than renewing it — `wallet.requestAccounts`
 * with `silent_mode` is reachable from any open tab, so renewing here would let
 * a site hold the wallet unlocked forever by polling.
 *
 * Split out of `messages.ts` so that file stays within the size budget; the
 * handlers are registered in the same router table, so routing is unchanged.
 */

import { enrichApprovals } from "../approvals/approval-insights";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { RouterHandler } from "./message-context";
import {
  readGetGrantedAccountsInput,
  readRequestAccountsInput,
  readTypeOnlyInput,
} from "./message-inputs";
import { isClaimedSenderOrigin, isExtensionPageSender } from "./senders";

/**
 * Answers an origin's granted accounts. A privileged passphrase may only come
 * from an extension page, and a blocklisted origin sees an empty list even when
 * it still holds an old grant.
 */
export const handleGetGrantedAccounts: RouterHandler = async (
  ctx,
  messageType,
  message,
  sender,
) => {
  if (messageType !== "wallet.getGrantedAccounts") {
    return null;
  }
  const input = readGetGrantedAccountsInput(message);
  if (!input) {
    return { error: "invalid granted accounts request" };
  }
  if (input.vaultPassphrase && !isExtensionPageSender(sender, ctx.extensionId)) {
    return { error: "privileged sender required" };
  }
  if (!isClaimedSenderOrigin(sender, ctx.extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  // A blocklisted origin must see no accounts even if it holds an old grant.
  if (ctx.guard.isBlocked(input.origin)) {
    return { accounts: [], ok: true };
  }
  // Peek, never renew: re-querying grants must not extend the unlock lifetime.
  const vaultPassphrase = input.vaultPassphrase ?? ctx.session.peekPassphrase();
  if (!vaultPassphrase) {
    return { error: "wallet locked" };
  }
  return {
    accounts: await ctx.wallet.getGrantedAccounts(input.origin, vaultPassphrase),
    ok: true,
  };
};

/**
 * Lists the queued approvals, enriched with the origin history the prompt shows.
 */
export const handlePendingApprovals: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.pendingApprovals") {
    return null;
  }
  if (!readTypeOnlyInput(message, "wallet.pendingApprovals")) {
    return { error: "invalid pending approvals request" };
  }
  return {
    ok: true,
    pending: await enrichApprovals(ctx.approvals.list(), ctx.originHistory, ctx.guard),
  };
};

/**
 * Connects an origin: answers from an existing grant when one is live, and
 * otherwise queues an approval and holds the response until the user decides.
 */
export const handleRequestAccounts: RouterHandler = async (ctx, messageType, message, sender) => {
  if (messageType !== "wallet.requestAccounts") {
    return null;
  }
  const input = readRequestAccountsInput(message);
  if (!input) {
    return { error: "invalid request accounts request" };
  }
  if (!isClaimedSenderOrigin(sender, ctx.extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if (ctx.guard.isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  // Peek, never renew. `wallet_requestAccounts` with `silent_mode` is reachable
  // from any open page and answers without a prompt, so a site could otherwise
  // hold the wallet unlocked forever just by calling it on a timer.
  const passphrase = ctx.session.peekPassphrase();
  if (passphrase) {
    const accounts = await ctx.wallet.getGrantedAccounts(input.origin, passphrase);
    if (accounts.length > 0) {
      // Record the origin only once it is actually connecting, so the enricher
      // still reports "first time seen" for a new site's approval.
      await ctx.originHistory.record(input.origin);
      return { accounts, ok: true };
    }
  }
  if (input.silent) {
    return { accounts: [], ok: true };
  }
  // Queue a connection approval and hold the response until the user approves.
  const approval = ctx.approvals.request(input.origin);
  notifyApprovalsChanged();
  return ctx.waiters.register(approval.id);
};
