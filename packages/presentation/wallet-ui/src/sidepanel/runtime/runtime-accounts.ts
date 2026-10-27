/** Account-creation runtime messages kept together so every path carries its contract type. */

import type { AccountContractType, AccountRef } from "@bramble/wallet-model/accounts";
import type { RecoveryAccountSelection } from "@bramble/wallet-model/recovery";
import { isCreateAccountResponse } from "../../popup/responses/responses";
import {
  isReadyKeyDiscoveryResponse,
  isRecoveredAccountsResponse,
  isRecoveryDiscoveryResponse,
  type ReadyKeyCandidate,
} from "../../popup/responses/responses-onboarding";
import { responseError } from "./runtime-errors";

const isMatchingAccountResponse = (
  response: unknown,
  networkId: string,
  accountContractType: AccountContractType,
): response is { readonly account: AccountRef; readonly ok: true } =>
  isCreateAccountResponse(response) &&
  response.account.networkId === networkId &&
  response.account.accountContractType === accountContractType;

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
    if (isMatchingAccountResponse(response, networkId, accountContractType)) {
      return response.account.id;
    }
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
    if (isMatchingAccountResponse(response, networkId, accountContractType)) return;
    throw responseError(response, "wallet unavailable");
  },
  /**
   * First-run only: creates a phrase-less vault around one raw private key and
   * unlocks it. The key travels solely in this privileged extension-page
   * request; the background fails closed over an existing vault.
   */
  async createKeyVault(
    networkId: string,
    privateKey: string,
    vaultPassphrase: string,
    accountContractType: AccountContractType,
    deploymentSalt?: string,
    classHashes?: readonly string[],
  ): Promise<string> {
    const response = await sendMessage({
      accountContractType,
      ...(classHashes === undefined ? {} : { classHashes }),
      ...(deploymentSalt === undefined ? {} : { deploymentSalt }),
      networkId,
      privateKey,
      type: "wallet.createKeyVault",
      vaultPassphrase,
    });
    if (isMatchingAccountResponse(response, networkId, accountContractType)) {
      return response.account.id;
    }
    throw responseError(response, "create key vault failed");
  },
  async importAccount(
    networkId: string,
    privateKey: string,
    accountContractType: AccountContractType,
    deploymentSalt?: string,
    classHashes?: readonly string[],
  ): Promise<string> {
    const response = await sendMessage({
      accountContractType,
      ...(classHashes === undefined ? {} : { classHashes }),
      ...(deploymentSalt === undefined ? {} : { deploymentSalt }),
      networkId,
      privateKey,
      type: "wallet.importAccount",
    });
    if (isMatchingAccountResponse(response, networkId, accountContractType)) {
      return response.account.id;
    }
    throw responseError(response, "import account failed");
  },
  /**
   * Lists the Argent releases a raw Ready key controls an address in use at,
   * before the user picks which to import. The key travels only in this
   * privileged request; the answer is public addresses and classes.
   */
  async discoverReadyKeyAccounts(
    networkId: string,
    privateKey: string,
    deploymentSalt?: string,
  ): Promise<readonly ReadyKeyCandidate[]> {
    const response = await sendMessage({
      ...(deploymentSalt === undefined ? {} : { deploymentSalt }),
      networkId,
      privateKey,
      type: "wallet.discoverReadyKeyAccounts",
    });
    if (isReadyKeyDiscoveryResponse(response)) return response.candidates;
    throw responseError(response, "ready account check unavailable");
  },
  async discoverRecoveryAccounts(mnemonic: string, networkId: string, manualIndex?: number) {
    const response = await sendMessage({
      ...(manualIndex === undefined ? {} : { manualIndex }),
      mnemonic,
      networkId,
      type: "wallet.discoverRecoveryAccounts",
    });
    if (isRecoveryDiscoveryResponse(response)) return response;
    throw responseError(response, "account discovery unavailable");
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
    if (isMatchingAccountResponse(response, networkId, accountContractType)) {
      return response.account;
    }
    throw responseError(response, "account preview unavailable");
  },
  /**
   * Imports selected accounts from another recovery phrase into the unlocked
   * wallet. The phrase travels only in this privileged extension-page request;
   * the background takes the vault passphrase from the live session.
   */
  async importSeedAccounts(
    mnemonic: string,
    networkId: string,
    selections: readonly RecoveryAccountSelection[],
  ): Promise<readonly AccountRef[]> {
    const response = await sendMessage({
      mnemonic,
      networkId,
      selections,
      type: "wallet.importSeedAccounts",
    });
    if (isRecoveredAccountsResponse(response)) {
      return response.accounts;
    }
    throw responseError(response, "seed import failed");
  },
  /**
   * Read-only rescan of the wallet's OWN phrase. The phrase stays inside the
   * vault boundary; the request carries only the network and an optional manual
   * index.
   */
  async discoverOwnAccounts(networkId: string, manualIndex?: number) {
    const response = await sendMessage({
      ...(manualIndex === undefined ? {} : { manualIndex }),
      networkId,
      type: "wallet.discoverOwnAccounts",
    });
    if (isRecoveryDiscoveryResponse(response)) return response;
    throw responseError(response, "account discovery unavailable");
  },
  /**
   * Adds selected discovered accounts of the wallet's OWN phrase. The background
   * reads the phrase inside the vault boundary through the live session.
   */
  async importOwnAccounts(
    networkId: string,
    selections: readonly RecoveryAccountSelection[],
  ): Promise<readonly AccountRef[]> {
    const response = await sendMessage({
      networkId,
      selections,
      type: "wallet.importOwnAccounts",
    });
    if (isRecoveredAccountsResponse(response)) {
      return response.accounts;
    }
    throw responseError(response, "account import failed");
  },
  async recoverAccounts(
    mnemonic: string,
    networkId: string,
    vaultPassphrase: string,
    selections: readonly RecoveryAccountSelection[],
  ): Promise<readonly AccountRef[]> {
    const response = await sendMessage({
      mnemonic,
      networkId,
      selections,
      type: "wallet.recoverAccounts",
      vaultPassphrase,
    });
    if (isRecoveredAccountsResponse(response)) return response.accounts;
    throw responseError(response, "account recovery unavailable");
  },
});
