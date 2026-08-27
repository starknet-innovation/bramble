/**
 * Panel-side message wrappers for the privileged Ledger operations, split out of
 * the main runtime client to keep each module within the size budget. Each
 * method sends a typed request over the injected send function and parses the
 * reply through its `isX` guard, failing closed on an unrecognised shape. No
 * secret material crosses: a Ledger request carries only a device public key, an
 * account index, a derivation path, and a public `(r, s)` signature pair.
 */

import type { AccountContractType } from "@mc-wallet/wallet-model/accounts";
import type { LedgerPubKeyEntry } from "@mc-wallet/wallet-model/ledger-path";
import {
  isCreateAccountResponse,
  isErrorResponse,
  isLedgerAccountStatusResponse,
  isLedgerAccountsResponse,
  isLedgerSignPendingResponse,
  isOkResponse,
  type LedgerAccountsResponse,
  type LedgerSignRequestSummary,
} from "../../../popup/responses/responses";

/**
 * One Ledger candidate's best-effort on-chain state as the panel consumes it:
 * deployed status and balance display string, each null when the RPC degraded.
 */
type LedgerAccountStatus = {
  readonly balance: string | null;
  readonly deployed: boolean | null;
};

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
    accountContractType: AccountContractType,
  ) => Promise<string>;
  readonly completeLedgerSign: (outcome: LedgerSignOutcome) => Promise<void>;
  readonly createLedgerVault: (
    networkId: string,
    accountIndex: number,
    publicKeyX: string,
    vaultPassphrase: string,
    accountContractType: AccountContractType,
  ) => Promise<string>;
  readonly deriveLedgerAccounts: (
    networkId: string,
    entries: readonly LedgerPubKeyEntry[],
    accountContractType: AccountContractType,
  ) => Promise<LedgerAccountsResponse["accounts"]>;
  readonly ledgerAccountStatus: (
    address: string,
    networkId: string,
  ) => Promise<LedgerAccountStatus>;
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
  async addLedgerAccount(networkId, accountIndex, publicKeyX, accountContractType) {
    const response = await sendMessage({
      accountContractType,
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
  async createLedgerVault(
    networkId,
    accountIndex,
    publicKeyX,
    vaultPassphrase,
    accountContractType,
  ) {
    const response = await sendMessage({
      accountContractType,
      accountIndex,
      networkId,
      publicKeyX,
      type: "wallet.createLedgerVault",
      vaultPassphrase,
    });
    if (isCreateAccountResponse(response)) {
      // Surface the created account's id, mirroring addLedgerAccount. Only the
      // device public key, index, and the (write-only) passphrase cross — no seed
      // is generated and no key material is echoed back.
      return response.account.id;
    }
    throw failure(response, "create Ledger wallet failed");
  },
  async deriveLedgerAccounts(networkId, entries, accountContractType) {
    const response = await sendMessage({
      accountContractType,
      entries,
      networkId,
      type: "wallet.deriveLedgerAccounts",
    });
    if (isLedgerAccountsResponse(response)) {
      return response.accounts;
    }
    throw failure(response, "derive Ledger accounts failed");
  },
  async ledgerAccountStatus(address, networkId) {
    const response = await sendMessage({ address, networkId, type: "wallet.ledgerAccountStatus" });
    // Fail soft: an unrecognised reply degrades to "checking/unavailable" so the
    // picker never blocks or shows a fabricated deployed status or balance.
    return isLedgerAccountStatusResponse(response)
      ? { balance: response.balance, deployed: response.deployed }
      : { balance: null, deployed: null };
  },
  async loadLedgerSignPending() {
    const response = await sendMessage({ type: "wallet.ledgerSignPending" });
    return isLedgerSignPendingResponse(response) ? response.pending : [];
  },
});
