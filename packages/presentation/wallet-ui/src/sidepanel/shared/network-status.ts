/**
 * Compact network-freshness copy for the persistent wallet header. Dynamic
 * RPC and cache state is reduced to display-safe text; raw errors never cross
 * this presentation boundary.
 */

import type { AccountRef } from "@bramble/wallet-model/accounts";
import { PRIVACY_OTHER_WALLET } from "@bramble/wallet-protocol/privacy-blocker";
import { t } from "../../i18n/messages";
import type { WalletStatus } from "../../popup/responses/responses";
import type { PrivacyDisclosureState } from "../journeys/privacy/privacy-model";
import type { BalanceState } from "../runtime/runtime";
import { formatPriceTimestamp } from "./fiat";
import type { WalletView } from "./parts";

// "Using saved balances (12 Sep, 14:32 UTC).", or without the time when none was kept.
const savedLine = (kind: "balances" | "prices", asOf: number | null): string => {
  const time = formatPriceTimestamp(asOf);
  if (kind === "balances") {
    return time === null
      ? t("shell.data.savedBalances")
      : t("shell.data.savedBalancesAt", { time });
  }
  return time === null ? t("shell.data.savedPrices") : t("shell.data.savedPricesAt", { time });
};

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
      ? [t("shell.data.balancesUnavailable")]
      : balances.stale
        ? [savedLine("balances", balances.asOf ?? null)]
        : []),
  ...(priceStale
    ? [hasPrices ? savedLine("prices", priceAsOf) : t("shell.data.pricesUnavailable")]
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
  if (privacy.error) return t("shell.data.privateUnavailable");
  return privacy.loading ||
    privacy.value === null ||
    privacy.value.accountId !== account.id ||
    privacy.value.networkId !== status.networkId
    ? t("shell.data.privateRefreshing")
    : null;
};
