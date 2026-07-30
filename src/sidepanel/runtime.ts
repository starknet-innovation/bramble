/**
 * Typed runtime message client for the side panel UI.
 */

import {
  type ActivityResponse,
  type AllowancesResponse,
  type ClassHashVerificationResponse,
  type ConnectedSitesResponse,
  type DeploymentStatusResponse,
  isActivityResponse,
  isAllowancesResponse,
  isApprovalDecisionResponse,
  isBalancesResponse,
  isClassHashVerificationResponse,
  isConnectedSitesResponse,
  isCreateAccountResponse,
  isDeploymentStatusResponse,
  isDetectTokensResponse,
  isErrorResponse,
  isGenerateMnemonicResponse,
  isPendingApprovalsResponse,
  isPreferencesResponse,
  isPricesResponse,
  isRevealSecretsResponse,
  isTokenChartResponse,
  isTransferResponse,
  isTransferReviewResponse,
  isWalletStatus,
  type PendingApproval,
  type RevealSecretsResponse,
  type TokenBalance,
  type TransferReviewResponse,
  type WalletStatus,
} from "../popup/responses";
import type { Strk20NetworkConfig } from "../starknet/strk20/config";
import type { AccountGroupIcon } from "../storage/account-groups";
import type { AccountRef } from "../storage/vault-schema";
import { createLedgerRuntimeClient } from "./ledger/runtime-client";
import { createNftRuntimeClient } from "./nft-runtime";

/**
 * Minimal browser runtime API consumed by the side panel.
 */
export type RuntimeApi = {
  readonly onMessage?: {
    readonly addListener: (listener: (message: unknown) => void) => void;
  };
  readonly sendMessage: (message: unknown) => Promise<unknown>;
};

/**
 * Balance loading state rendered by the side panel.
 */
export type BalanceState =
  | { readonly balances: readonly TokenBalance[]; readonly error?: never }
  | { readonly balances?: never; readonly error: string };

/**
 * A locked, account-less status used before the first load resolves and as the
 * fallback when the background is unavailable.
 */
export const emptyStatus = (): WalletStatus => ({
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: false,
  locked: true,
  network: "Unavailable",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: false,
});

const responseError = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);

/**
 * Wallet client surface returned by createSidepanelRuntime.
 */
export type SidepanelWallet = ReturnType<typeof createSidepanelRuntime>;

/**
 * Creates side panel actions over chrome.runtime messaging.
 */
export const createSidepanelRuntime = (runtime?: RuntimeApi) => {
  const sendMessage = async (message: unknown): Promise<unknown> => runtime?.sendMessage(message);

  return {
    ...createLedgerRuntimeClient(sendMessage),
    ...createNftRuntimeClient(sendMessage),
    async addToken(address: string): Promise<void> {
      const response = await sendMessage({ address, type: "wallet.addToken" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "add token failed");
    },
    async addAccount(networkId: string): Promise<string> {
      const response = await sendMessage({ networkId, type: "wallet.addAccount" });
      if (isCreateAccountResponse(response)) {
        // Surface the created account's id so the caller can file it into the
        // focused group (the background already returns the account here).
        return response.account.id;
      }
      throw responseError(response, "add account failed");
    },
    async importAccount(networkId: string, privateKey: string): Promise<string> {
      const response = await sendMessage({ networkId, privateKey, type: "wallet.importAccount" });
      if (isCreateAccountResponse(response)) {
        // Surface the imported account's id so the caller can select it, mirroring
        // addAccount. The raw key travels only in this privileged request and is
        // never echoed back in the response.
        return response.account.id;
      }
      throw responseError(response, "import account failed");
    },
    async createAccount(
      mnemonic: string,
      networkId: string,
      vaultPassphrase: string,
    ): Promise<void> {
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
    async deployAccount(): Promise<string> {
      const response = await sendMessage({ type: "wallet.deployAccount" });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "deployment failed");
    },
    async loadDeploymentStatus(): Promise<DeploymentStatusResponse | null> {
      const response = await sendMessage({ type: "wallet.deploymentStatus" });
      return isDeploymentStatusResponse(response) ? response : null;
    },
    async loadClassHashVerification(): Promise<ClassHashVerificationResponse | null> {
      // Return the whole response (with its `accountId`), not just the verdict,
      // so the caller can drop a verification that resolved for an account the
      // user has since switched away from — a stale/foreign verdict must never
      // be shown under a different account's class hash.
      const response = await sendMessage({ type: "wallet.verifyClassHash" });
      return isClassHashVerificationResponse(response) ? response : null;
    },
    async decideApproval(id: string, approved: boolean): Promise<void> {
      const response = await sendMessage({
        id,
        type: approved ? "wallet.approveOrigin" : "wallet.denyOrigin",
      });
      if (isApprovalDecisionResponse(response)) {
        return;
      }
      throw responseError(response, "approval failed");
    },
    async connectedSites(): Promise<ConnectedSitesResponse["sites"]> {
      const response = await sendMessage({ type: "wallet.connectedSites" });
      return isConnectedSitesResponse(response) ? response.sites : [];
    },
    async revokeOrigin(origin: string): Promise<ConnectedSitesResponse["sites"]> {
      const response = await sendMessage({ origin, type: "wallet.revokeOrigin" });
      if (isConnectedSitesResponse(response)) {
        return response.sites;
      }
      throw responseError(response, "revoke failed");
    },
    async generateMnemonic(): Promise<string> {
      const response = await sendMessage({ type: "wallet.generateMnemonic" });
      if (isGenerateMnemonicResponse(response)) {
        return response.mnemonic;
      }
      throw responseError(response, "wallet unavailable");
    },
    async revealSecrets(vaultPassphrase: string): Promise<RevealSecretsResponse> {
      const response = await sendMessage({ type: "wallet.revealSecrets", vaultPassphrase });
      if (isRevealSecretsResponse(response)) {
        return response;
      }
      throw responseError(response, "reveal failed");
    },
    async loadActivity(): Promise<{
      readonly entries: ActivityResponse["activity"];
      readonly historyUnavailable: boolean;
    }> {
      const response = await sendMessage({ type: "wallet.activity" });
      if (!isActivityResponse(response)) {
        return { entries: [], historyUnavailable: false };
      }
      return {
        entries: response.activity,
        historyUnavailable: response.historyUnavailable ?? false,
      };
    },
    async loadAllowances(): Promise<AllowancesResponse["allowances"]> {
      const response = await sendMessage({ type: "wallet.allowances" });
      return isAllowancesResponse(response) ? response.allowances : [];
    },
    async revokeAllowance(id: string): Promise<string> {
      const response = await sendMessage({ id, type: "wallet.revokeAllowance" });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "revoke failed");
    },
    async reviewTransfer(
      accountId: string,
      tokenId: string,
      recipient: string,
      amount: string,
    ): Promise<TransferReviewResponse["review"]> {
      const response = await sendMessage({
        accountId,
        amount,
        recipient,
        tokenId,
        type: "wallet.reviewTransfer",
      });
      if (isTransferReviewResponse(response)) {
        return response.review;
      }
      throw responseError(response, "transfer review failed");
    },
    async loadBalances(): Promise<BalanceState> {
      const response = await sendMessage({ type: "wallet.getBalances" });
      if (isBalancesResponse(response)) {
        return { balances: response.balances };
      }
      return { error: isErrorResponse(response) ? response.error : "balances unavailable" };
    },
    async detectTokens(): Promise<readonly TokenBalance[]> {
      const response = await sendMessage({ type: "wallet.detectTokens" });
      if (isDetectTokensResponse(response)) {
        return response.suggestions;
      }
      throw responseError(response, "token detection failed");
    },
    async loadPrices(): Promise<{
      readonly asOf: number | null;
      readonly changes: Readonly<Record<string, number>>;
      readonly prices: Readonly<Record<string, number>>;
      readonly stale: boolean;
    }> {
      const response = await sendMessage({ type: "wallet.prices" });
      if (!isPricesResponse(response)) {
        return { asOf: null, changes: {}, prices: {}, stale: false };
      }
      return {
        asOf: response.asOf ?? null,
        changes: response.changes ?? {},
        prices: response.prices,
        stale: response.stale ?? false,
      };
    },
    async loadTokenChart(address: string): Promise<readonly number[]> {
      const response = await sendMessage({ address, type: "wallet.tokenChart" });
      return isTokenChartResponse(response) ? response.points : [];
    },
    async setTokenHidden(tokenId: string, hidden: boolean): Promise<void> {
      const response = await sendMessage({ hidden, tokenId, type: "wallet.setTokenHidden" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "token visibility update failed");
    },
    async loadPendingApprovals(): Promise<readonly PendingApproval[]> {
      const response = await sendMessage({ type: "wallet.pendingApprovals" });
      return isPendingApprovalsResponse(response) ? response.pending : [];
    },
    async loadPreferences() {
      const response = await sendMessage({ type: "wallet.preferences" });
      if (isPreferencesResponse(response)) {
        return response.preferences;
      }
      throw responseError(response, "preferences unavailable");
    },
    async loadStatus(): Promise<WalletStatus> {
      const response = await sendMessage({ type: "wallet.status" });
      return isWalletStatus(response) ? response : emptyStatus();
    },
    async lockVault(): Promise<WalletStatus> {
      const response = await sendMessage({ type: "wallet.lock" });
      if (isWalletStatus(response)) {
        return response;
      }
      throw responseError(response, "wallet unavailable");
    },
    async saveAddress(label: string, address: string, networkId: string): Promise<void> {
      const response = await sendMessage({ address, label, networkId, type: "wallet.saveAddress" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "address save failed");
    },
    async setActiveAccount(accountId: string): Promise<void> {
      const response = await sendMessage({ accountId, type: "wallet.setActiveAccount" });
      if (isCreateAccountResponse(response)) {
        return;
      }
      throw responseError(response, "account switch failed");
    },
    async importPreferences(preferences: unknown): Promise<void> {
      const response = await sendMessage({ preferences, type: "wallet.importPreferences" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "backup import failed");
    },
    async removeAddress(id: string): Promise<void> {
      const response = await sendMessage({ id, type: "wallet.removeAddress" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "address removal failed");
    },
    async setAccountLabel(accountId: string, label: string): Promise<void> {
      const response = await sendMessage({ accountId, label, type: "wallet.setAccountLabel" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "label update failed");
    },
    async createGroup(name: string, icon: AccountGroupIcon): Promise<string> {
      const response = await sendMessage({ icon, name, type: "wallet.createGroup" });
      if (isPreferencesResponse(response)) {
        // The pure model appends the new group last with a deterministic id, so
        // the final entry is the one just created — return its id so the caller
        // can open its members editor.
        const groups = response.preferences.groups ?? [];
        const created = groups[groups.length - 1];
        if (created) {
          return created.id;
        }
      }
      throw responseError(response, "group create failed");
    },
    async renameGroup(id: string, name: string): Promise<void> {
      const response = await sendMessage({ id, name, type: "wallet.renameGroup" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "group rename failed");
    },
    async setGroupIcon(id: string, icon: AccountGroupIcon): Promise<void> {
      const response = await sendMessage({ icon, id, type: "wallet.setGroupIcon" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "group icon update failed");
    },
    async removeGroup(id: string): Promise<void> {
      const response = await sendMessage({ id, type: "wallet.removeGroup" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "group remove failed");
    },
    async setAccountInGroup(accountId: string, groupId: string, member: boolean): Promise<void> {
      const response = await sendMessage({
        accountId,
        groupId,
        member,
        type: "wallet.setAccountInGroup",
      });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "group membership update failed");
    },
    async setDisplay(input: {
      readonly approvalSurface?: "popup" | "side-panel";
      readonly displayCurrency?: "eur" | "gbp" | "usd";
      readonly theme?: "dark" | "light";
    }): Promise<void> {
      const response = await sendMessage({ ...input, type: "wallet.setDisplay" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "display update failed");
    },
    async setRpcOverride(networkId: string, rpcUrl: string): Promise<void> {
      const response = await sendMessage({ networkId, rpcUrl, type: "wallet.setRpcOverride" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "rpc endpoint update failed");
    },
    async setStrk20NetworkConfig(
      networkId: string,
      config: Strk20NetworkConfig | null,
    ): Promise<void> {
      const response = await sendMessage({
        config,
        networkId,
        type: "wallet.setStrk20NetworkConfig",
      });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "privacy service configuration failed");
    },
    async setActiveNetwork(networkId: string): Promise<WalletStatus> {
      const response = await sendMessage({ networkId, type: "wallet.setActiveNetwork" });
      if (isWalletStatus(response)) {
        return response;
      }
      throw responseError(response, "network switch failed");
    },
    async submitTransfer(
      accountId: string,
      tokenId: string,
      recipient: string,
      amount: string,
      speed: "fast" | "standard" = "standard",
    ): Promise<string> {
      const response = await sendMessage({
        accountId,
        amount,
        recipient,
        speed,
        tokenId,
        type: "wallet.transfer",
      });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "transfer failed");
    },
    async unlockVault(vaultPassphrase: string): Promise<WalletStatus> {
      const response = await sendMessage({ type: "wallet.unlock", vaultPassphrase });
      if (isWalletStatus(response)) {
        return response;
      }
      throw responseError(response, "Incorrect passphrase");
    },
  };
};
