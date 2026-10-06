/**
 * Home portfolio composition: public/private totals, primary actions, and the
 * token list. Kept separate from the screen router so adding a
 * portfolio state cannot push routing back over the repository size limit.
 */

import { escapeHtml } from "@bramble/core/html";
import type { DisplayCurrency, WalletPreferences } from "@bramble/settings/preferences";
import { UNDEPLOYED_BRAAVOS_REFUSAL } from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type {
  SignabilityVerdict,
  TokenBalance,
  WalletStatus,
} from "../../../popup/responses/responses";
import type { BalanceState } from "../../runtime/runtime";

/**
 * Whether the loaded public balances can pay a deployment fee.
 * `null` means the balance read has not succeeded, which is not the same as
 * a successful read that found no STRK.
 */
export const strkAvailableForFees = (balances: BalanceState): boolean | null =>
  "balances" in balances
    ? balances.balances.some(
        (token) => sameFelt(token.address, STRK_TOKEN_ADDRESS) && BigInt(token.balance) > 0n,
      )
    : null;

import { formatFiat, portfolioDelta, portfolioTotal } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { dockScreen, noAccountEmpty } from "../../shared/parts";
import { actionTile, pendingCallout, shieldTile } from "../../shell/wallet-shell";
import { deploymentKnownFromPrivacy, type PrivacyDisclosureState } from "../privacy/privacy-model";
import { homeTabs, unifiedHomeBalances, visiblePrivateHomeBalances } from "./home-tabs";

// Whole days a delay spans, for the recovery copy. Takes the delay it is
// given, so the pure render layer never reads the wall clock.
/**
 * Formats a unix-seconds instant as "DD/MM/YY at HHhMM UTC" with pure integer
 * civil-from-epoch arithmetic (Hinnant's algorithm), so the render layer reads
 * no wall clock — it only formats the value it is given.
 */
const formatUtcInstant = (epochSeconds: number): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const days = Math.floor(epochSeconds / 86_400);
  const secondOfDay = epochSeconds - days * 86_400;
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  const hour = Math.floor(secondOfDay / 3600);
  const minute = Math.floor((secondOfDay % 3600) / 60);
  return `${pad(day)}/${pad(month)}/${pad(year % 100)} at ${pad(hour)}h${pad(minute)} UTC`;
};

/**
 * The read-only notice under the total. Always says "Read only" and keeps the
 * money actions greyed; a phrase-recoverable account (Braavos 2FA) adds a
 * "Recover account" button, and once a removal is under way it states the
 * delay and that the 2FA device can still stop it.
 */
const readOnlyNotice = (signability: SignabilityVerdict | null): string => {
  if (signability?.readOnly !== true) return "";
  // Not read only: it signs once deployed, which is its own reviewed step.
  if (signability.reason === "undeployed") {
    return `<div class="read-only-notice" data-read-only="undeployed">
      <p class="hero-stale">${icon("rocket")}<span>Not deployed</span></p>
      <p class="read-only-detail">${escapeHtml(UNDEPLOYED_BRAAVOS_REFUSAL)}</p>
    </div>`;
  }
  const recovery = "recovery" in signability ? signability.recovery : undefined;
  // Ready's guardian escape is a two-step removal that needs a second signed
  // call once the delay passes; Braavos' 2FA removal applies itself at expiry.
  const kind = signability.reason === "guardian" ? "argent" : "braavos";
  const recoverable = signability.reason === "strong-signer" || signability.reason === "guardian";
  const noun = kind === "argent" ? "the guardian" : "2FA";
  const stopper = kind === "argent" ? "Your guardian" : "Your Braavos device";
  const pendingUntil = recovery?.pendingUntil ?? null;
  const stage = recovery && "stage" in recovery ? recovery.stage : undefined;
  const recoverButton = (label: string): string =>
    `<button class="button button-secondary" id="recover-account" type="button" data-recover-kind="${kind}">${label}</button>`;
  // Ready, delay elapsed: offer the second step. Otherwise a running removal
  // shows its unlock time, and a fresh account offers the first step.
  const body =
    stage === "ready"
      ? recoverButton("Complete recovery")
      : pendingUntil !== null
        ? `<p class="read-only-detail">Removing ${noun} — usable on ${escapeHtml(
            formatUtcInstant(pendingUntil),
          )}. ${stopper} can still stop this.</p>`
        : recoverable
          ? recoverButton("Recover account")
          : "";
  return `<div class="read-only-notice" data-read-only="true">
      <p class="hero-stale">${icon("eye")}<span>Read only</span></p>
      ${body}
    </div>`;
};

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
      ${showTotal ? heroDelta(unified, prices, changes, currency) : ""}
      ${shieldedIncluded ? `<p class="hero-stale">${icon("lock")}<span>Includes shielded balances</span></p>` : ""}
      ${readOnly ? readOnlyNotice(signability) : ""}
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
