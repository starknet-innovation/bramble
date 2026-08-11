/**
 * Account-derivation wrappers over the runtime send function: finding the
 * accounts a recovery phrase already has on chain, and adding one at a chosen HD
 * position. Spread into the main side-panel runtime client so callers see one
 * flat wallet surface (the same arrangement as ./ledger/runtime-client).
 *
 * Split from ./runtime for the file-size budget. The scan accepts the phrase
 * being recovered, because the setup screen has to list a phrase's accounts
 * before any vault exists — the same privileged request `wallet.previewAccount`
 * already makes from that screen. The phrase is sent and never stored, logged, or
 * returned; every reply here is public account metadata.
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
   * Reports the HD positions a recovery phrase already has on chain.
   *
   * Pass `mnemonic` during setup, where the phrase being recovered has no vault
   * yet; omit it for an unlocked wallet and the background reads its own. Either
   * way only public metadata comes back — no phrase is ever returned.
   */
  readonly scanSeedAccounts: (mnemonic?: string) => Promise<readonly SeedScanCandidate[]>;
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
  async scanSeedAccounts(mnemonic) {
    const response = await sendMessage({
      ...(mnemonic === undefined ? {} : { mnemonic }),
      type: "wallet.scanSeedAccounts",
    });
    if (isSeedScanResponse(response)) {
      return response.candidates;
    }
    throw responseError(response, "Could not scan for accounts");
  },
});
