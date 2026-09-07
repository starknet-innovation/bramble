/**
 * Home portfolio composition: public/private totals, primary actions, and the
 * token list. Kept separate from the screen router so adding a
 * portfolio state cannot push routing back over the repository size limit.
 */

import { escapeHtml } from "@bramble/core/html";
import type { DisplayCurrency, WalletPreferences } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import type { BalanceState } from "../../runtime/runtime";
import { formatFiat, portfolioDelta, portfolioTotal } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { dockScreen, noAccountEmpty } from "../../shared/parts";
import { actionTile, deployNotice, pendingCallout, shieldTile } from "../../shell/wallet-shell";
import type { PrivacyDisclosureState } from "../privacy/privacy-model";
import { homeTabs, unifiedHomeBalances, visiblePrivateHomeBalances } from "./home-tabs";

const heroDelta = (
  balances: readonly TokenBalance[],
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
): string => {
  const delta = portfolioDelta(balances, prices, changes);
  if (delta === null) {
    return "";
  }
  const arrow = delta.direction === "up" ? "↑" : "↓";
  return `<p class="hero-change${delta.direction === "down" ? " down" : ""}">
      <span class="hero-change-amt">${arrow} ${escapeHtml(formatFiat(delta.absolute, currency))}</span>
      <span class="hero-change-win">${delta.percent.toFixed(2)}% · 24h</span>
    </p>`;
};

/**
 * Renders the account-scoped Home portfolio without the shared wallet shell.
 */
export const homeScreen = (
  status: WalletStatus,
  account: AccountRef | null,
  balances: BalanceState,
  pendingCount: number,
  deployment: boolean | null,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
  privacy: PrivacyDisclosureState,
): string => {
  const unified = unifiedHomeBalances(balances, privacy, preferences);
  const shieldedIncluded = visiblePrivateHomeBalances(privacy, preferences).some(
    (token) => BigInt(token.balance) > 0n,
  );
  // Fees are paid in STRK, and only a public balance can pay them: an
  // undeployed account cannot have shielded anything anyway.
  const fundedForFees = ("balances" in balances ? balances.balances : []).some(
    (token) => sameFelt(token.address, STRK_TOKEN_ADDRESS) && BigInt(token.balance) > 0n,
  );
  // STRK by choice: it is seeded on every network, so the tile has something to
  // name unless the user untracked it, and Send's asset picker stays enabled for
  // anything else. `privateReady` is the same gate
  // the token-detail actions use, so both surfaces agree on when shielding is
  // possible rather than each deciding for itself.
  const strkTokenId =
    preferences?.tokens.find(
      (token) =>
        token.networkId === status.networkId && sameFelt(token.address, STRK_TOKEN_ADDRESS),
    )?.id ?? null;
  const privateReady = privacy.value?.registration === "registered";
  const balancesComplete =
    "balances" in balances &&
    privacy.value !== null &&
    !privacy.loading &&
    privacy.error === null &&
    privacy.value.accountId === account?.id &&
    privacy.value.networkId === status.networkId;
  const showTotal = account !== null && "balances" in balances && Object.keys(prices).length > 0;
  const total = showTotal ? portfolioTotal(unified, prices) : 0;
  return dockScreen(
    "home",
    `${pendingCallout(pendingCount)}
    <section class="hero" data-live-group>
      <p class="hero-total" data-total-complete="${balancesComplete}" data-live-key="portfolio-total" data-live-value="${showTotal ? total : "unknown"}">${showTotal ? escapeHtml(formatFiat(total, currency)) : "—"}</p>
      ${showTotal ? heroDelta(unified, prices, changes, currency) : ""}
      ${shieldedIncluded ? `<p class="hero-stale">${icon("lock")}<span>Includes shielded balances</span></p>` : ""}
      ${account ? "" : noAccountEmpty(status)}
      ${deployNotice(account, deployment, fundedForFees)}
    </section>
    <section class="home-actions" aria-label="Wallet actions">
      <div class="action-row">
        ${actionTile("send", "Send", "send", account !== null)}
        ${actionTile("swap", "Swap", "shuffle", account !== null)}
        ${actionTile("receive", "Receive", "qrCode", account !== null)}
        ${shieldTile(strkTokenId, privateReady)}
      </div>
    </section>
    ${homeTabs(balances, preferences, prices, changes, currency, privacy)}`,
  );
};
