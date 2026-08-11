/**
 * Account-derivation wrappers over the runtime send function: finding the
 * accounts a recovery phrase already has on chain, and adding one at a chosen HD
 * position. Spread into the main side-panel runtime client so callers see one
 * flat wallet surface (the same arrangement as ./ledger/runtime-client).
 *
 * Split from ./runtime for the file-size budget, and these two in particular
 * because neither carries secret material: only a network id and an HD index
 * cross, and the scan's reply is public account metadata. Recovery phrases and
 * raw keys stay in the main client, which is audited for that.
 */

import {
  isCreateAccountResponse,
  isSeedScanResponse,
  type SeedScanCandidate,
} from "../popup/responses";
import { responseError } from "./response-error";

/**
 * The account-derivation half of the panel wallet client.
 */
export type AccountsRuntimeClient = {
  /**
   * Derives an account on `networkId` and returns its id. `accountIndex` targets
   * one HD position, which restoring a phrase needs; omitted, the wallet takes
   * the lowest unused one.
   */
  readonly addAccount: (networkId: string, accountIndex?: number) => Promise<string>;
  /**
   * Reports the HD positions this wallet's recovery phrase already has on chain.
   * The phrase never leaves the background; only public metadata comes back.
   */
  readonly scanSeedAccounts: () => Promise<readonly SeedScanCandidate[]>;
};

/**
 * Builds the account-derivation wrappers over a runtime send function.
 */
export const createAccountsRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
): AccountsRuntimeClient => ({
  async addAccount(networkId, accountIndex) {
    const response = await sendMessage({
      ...(accountIndex === undefined ? {} : { accountIndex }),
      networkId,
      type: "wallet.addAccount",
    });
    if (isCreateAccountResponse(response)) {
      // Surface the created account's id so the caller can file it into the
      // focused group (the background already returns the account here).
      return response.account.id;
    }
    throw responseError(response, "add account failed");
  },
  async scanSeedAccounts() {
    const response = await sendMessage({ type: "wallet.scanSeedAccounts" });
    if (isSeedScanResponse(response)) {
      return response.candidates;
    }
    throw responseError(response, "Could not scan for accounts");
  },
});
