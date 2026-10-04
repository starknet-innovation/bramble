/**
 * Typed runtime message client for the side panel UI.
 */

import type { Strk20NetworkConfig } from "@bramble/privacy/config";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { isNostrPublicKeyResponse, isOkResponse } from "../../popup/responses/multisig-responses";
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
  isFeeReviewResponse,
  isPreferencesResponse,
  isPricesResponse,
  isRevealSecretsResponse,
  isSupportDiagnosticsResponse,
  isTokenChartResponse,
  isTransactionAlertsResponse,
  isTransferResponse,
  isTransferReviewResponse,
  isWalletStatus,
  type PendingApproval,
  type RevealSecretsResponse,
  readPendingApprovals,
  type TokenBalance,
  type TransferReviewResponse,
  type WalletStatus,
} from "../../popup/responses/responses";
import { createNftRuntimeClient } from "../journeys/collectibles/nft-runtime";
import { createLedgerRuntimeClient } from "../journeys/ledger/runtime-client";
import { createOnboardingRuntimeClient } from "../journeys/onboarding/onboarding-runtime";
import { createPrivacyRuntimeClient } from "../journeys/privacy/privacy-runtime";
import type { RuntimeApi, ScopedBalanceState } from "./runtime-types";

/**
 * The pre-load placeholder status, re-exported here so the panel keeps one
 * import surface for the runtime client and the statuses it paints.
 */
export { emptyStatus } from "./runtime-status";
/** Shared runtime boundary and loading-state types. */
export type {
  BalanceState,
  RuntimeApi,
  RuntimeMessageSender,
  ScopedBalanceState,
} from "./runtime-types";

import { createAccountRuntimeClient } from "./runtime-accounts";
import { responseError } from "./runtime-errors";
import { createAccountGroupClient } from "./runtime-groups";
import { unavailableStatus } from "./runtime-status";

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
    ...createOnboardingRuntimeClient(sendMessage),
    ...createPrivacyRuntimeClient(sendMessage),
    ...createAccountRuntimeClient(sendMessage),
    async addToken(address: string): Promise<void> {
      const response = await sendMessage({ address, type: "wallet.addToken" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "add token failed");
    },
    async deployAccount(reviewedFee?: FeeEstimate): Promise<FeeEstimate | string> {
      const response = await sendMessage({
        ...(reviewedFee ? { reviewedFee } : {}),
        type: "wallet.deployAccount",
      });
      if (isFeeReviewResponse(response)) return response.feeReview;
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
    /**
     * Settles a pending approval. `reviewedFee` is the figure the deciding card
     * was displaying; it travels only with an approval, and the background
     * refuses rather than substituting if its own copy has moved since — which
     * is what stops a stale card consenting to an unseen fee. A card that
     * showed no fee sends none and the submission stays unbound.
     */
    async decideApproval(
      id: string,
      approved: boolean,
      reviewedFee?: PendingApproval["fee"],
      reviewedAccountId?: string,
    ): Promise<void> {
      const response = await sendMessage({
        id,
        ...(approved && reviewedAccountId ? { reviewedAccountId } : {}),
        ...(approved && reviewedFee ? { reviewedFee } : {}),
        type: approved ? "wallet.approveOrigin" : "wallet.denyOrigin",
      });
      if (isApprovalDecisionResponse(response)) {
        return;
      }
      throw responseError(response, "approval failed");
    },
    async retryApprovalFee(id: string): Promise<void> {
      const response = await sendMessage({ id, type: "wallet.retryApprovalFee" });
      if (isOkResponse(response)) {
        return;
      }
      throw responseError(response, "fee estimate failed");
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
    async revealSecrets(vaultPassphrase: string): Promise<RevealSecretsResponse> {
      const response = await sendMessage({ type: "wallet.revealSecrets", vaultPassphrase });
      if (isRevealSecretsResponse(response)) {
        return response;
      }
      throw responseError(response, "reveal failed");
    },
    async loadActivity(
      accountId?: string,
      cached = false,
      refreshHistory = false,
      forceHistory = false,
    ): Promise<{
      readonly entries: ActivityResponse["activity"];
      readonly historyUnavailable: boolean;
    }> {
      const response = await sendMessage({
        ...(accountId === undefined ? {} : { accountId }),
        ...(cached ? { cached: true } : {}),
        ...(refreshHistory || forceHistory ? { refreshHistory: true } : {}),
        ...(forceHistory ? { forceHistory: true } : {}),
        type: "wallet.activity",
      });
      if (!isActivityResponse(response)) {
        return { entries: [], historyUnavailable: true };
      }
      return {
        entries: response.activity,
        historyUnavailable: response.historyUnavailable ?? false,
      };
    },
    /**
     * Drains the transaction failure notices background reconciliation
     * recorded, including any raised while this panel was closed. The
     * background hands each notice out once, so this is safe to call on every
     * refresh; an unavailable background yields no notices rather than an error.
     */
    async loadTransactionAlerts(): Promise<readonly string[]> {
      const response = await sendMessage({ type: "wallet.transactionAlerts" });
      return isTransactionAlertsResponse(response) ? response.alerts : [];
    },
    async loadAllowances(): Promise<AllowancesResponse["allowances"]> {
      const response = await sendMessage({ type: "wallet.allowances" });
      return isAllowancesResponse(response) ? response.allowances : [];
    },
    async revokeAllowance(id: string, reviewedFee?: FeeEstimate): Promise<FeeEstimate | string> {
      const response = await sendMessage({
        id,
        ...(reviewedFee ? { reviewedFee } : {}),
        type: "wallet.revokeAllowance",
      });
      if (isFeeReviewResponse(response)) return response.feeReview;
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
      // The speed the send would use. Carried into the review because a `fast`
      // send signs scaled-up bounds, so the fee it authorises is not the fee a
      // standard review would have shown — and that reviewed figure is the
      // ceiling the send is then held to.
      speed: "fast" | "standard" = "standard",
    ): Promise<TransferReviewResponse["review"]> {
      const response = await sendMessage({
        accountId,
        amount,
        recipient,
        speed,
        tokenId,
        type: "wallet.reviewTransfer",
      });
      if (isTransferReviewResponse(response)) {
        return response.review;
      }
      throw responseError(response, "transfer review failed");
    },
    async loadBalances(cached = false, refresh = false): Promise<ScopedBalanceState> {
      const response = await sendMessage({
        ...(cached ? { cached: true } : {}),
        ...(refresh ? { refresh: true } : {}),
        type: "wallet.getBalances",
      });
      if (isBalancesResponse(response)) {
        return {
          accountId: response.accountId,
          ...(response.asOf === undefined ? {} : { asOf: response.asOf }),
          balances: response.balances,
          networkId: response.networkId,
          ...(response.stale === undefined ? {} : { stale: response.stale }),
        };
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
    async loadPrices(cached = false): Promise<{
      readonly asOf: number | null;
      readonly changes: Readonly<Record<string, number>>;
      readonly prices: Readonly<Record<string, number>>;
      readonly stale: boolean;
    }> {
      const response = await sendMessage({
        ...(cached ? { cached: true } : {}),
        type: "wallet.prices",
      });
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
    async removeToken(tokenId: string): Promise<void> {
      const response = await sendMessage({ tokenId, type: "wallet.removeToken" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "remove token failed");
    },
    async loadPendingApprovals(): Promise<readonly PendingApproval[]> {
      // Per-entry: one malformed prompt must not blank the queue (MCW-V09-106).
      return readPendingApprovals(await sendMessage({ type: "wallet.pendingApprovals" })) ?? [];
    },
    async loadNostrPublicKey(): Promise<string> {
      const response = await sendMessage({ type: "wallet.nostrPublicKey" });
      if (isNostrPublicKeyResponse(response)) return response.nostrPublicKey;
      throw responseError(response, "coordination identity unavailable");
    },
    async loadPreferences() {
      const response = await sendMessage({ type: "wallet.preferences" });
      if (isPreferencesResponse(response)) {
        return response.preferences;
      }
      throw responseError(response, "preferences unavailable");
    },
    /**
     * Reads wallet status, or the fail-closed {@link unavailableStatus} when the
     * background does not answer with one. A failure is never reported as "this
     * browser has no wallet": that rendered the first-run screen to a user whose
     * vault was merely unreadable, inviting them to set a new wallet up over it.
     */
    async loadStatus(): Promise<WalletStatus> {
      const response = await sendMessage({ type: "wallet.status" }).catch(() => null);
      return isWalletStatus(response) ? response : unavailableStatus();
    },
    async lockVault(): Promise<WalletStatus> {
      const response = await sendMessage({ type: "wallet.lock" });
      if (isWalletStatus(response)) {
        return response;
      }
      throw responseError(response, "wallet unavailable");
    },
    async saveAddress(
      label: string,
      address: string,
      networkId: string,
      publicKeyX?: string,
      nostrPublicKey?: string,
    ): Promise<void> {
      const response = await sendMessage({
        address,
        label,
        networkId,
        ...(nostrPublicKey ? { nostrPublicKey } : {}),
        ...(publicKeyX ? { publicKeyX } : {}),
        type: "wallet.saveAddress",
      });
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
    ...createAccountGroupClient(sendMessage),
    async setDisplay(input: {
      readonly approvalSurface?: "popup" | "side-panel";
      readonly displayCurrency?: "eur" | "gbp" | "usd";
      readonly productAnalytics?: boolean;
      readonly reliabilityDiagnostics?: boolean;
      readonly theme?: "dark" | "light";
    }): Promise<void> {
      const response = await sendMessage({ ...input, type: "wallet.setDisplay" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "display update failed");
    },
    async loadDiagnostics() {
      const response = await sendMessage({ type: "wallet.diagnostics" });
      if (isSupportDiagnosticsResponse(response)) return response.diagnostics;
      throw responseError(response, "diagnostic export failed");
    },
    async setExplorerFallback(networkId: string, enabled: boolean, apiUrl?: string): Promise<void> {
      const response = await sendMessage({
        ...(apiUrl === undefined ? {} : { apiUrl }),
        enabled,
        networkId,
        type: "wallet.setExplorerFallback",
      });
      if (isPreferencesResponse(response)) return;
      throw responseError(response, "explorer fallback update failed");
    },
    async setRpcOverride(networkId: string, rpcUrl: string): Promise<void> {
      const response = await sendMessage({ networkId, rpcUrl, type: "wallet.setRpcOverride" });
      if (isPreferencesResponse(response)) {
        return;
      }
      throw responseError(response, "rpc endpoint update failed");
    },
    async setNostrRelayUrl(relayUrl: string): Promise<void> {
      const response = await sendMessage({ relayUrl, type: "wallet.setNostrRelayUrl" });
      if (isPreferencesResponse(response)) return;
      throw responseError(response, "Nostr relay update failed");
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
    /**
     * Sends under the exact invoke and optional deployment fees displayed by
     * the review. A missing required ceiling is refused before signing.
     */
    async submitTransfer(
      accountId: string,
      tokenId: string,
      recipient: string,
      amount: string,
      speed: "fast" | "standard" = "standard",
      reviewedFee: TransferReviewResponse["review"]["fee"] = null,
      reviewedDeploymentFee: TransferReviewResponse["review"]["deploymentFee"] = null,
    ): Promise<string> {
      const response = await sendMessage({
        accountId,
        amount,
        recipient,
        ...(reviewedDeploymentFee == null ? {} : { reviewedDeploymentFee }),
        ...(reviewedFee === null ? {} : { reviewedFee }),
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
    /**
     * Archives the locked vault and clears the live copy so the next start is
     * first-run. Sends no passphrase: the privileged background message is the
     * route for a user who cannot open the vault.
     */
    async resetVault(): Promise<void> {
      const response = await sendMessage({ type: "wallet.resetVault" });
      if (!isErrorResponse(response)) {
        return;
      }
      throw responseError(response, "Reinitialize failed");
    },
  };
};
