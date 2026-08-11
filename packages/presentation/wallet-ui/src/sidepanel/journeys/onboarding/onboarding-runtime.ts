/**
 * Privileged onboarding runtime messages: generate, validate, preview, and
 * create. Recovery material travels only in these extension-page requests and
 * is never echoed in responses except generateMnemonic.
 */

import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import {
  isCreateAccountResponse,
  isErrorResponse,
  isGenerateMnemonicResponse,
  isValidateMnemonicResponse,
} from "../../../popup/responses/responses";

const responseError = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);

/**
 * Onboarding-only side panel actions over chrome.runtime messaging.
 */
export const createOnboardingRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
  async createAccount(mnemonic: string, networkId: string, vaultPassphrase: string): Promise<void> {
    const response = await sendMessage({
      mnemonic,
      networkId,
      type: "wallet.createAccount",
      vaultPassphrase,
    });
    if (isCreateAccountResponse(response)) {
      return;
    }
    throw responseError(response, "wallet unavailable");
  },
  async generateMnemonic(): Promise<string> {
    const response = await sendMessage({ type: "wallet.generateMnemonic" });
    if (isGenerateMnemonicResponse(response)) {
      return response.mnemonic;
    }
    throw responseError(response, "wallet unavailable");
  },
  async previewAccount(mnemonic: string, networkId: string): Promise<AccountRef> {
    const response = await sendMessage({
      accountIndex: 0,
      mnemonic,
      networkId,
      type: "wallet.previewAccount",
    });
    if (isCreateAccountResponse(response)) {
      return response.account;
    }
    throw responseError(response, "account preview unavailable");
  },
  /**
   * Asks Krusty whether the recovery phrase is valid. Never treats a local
   * word-list check as sufficient; false and transport failures both block
   * onboarding Continue.
   */
  async validateMnemonic(mnemonic: string): Promise<boolean> {
    const response = await sendMessage({ mnemonic, type: "wallet.validateMnemonic" });
    if (isValidateMnemonicResponse(response)) {
      return response.valid;
    }
    throw responseError(response, "mnemonic validation unavailable");
  },
});
