/**
 * Background handlers for the five QSB withdrawal messages.
 *
 * Trust boundary: none of these types is in `DAPP_MESSAGES`, so the sender
 * gate turns every content script and page away before they get here. Inputs
 * are parsed strictly (./qsb-withdrawal-inputs). The quote, start, review and
 * resend run over the unlocked session's vault password, renewed as every
 * user action is; the release runs over the password the user re-entered in
 * the message instead — opening the vault session decrypts the vault with
 * it, which is the check, mapped as `wallet.revealQsbPhrase` maps it — and is
 * the fresh user authorization each disclosure session needs, retries
 * included. Every flow runs under the account's QSB lock.
 *
 * Replies are built from `QsbVaultView`, `QsbWithdrawalQuote` and
 * `QsbWithdrawalReview`: public data only, never a preimage, the phrase, the
 * owner key, a job id, a journal id, signed bytes or a coordinator token.
 */
import type { RouterContext } from "../routing/message-context";
import { unlockFailureError } from "../routing/unlock-errors";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { readQsbVaultInput } from "./qsb-vault-inputs";
import { asUser, type QsbVaultHandler, UNAVAILABLE, wiredFor } from "./qsb-vault-ops";
import {
  readQsbWithdrawalQuoteInput,
  readQsbWithdrawalReleaseInput,
  readQsbWithdrawalStartInput,
} from "./qsb-withdrawal-inputs";
import { releaseQsbWithdrawal, resendQsbWithdrawal } from "./qsb-withdrawal-release";
import { reviewQsbWithdrawal } from "./qsb-withdrawal-review";
import { quoteQsbWithdrawal, startQsbWithdrawal } from "./qsb-withdrawal-start";

const quote: QsbVaultHandler = async (ctx, message) => {
  const input = readQsbWithdrawalQuoteInput(message);
  if (!input) return { error: "invalid quote qsb withdrawal request" };
  return asUser(ctx, input.accountId, async ({ deps }, open) => ({
    ok: true,
    quote: await open((access) => quoteQsbWithdrawal(deps, access, input)),
  }));
};

const start: QsbVaultHandler = async (ctx, message) => {
  const input = readQsbWithdrawalStartInput(message);
  if (!input) return { error: "invalid start qsb withdrawal request" };
  return asUser(ctx, input.accountId, async ({ deps }, open) => ({
    ok: true,
    vault: await open((access) => startQsbWithdrawal(deps, access, input)),
  }));
};

const review: QsbVaultHandler = async (ctx, message) => {
  const input = readQsbVaultInput(message, "wallet.reviewQsbWithdrawal");
  if (!input) return { error: "invalid review qsb withdrawal request" };
  return asUser(ctx, input.accountId, async ({ deps }, open) => ({
    ok: true,
    review: await open((access) => reviewQsbWithdrawal(deps, access, input.v)),
  }));
};

// The release, over the password in the message: a wrong one fails to open
// the vault and reads as unlock's does; a refusal passes through unchanged.
const release: QsbVaultHandler = async (ctx, message) => {
  const input = readQsbWithdrawalReleaseInput(message);
  if (!input) return { error: "invalid release qsb withdrawal request" };
  const wired = wiredFor(ctx, input.accountId);
  if (!wired) return UNAVAILABLE;
  try {
    const reply = await wired.opener(input.vaultPassphrase)((access) =>
      releaseQsbWithdrawal(wired.deps, access, input),
    );
    return { ok: true, ...reply };
  } catch (error) {
    throw unlockFailureError(error);
  }
};

const resend: QsbVaultHandler = async (ctx, message) => {
  const input = readQsbVaultInput(message, "wallet.resendQsbWithdrawal");
  if (!input) return { error: "invalid resend qsb withdrawal request" };
  return asUser(ctx, input.accountId, async ({ deps }, open) => ({
    ok: true,
    ...(await open((access) => resendQsbWithdrawal(deps, access, input.v))),
  }));
};

const QSB_WITHDRAWAL_HANDLERS: ReadonlyMap<string, QsbVaultHandler> = new Map([
  ["wallet.quoteQsbWithdrawal", quote],
  ["wallet.releaseQsbWithdrawal", release],
  ["wallet.resendQsbWithdrawal", resend],
  ["wallet.reviewQsbWithdrawal", review],
  ["wallet.startQsbWithdrawal", start],
]);

/**
 * Routes the five QSB withdrawal messages; null for every other type, so the
 * router moves on to the next handler.
 */
export const handleQsbWithdrawalOps = async (
  ctx: RouterContext,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = QSB_WITHDRAWAL_HANDLERS.get(messageType);
  return handler ? handler(ctx, message) : null;
};
