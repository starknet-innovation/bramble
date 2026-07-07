/**
 * Typed runtime message client for the side panel UI.
 */
import {
  type ActivityResponse,
  type AllowancesResponse,
  type ConnectedSitesResponse,
  type DeploymentStatusResponse,
  isActivityResponse,
  isAllowancesResponse,
  isApprovalDecisionResponse,
  isBalancesResponse,
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
    async addToken(address: string): Promise<void> {
      const response = await sendMessage({ address, type: "wallet.addToken" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "add token failed");
    },
    async addAccount(networkId: string): Promise<void> {
      const response = await sendMessage({ networkId, type: "wallet.addAccount" });
      if (isCreateAccountResponse(response)) {
        return;
      }
      throw responseError(response, "add account failed");
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
    async loadActivity(): Promise<ActivityResponse["activity"]> {
      const response = await sendMessage({ type: "wallet.activity" });
      return isActivityResponse(response) ? response.activity : [];
    },
    async addNft(
      contract: string,
      tokenId: string,
      networkId: string,
      label: string,
    ): Promise<void> {
      const response = await sendMessage({
        contract,
        ...(label ? { label } : {}),
        networkId,
        tokenId,
        type: "wallet.addNft",
      });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "add NFT failed");
    },
    async loadAllowances(): Promise<AllowancesResponse["allowances"]> {
      const response = await sendMessage({ type: "wallet.allowances" });
      return isAllowancesResponse(response) ? response.allowances : [];
    },
    async removeNft(id: string): Promise<void> {
      const response = await sendMessage({ id, type: "wallet.removeNft" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "remove NFT failed");
    },
    async revokeAllowance(id: string): Promise<string> {
      const response = await sendMessage({ id, type: "wallet.revokeAllowance" });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "revoke failed");
    },
    async setNftSpam(id: string, spam: boolean): Promise<void> {
      const response = await sendMessage({ id, spam, type: "wallet.setNftSpam" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "NFT update failed");
    },
    async transferNft(
      contract: string,
      tokenId: string,
      networkId: string,
      recipient: string,
    ): Promise<string> {
      const response = await sendMessage({
        contract,
        networkId,
        recipient,
        tokenId,
        type: "wallet.transferNft",
      });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "NFT transfer failed");
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
      readonly changes: Readonly<Record<string, number>>;
      readonly prices: Readonly<Record<string, number>>;
    }> {
      const response = await sendMessage({ type: "wallet.prices" });
      if (!isPricesResponse(response)) {
        return { changes: {}, prices: {} };
      }
      return { changes: response.changes ?? {}, prices: response.prices };
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
    async setDisplay(input: {
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
      throw responseError(response, "wallet unavailable");
    },
  };
};
