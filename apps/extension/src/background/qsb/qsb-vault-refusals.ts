/**
 * How the QSB vault flows refuse: with exactly the contract's diagnostics
 * (`QSB_VAULT_REFUSALS`, and `QSB_ACCOUNT_REFUSALS` for the account itself),
 * which the panel's copy table translates, and with nothing else.
 *
 * A coordinator failure is classified by its status and code only (qsb-app
 * `server/api-errors.ts`): a script another vault holds or something already
 * paid (`scriptTaken`), a deployment that will not serve this owner
 * (`coordinatorDisabled`), an expired or refused session (signed in again by
 * the caller), and every other failure, retryable or not, as the coordinator
 * being unavailable. {@link failClosed} turns anything unnamed — a storage
 * failure, a runtime error, a coordinator message — into the flow's own
 * fallback, so no internal text reaches a page.
 */
import { RefusedBeforeWrite, WalletError } from "@bramble/core/errors";
import { QsbCoordinatorFailure } from "@bramble/qsb/client";
import type { QsbJournalRefusal } from "@bramble/vault/qsb-journal";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";

/** One of the contract's vault refusals, by name. */
export type QsbVaultRefusal = keyof typeof QSB_VAULT_REFUSALS;

/** The refusal `name`, raised as a refusal before anything was written or sent. */
export const qsbRefusal = (name: QsbVaultRefusal): RefusedBeforeWrite =>
  new RefusedBeforeWrite(QSB_VAULT_REFUSALS[name]);

/** One of the contract's withdrawal refusals, by name. */
export type QsbWithdrawalRefusal = keyof typeof QSB_WITHDRAWAL_REFUSALS;

/** The withdrawal refusal `name`, raised before anything was disclosed or sent. */
export const withdrawalRefusal = (name: QsbWithdrawalRefusal): RefusedBeforeWrite =>
  new RefusedBeforeWrite(QSB_WITHDRAWAL_REFUSALS[name]);

/** The account refusal that a missing or unreadable history is. */
export const journalUnavailable = (): RefusedBeforeWrite =>
  new RefusedBeforeWrite(QSB_ACCOUNT_REFUSALS.journalUnavailable);

const NAMED: ReadonlySet<string> = new Set([
  ...Object.values(QSB_VAULT_REFUSALS),
  ...Object.values(QSB_ACCOUNT_REFUSALS),
  ...Object.values(QSB_WITHDRAWAL_REFUSALS),
]);

// The codes whose refusal is the deployment's, for this owner, before it
// wrote or sent anything.
const OWNER_REFUSALS: ReadonlySet<string> = new Set([
  "operations_disabled",
  "owner_limits_invalid",
  "owner_not_allowlisted",
  "submit_disabled",
]);

const isFailure = (error: unknown, codes: ReadonlySet<string>, status?: number): boolean =>
  error instanceof QsbCoordinatorFailure &&
  error.kind === "refused" &&
  error.code !== null &&
  codes.has(error.code) &&
  (status === undefined || error.status === status);

/** A 401 that says the session is missing or over: sign in again. */
export const isSessionExpired = (error: unknown): boolean =>
  isFailure(error, new Set(["auth_required", "session_expired"]), 401);

/** A 400 refusing a registration body as invalid: final, and Bramble's to fix. */
export const isRegistrationRefused = (error: unknown): boolean =>
  isFailure(error, new Set(["invalid_request", "vault_invalid"]), 400);

/** A 409 refusing a script another vault holds, or that something already paid. */
export const isScriptTaken = (error: unknown): boolean =>
  isFailure(error, new Set(["vault_script_paid", "vault_script_registered"]), 409);

// The deployment refusing this owner, or switched off, before anything was written.
const isOwnerRefusal = (error: unknown): boolean => isFailure(error, OWNER_REFUSALS);

/** The contract's refusal for a coordinator failure outside a flow's own cases. */
export const coordinatorRefusal = (error: unknown): RefusedBeforeWrite => {
  if (isScriptTaken(error)) return qsbRefusal("scriptTaken");
  if (isOwnerRefusal(error)) return qsbRefusal("coordinatorDisabled");
  return qsbRefusal("coordinatorUnavailable");
};

/** The contract's refusal for a refused journal change. */
export const journalRefusal = (refusal: QsbJournalRefusal): RefusedBeforeWrite => {
  switch (refusal) {
    case "allocation-exhausted":
    case "journal-full":
      return qsbRefusal("vaultLimit");
    case "journal-unavailable":
      return journalUnavailable();
    case "not-writer":
      return qsbRefusal("notWriter");
    case "unknown-vault":
      return qsbRefusal("unknownVault");
    default:
      return qsbRefusal("runtimeUnavailable");
  }
};

/**
 * Runs `run`, letting a named refusal through and turning a coordinator
 * failure into its refusal and anything else into `fallback`.
 */
export const failClosed = <T>(fallback: QsbVaultRefusal, run: () => Promise<T>): Promise<T> =>
  failClosedWith(() => qsbRefusal(fallback), run);

/**
 * {@link failClosed} with any fallback: a named refusal passes through, a
 * coordinator failure becomes its contract refusal, anything else `fallback`.
 */
export const failClosedWith = async <T>(
  fallback: () => Error,
  run: () => Promise<T>,
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WalletError && NAMED.has(error.message)) {
      throw error;
    }
    throw error instanceof QsbCoordinatorFailure ? coordinatorRefusal(error) : fallback();
  }
};
