/**
 * Background handlers for the Quantum Safe Bitcoin (QSB) account messages.
 *
 * Trust boundary: none of these types is in `DAPP_MESSAGES`, so the sender
 * gate turns every content script and page away before they get here. Inputs
 * are parsed strictly (./qsb-account-inputs). Listing, creating, importing and
 * confirming use the unlocked session's vault password; the listing only
 * peeks at it, since the panel lists on every render and that must not hold
 * the wallet unlocked, while the three user actions renew it. Revealing takes
 * the password from the message and never from the session, and its reply is
 * the only one that carries a QSB phrase. Every other reply is a
 * `QsbAccountView`, which holds neither the phrase nor the journal id.
 *
 * Fails closed: a wallet surface without the QSB methods answers "wallet
 * unavailable", a locked session "wallet locked", and the vault service's
 * refusals (`QSB_ACCOUNT_REFUSALS`) pass through as thrown.
 */
import type { RouterContext } from "../routing/message-context";
import { readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import {
  readConfirmQsbBackupInput,
  readImportQsbAccountInput,
  readRevealQsbPhraseInput,
} from "./qsb-account-inputs";

type QsbHandler = (ctx: RouterContext, message: unknown) => Promise<RuntimeResponse>;

const UNAVAILABLE: RuntimeResponse = { error: "wallet unavailable" };
const LOCKED: RuntimeResponse = { error: "wallet locked" };

// A lock that lands during the read answers as a locked wallet does, so the
// list never outlives the unlock it was read under.
const listQsbAccounts: QsbHandler = async (ctx, message) => {
  if (!readTypeOnlyInput(message, "wallet.qsbAccounts")) {
    return { error: "invalid qsb accounts request" };
  }
  const list = ctx.wallet.qsbAccounts;
  if (!list) {
    return UNAVAILABLE;
  }
  const authorized = captureSessionAuthorization(ctx.session);
  const vaultPassphrase = ctx.session.peekPassphrase();
  if (!vaultPassphrase) {
    return LOCKED;
  }
  const accounts = await list(vaultPassphrase);
  return authorized.isCurrent() ? { accounts, ok: true } : LOCKED;
};

const createQsbAccount: QsbHandler = async (ctx, message) => {
  if (!readTypeOnlyInput(message, "wallet.createQsbAccount")) {
    return { error: "invalid create qsb account request" };
  }
  const create = ctx.wallet.createQsbAccount;
  if (!create) {
    return UNAVAILABLE;
  }
  const vaultPassphrase = ctx.session.getPassphrase();
  return vaultPassphrase ? { account: await create(vaultPassphrase), ok: true } : LOCKED;
};

const importQsbAccount: QsbHandler = async (ctx, message) => {
  const input = readImportQsbAccountInput(message);
  if (!input) {
    return { error: "invalid import qsb account request" };
  }
  const importAccount = ctx.wallet.importQsbAccount;
  if (!importAccount) {
    return UNAVAILABLE;
  }
  const vaultPassphrase = ctx.session.getPassphrase();
  return vaultPassphrase
    ? { account: await importAccount({ mnemonic: input.mnemonic, vaultPassphrase }), ok: true }
    : LOCKED;
};

// The sanctioned QSB reveal: the password is the one in the message, checked
// by decrypting the vault with it, whether the wallet is unlocked or not.
const revealQsbPhrase: QsbHandler = async (ctx, message) => {
  const input = readRevealQsbPhraseInput(message);
  if (!input) {
    return { error: "invalid reveal qsb phrase request" };
  }
  const reveal = ctx.wallet.revealQsbPhrase;
  return reveal ? { mnemonic: await reveal(input), ok: true } : UNAVAILABLE;
};

const confirmQsbBackup: QsbHandler = async (ctx, message) => {
  const input = readConfirmQsbBackupInput(message);
  if (!input) {
    return { error: "invalid confirm qsb backup request" };
  }
  const confirm = ctx.wallet.confirmQsbBackup;
  if (!confirm) {
    return UNAVAILABLE;
  }
  const vaultPassphrase = ctx.session.getPassphrase();
  return vaultPassphrase
    ? { account: await confirm({ ...input, vaultPassphrase }), ok: true }
    : LOCKED;
};

const QSB_HANDLERS: ReadonlyMap<string, QsbHandler> = new Map([
  ["wallet.confirmQsbBackup", confirmQsbBackup],
  ["wallet.createQsbAccount", createQsbAccount],
  ["wallet.importQsbAccount", importQsbAccount],
  ["wallet.qsbAccounts", listQsbAccounts],
  ["wallet.revealQsbPhrase", revealQsbPhrase],
]);

/**
 * Routes the five QSB account messages; null for every other type, so the
 * router moves on to the next handler.
 */
export const handleQsbAccountOps = async (
  ctx: RouterContext,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = QSB_HANDLERS.get(messageType);
  return handler ? handler(ctx, message) : null;
};
