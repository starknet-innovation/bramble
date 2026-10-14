/**
 * Home portfolio composition: public/private totals, primary actions, and the
 * token list. Kept separate from the screen router so adding a
 * portfolio state cannot push routing back over the repository size limit.
 */

import { escapeHtml } from "@bramble/core/html";
import type { DisplayCurrency, WalletPreferences } from "@bramble/settings/preferences";
import { type AccountRef, isKeylessAccount } from "@bramble/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { SignabilityVerdict, WalletStatus } from "../../../popup/responses/responses";
import type { BalanceState } from "../../runtime/runtime";

/**
 * Whether the loaded public balances can pay a deployment fee.
 * `null` means unknown: the balance read has not succeeded, or it holds no
 * STRK reading (STRK untracked or not read yet). Only a STRK balance actually
 * read as zero is `false`, so "add STRK" is never said over an unknown
 * balance (audit L4).
 */
export const strkAvailableForFees = (balances: BalanceState): boolean | null => {
  if (!("balances" in balances)) return null;
  const strk = balances.balances.find((token) => sameFelt(token.address, STRK_TOKEN_ADDRESS));
  return strk === undefined || strk.formatted === "" ? null : BigInt(strk.balance) > 0n;
};

import { formatFiat, portfolioTotal } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { dockScreen, noAccountEmpty } from "../../shared/parts";
import { actionTile, pendingCallout, shieldTile } from "../../shell/wallet-shell";
import { deploymentKnownFromPrivacy, type PrivacyDisclosureState } from "../privacy/privacy-model";
import { heroChange } from "./hero-change";
import { homeTabs, unifiedHomeBalances, visiblePrivateHomeBalances } from "./home-tabs";
import { readOnlyNotice } from "./recovery-view";

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
  signability: SignabilityVerdict | null = null,
): string => {
  // Read-only until proven otherwise never — the flag is advisory UX; the
  // transaction path enforces. Null (unknown) renders as a normal account.
  const readOnly = signability?.readOnly === true;
  // An undeployed Braavos account can still reach Shield's deploy-first step.
  const shieldReadOnly = readOnly && signability.reason !== "undeployed";
  const unified = unifiedHomeBalances(balances, privacy, preferences);
  const shieldedIncluded = visiblePrivateHomeBalances(privacy, preferences).some(
    (token) => BigInt(token.balance) > 0n,
  );
  const fundedForFees = strkAvailableForFees(balances);
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
      ${showTotal ? heroChange(unified, prices, changes, currency) : ""}
      ${shieldedIncluded ? `<p class="hero-stale">${icon("lock")}<span>Includes shielded balances</span></p>` : ""}
      ${readOnly ? readOnlyNotice(signability, account !== null && isKeylessAccount(account)) : ""}
      ${account ? "" : noAccountEmpty(status)}
    </section>
    <section class="home-actions" aria-label="Wallet actions">
      <div class="action-row">
        ${actionTile("send", "Send", "send", account !== null && !readOnly)}
        ${actionTile("swap", "Swap", "shuffle", account !== null && !readOnly)}
        ${actionTile("receive", "Receive", "qrCode", account !== null)}
        ${shieldTile(
          strkTokenId,
          privateReady,
          deploymentKnownFromPrivacy(deployment, privacy),
          fundedForFees,
          shieldReadOnly,
        )}
      </div>
    </section>
    ${homeTabs(balances, preferences, prices, changes, currency, privacy, deployment, fundedForFees)}`,
  );
};
