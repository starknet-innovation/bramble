/** Nostr coordination relay preference mutation. */
import { WalletError } from "@mc-wallet/core/errors";
import { isNostrRelayUrl } from "@mc-wallet/wallet-model/nostr";
import type { WalletPreferences } from "./preferences-types";

/** Returns preferences with a validated custom relay, or the reviewed defaults restored. */
export const withNostrRelayUrl = (
  preferences: WalletPreferences,
  relayUrl: string,
): WalletPreferences => {
  const trimmed = relayUrl.trim();
  if (trimmed.length > 0 && !isNostrRelayUrl(trimmed)) {
    throw new WalletError("Invalid Nostr relay endpoint");
  }
  const next = { ...preferences };
  if (trimmed.length === 0) {
    delete (next as { nostrRelayUrl?: string }).nostrRelayUrl;
  } else {
    (next as { nostrRelayUrl?: string }).nostrRelayUrl = trimmed;
  }
  return next;
};
