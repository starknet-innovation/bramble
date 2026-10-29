/**
 * Side-panel client for preference and network settings: the address book,
 * account labels, display choices, explorer and RPC overrides, and the active
 * network. Split out of `runtime.ts` so that file stays within the size
 * budget. The methods are spread back into the one client object the panel
 * uses, so callers see no seam.
 *
 * A rejected or malformed reply throws rather than being treated as a silent
 * success. The background re-validates every field; this client only checks
 * that the reply has the shape the screen is allowed to trust.
 */

import type { Strk20NetworkConfig } from "@bramble/privacy/config";
import {
  isCreateAccountResponse,
  isPreferencesResponse,
  isSupportDiagnosticsResponse,
  isWalletStatus,
  type WalletStatus,
} from "../../popup/responses/responses";
import { responseError } from "./runtime-errors";

/**
 * Creates the settings half of the side-panel wallet client over the panel's
 * own message transport.
 */
export const createSettingsRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
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
});
