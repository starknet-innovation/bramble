/**
 * Background handlers for the five Quantum Safe Bitcoin (QSB) vault messages.
 *
 * Trust boundary: none of these types is in `DAPP_MESSAGES`, so the sender
 * gate turns every content script and page away before they get here. Inputs
 * are parsed strictly (./qsb-vault-inputs). Each runs over the unlocked
 * session's vault password, handed straight to the vault service's QSB
 * session and never kept: `wallet.qsbVaults`, which the panel polls, only
 * peeks at the session so it never holds the wallet unlocked, and answers as
 * a locked wallet does if a lock lands during the read; the user's own
 * actions, the quote included, renew it as every user-initiated read does.
 *
 * Fails closed: a wallet or root without QSB vault wiring answers "wallet
 * unavailable", a locked session "wallet locked", and the flows refuse only
 * with the contract's diagnostics. Every reply is built from
 * `QsbVaultView`s, `QsbOwnerFunds` and `QsbDepositQuote`s: public data only,
 * never the phrase, the owner key, a journal id or a coordinator token.
 */
import type { RouterContext } from "../routing/message-context";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { createQsbVault } from "./qsb-vault-create";
import { depositQsbVault, quoteQsbDeposit, resendQsbDeposit } from "./qsb-vault-deposit";
import {
  readQsbAccountInput,
  readQsbDepositInput,
  readQsbQuoteInput,
  readQsbVaultInput,
} from "./qsb-vault-inputs";
import { listQsbVaults, type QsbVaultOpener } from "./qsb-vault-list";
import type { QsbVaultDeps } from "./qsb-vault-session";

type QsbVaultHandler = (ctx: RouterContext, message: unknown) => Promise<RuntimeResponse>;

const UNAVAILABLE: RuntimeResponse = { error: "wallet unavailable" };
const LOCKED: RuntimeResponse = { error: "wallet locked" };

type Wired = {
  readonly deps: QsbVaultDeps;
  readonly opener: (vaultPassphrase: string) => QsbVaultOpener;
};

// The vault deps and a session opener for one account, or null when unwired.
const wiredFor = (ctx: RouterContext, accountId: string): Wired | null => {
  const deps = ctx.qsbVaults;
  const open = ctx.wallet.withQsbVaultAccount;
  if (!deps || !open) return null;
  return {
    deps,
    opener: (vaultPassphrase) => (task) => open({ accountId, vaultPassphrase }, task),
  };
};

// Runs a user action under the renewed session.
const asUser = async (
  ctx: RouterContext,
  accountId: string,
  run: (wired: Wired, open: QsbVaultOpener) => Promise<RuntimeResponse>,
): Promise<RuntimeResponse> => {
  const wired = wiredFor(ctx, accountId);
  if (!wired) return UNAVAILABLE;
  const vaultPassphrase = ctx.session.getPassphrase();
  return vaultPassphrase ? run(wired, wired.opener(vaultPassphrase)) : LOCKED;
};

const listVaults: QsbVaultHandler = async (ctx, message) => {
  const input = readQsbAccountInput(message, "wallet.qsbVaults");
  if (!input) return { error: "invalid qsb vaults request" };
  const wired = wiredFor(ctx, input.accountId);
  if (!wired) return UNAVAILABLE;
  const authorized = captureSessionAuthorization(ctx.session);
  const vaultPassphrase = ctx.session.peekPassphrase();
  if (!vaultPassphrase) return LOCKED;
  const listing = await listQsbVaults(wired.deps, wired.opener(vaultPassphrase));
  return authorized.isCurrent() ? { ...listing, ok: true } : LOCKED;
};

const createVault: QsbVaultHandler = async (ctx, message) => {
  const input = readQsbAccountInput(message, "wallet.createQsbVault");
  if (!input) return { error: "invalid create qsb vault request" };
  return asUser(ctx, input.accountId, async ({ deps }, open) => ({
    ok: true,
    vault: await open((access) => createQsbVault(deps, access)),
  }));
};

const quoteDeposit: QsbVaultHandler = async (ctx, message) => {
  const input = readQsbQuoteInput(message);
  if (!input) return { error: "invalid quote qsb deposit request" };
  return asUser(ctx, input.accountId, async ({ deps }, open) => ({
    ok: true,
    quote: await open((access) => quoteQsbDeposit(deps, access, input)),
  }));
};

const deposit: QsbVaultHandler = async (ctx, message) => {
  const input = readQsbDepositInput(message);
  if (!input) return { error: "invalid deposit qsb vault request" };
  return asUser(ctx, input.accountId, async ({ deps }, open) => ({
    ok: true,
    ...(await open((access) => depositQsbVault(deps, access, input))),
  }));
};

const resend: QsbVaultHandler = async (ctx, message) => {
  const input = readQsbVaultInput(message, "wallet.resendQsbDeposit");
  if (!input) return { error: "invalid resend qsb deposit request" };
  return asUser(ctx, input.accountId, async ({ deps }, open) => ({
    ok: true,
    ...(await open((access) => resendQsbDeposit(deps, access, input.v))),
  }));
};

const QSB_VAULT_HANDLERS: ReadonlyMap<string, QsbVaultHandler> = new Map([
  ["wallet.createQsbVault", createVault],
  ["wallet.depositQsbVault", deposit],
  ["wallet.qsbVaults", listVaults],
  ["wallet.quoteQsbDeposit", quoteDeposit],
  ["wallet.resendQsbDeposit", resend],
]);

/**
 * Routes the five QSB vault messages; null for every other type, so the
 * router moves on to the next handler.
 */
export const handleQsbVaultOps = async (
  ctx: RouterContext,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = QSB_VAULT_HANDLERS.get(messageType);
  return handler ? handler(ctx, message) : null;
};
