/**
 * Compact network-freshness copy for the persistent wallet header. Dynamic
 * RPC and cache state is reduced to display-safe text; raw errors never cross
 * this presentation boundary.
 */

import type { AccountRef } from "@bramble/wallet-model/accounts";
import { PRIVACY_OTHER_WALLET } from "@bramble/wallet-protocol/privacy-blocker";
import type { WalletStatus } from "../../popup/responses/responses";
import type { PrivacyDisclosureState } from "../journeys/privacy/privacy-model";
import type { BalanceState } from "../runtime/runtime";
import { formatSavedDataLabel } from "./fiat";
import type { WalletView } from "./parts";

/**
 * Returns public-data freshness details, or an empty list when data is current.
 */
export const networkDataIssue = (
  balances: BalanceState,
  priceStale: boolean,
  priceAsOf: number | null,
  hasPrices: boolean,
): string[] => [
  // Not read yet is not unavailable: Home shows its loading shell instead (795).
  ...("loading" in balances
    ? []
    : "error" in balances
      ? ["Balances are temporarily unavailable."]
      : balances.stale
        ? [`Using saved ${formatSavedDataLabel("balances", balances.asOf ?? null)}.`]
        : []),
  ...(priceStale
    ? [
        hasPrices
          ? `Using saved ${formatSavedDataLabel("prices", priceAsOf)}.`
          : "Live prices are temporarily unavailable.",
      ]
    : []),
];

/**
 * Returns private-data freshness details only where private balances are shown.
 */
export const privacyDataIssue = (
  activeView: WalletView,
  account: AccountRef | null,
  status: WalletStatus,
  privacy: PrivacyDisclosureState,
  sharedAccount: boolean,
): string | null => {
  if (sharedAccount || activeView !== "home" || account === null) return null;
  if (privacy.blockerKind === "other-wallet") return PRIVACY_OTHER_WALLET;
  if (privacy.error) return "Private balances are temporarily unavailable.";
  return privacy.loading ||
    privacy.value === null ||
    privacy.value.accountId !== account.id ||
    privacy.value.networkId !== status.networkId
    ? "Private balances are still refreshing."
    : null;
};
