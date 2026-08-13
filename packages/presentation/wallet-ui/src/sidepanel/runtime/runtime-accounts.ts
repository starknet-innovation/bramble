/** Account-creation runtime messages kept together so every path carries its contract type. */

import type { AccountContractType, AccountRef } from "@mc-wallet/wallet-model/accounts";
import { isCreateAccountResponse } from "../../popup/responses/responses";
import { responseError } from "./runtime-errors";

/**
 * Builds the privileged single-signer account creation and preview client.
 */
export const createAccountRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
  async addAccount(networkId: string, accountContractType: AccountContractType): Promise<string> {
    const response = await sendMessage({
      accountContractType,
      networkId,
      type: "wallet.addAccount",
    });
    if (isCreateAccountResponse(response)) return response.account.id;
    throw responseError(response, "add account failed");
  },
  async createAccount(
    mnemonic: string,
    networkId: string,
    vaultPassphrase: string,
    accountContractType: AccountContractType,
  ): Promise<void> {
    const response = await sendMessage({
      accountContractType,
      mnemonic,
      networkId,
      type: "wallet.createAccount",
      vaultPassphrase,
    });
    if (isCreateAccountResponse(response)) return;
    throw responseError(response, "wallet unavailable");
  },
  async importAccount(
    networkId: string,
    privateKey: string,
    accountContractType: AccountContractType,
  ): Promise<string> {
    const response = await sendMessage({
      accountContractType,
      networkId,
      privateKey,
      type: "wallet.importAccount",
    });
    if (isCreateAccountResponse(response)) return response.account.id;
    throw responseError(response, "import account failed");
  },
  async previewAccount(
    mnemonic: string,
    networkId: string,
    accountContractType: AccountContractType,
  ): Promise<AccountRef> {
    const response = await sendMessage({
      accountContractType,
      accountIndex: 0,
      mnemonic,
      networkId,
      type: "wallet.previewAccount",
    });
    if (isCreateAccountResponse(response)) return response.account;
    throw responseError(response, "account preview unavailable");
  },
});
