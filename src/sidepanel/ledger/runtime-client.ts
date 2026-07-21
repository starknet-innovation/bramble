/**
 * Panel-side message wrappers for the privileged Ledger operations, split out of
 * the main runtime client to keep each module within the size budget. Each
 * method sends a typed request over the injected send function and parses the
 * reply through its `isX` guard, failing closed on an unrecognised shape. No
 * secret material crosses: a Ledger request carries only a device public key, an
 * account index, a derivation path, and a public `(r, s)` signature pair.
 */
import {
  isCreateAccountResponse,
  isErrorResponse,
  isLedgerAccountsResponse,
  isLedgerSignPendingResponse,
  isOkResponse,
  type LedgerAccountsResponse,
  type LedgerSignRequestSummary,
} from "../../popup/responses";
import type { LedgerPubKeyEntry } from "../../wallet/accounts";

/**
 * The panel's reply to one pending device sign: either the device `(r, s)` for
 * the queue id, or a typed rejection reason the background queue propagates as a
 * fail-closed error. Modelled as a discriminated union so a caller cannot report
 * both a signature and a rejection for the same id.
 */
export type LedgerSignOutcome =
  | { readonly id: string; readonly r: string; readonly s: string }
  | { readonly error: string; readonly id: string };

/**
 * The Ledger slice of the side-panel wallet client.
 */
export type LedgerRuntimeClient = {
  readonly addLedgerAccount: (
    networkId: string,
    accountIndex: number,
    publicKeyX: string,
  ) => Promise<string>;
  readonly completeLedgerSign: (outcome: LedgerSignOutcome) => Promise<void>;
  readonly deriveLedgerAccounts: (
    networkId: string,
    entries: readonly LedgerPubKeyEntry[],
  ) => Promise<LedgerAccountsResponse["accounts"]>;
  readonly loadLedgerSignPending: () => Promise<readonly LedgerSignRequestSummary[]>;
};

const failure = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);

/**
 * Builds the Ledger wrappers over a runtime send function. Spread into the main
 * side-panel runtime client so callers see one flat wallet surface.
 */
export const createLedgerRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
): LedgerRuntimeClient => ({
  async addLedgerAccount(networkId, accountIndex, publicKeyX) {
    const response = await sendMessage({
      accountIndex,
      networkId,
      publicKeyX,
      type: "wallet.addLedgerAccount",
    });
    if (isCreateAccountResponse(response)) {
      // Surface the created account's id so the caller can select it, mirroring
      // addAccount. Only the device public key and index cross — no key material.
      return response.account.id;
    }
    throw failure(response, "add Ledger account failed");
  },
  async completeLedgerSign(outcome) {
    const response = await sendMessage({ ...outcome, type: "wallet.completeLedgerSign" });
    if (isOkResponse(response)) {
      return;
    }
    throw failure(response, "complete Ledger sign failed");
  },
  async deriveLedgerAccounts(networkId, entries) {
    const response = await sendMessage({ entries, networkId, type: "wallet.deriveLedgerAccounts" });
    if (isLedgerAccountsResponse(response)) {
      return response.accounts;
    }
    throw failure(response, "derive Ledger accounts failed");
  },
  async loadLedgerSignPending() {
    const response = await sendMessage({ type: "wallet.ledgerSignPending" });
    return isLedgerSignPendingResponse(response) ? response.pending : [];
  },
});
