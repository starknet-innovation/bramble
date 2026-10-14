/** Atomic explorer endpoint and disclosure-preference mutation. */
import { WalletError } from "@bramble/core/errors";
import { isEnteredServiceUrl } from "@bramble/core/service-url";
import { isStarknetNetworkId } from "@bramble/wallet-model/networks";
import type { WalletPreferences } from "./preferences-types";

/** Returns preferences with one network's explorer API and fallback consent updated together. */
export const withExplorerSettings = (
  preferences: WalletPreferences,
  input: { readonly apiUrl?: string; readonly enabled: boolean; readonly networkId: string },
): WalletPreferences => {
  if (!isStarknetNetworkId(input.networkId)) throw new WalletError("Invalid Starknet network");
  const explorerApiUrls = { ...preferences.explorerApiUrls };
  if (input.apiUrl !== undefined) {
    const apiUrl = input.apiUrl.trim();
    if (apiUrl && !isEnteredServiceUrl(apiUrl))
      throw new WalletError("Invalid explorer API endpoint");
    if (apiUrl) explorerApiUrls[input.networkId] = apiUrl;
    else delete explorerApiUrls[input.networkId];
  }
  return {
    ...preferences,
    explorerApiUrls,
    explorerFallback: { ...preferences.explorerFallback, [input.networkId]: input.enabled },
  };
};
