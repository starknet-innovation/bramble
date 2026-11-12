/**
 * Starknet VIP eligibility notice on Home (issue 688). Eligibility is decided
 * here, from the Home total the user already sees: no request is made and no
 * address, balance or verdict leaves the device.
 */

import { escapeHtml } from "@bramble/core/html";
import type { DisplayCurrency, WalletPreferences } from "@bramble/settings/preferences";
import { th } from "../../../i18n/messages";
import { icon } from "../../shared/icons";

/** The programme's published portfolio threshold, in US dollars. */
export const VIP_THRESHOLD_USD = 10_000;

/**
 * The VIP site. Bundled, never fetched, so no remote source can change where
 * the notice points. The notice only links to it.
 */
export const VIP_SITE_URL = "https://vip.starknet.io/";

/**
 * Whether the active account qualifies. Only a complete, priced total counts
 * (`showTotal` is the hero's own gate), so a partial or price-less figure never
 * raises the notice. The threshold is in dollars, so other display currencies
 * never qualify rather than compare against a converted guess.
 */
export const vipEligible = (input: {
  readonly currency: DisplayCurrency;
  readonly preferences: WalletPreferences | null;
  readonly showTotal: boolean;
  readonly total: number;
}): boolean =>
  input.showTotal &&
  input.currency === "usd" &&
  input.preferences?.vipNotice !== false &&
  Number.isFinite(input.total) &&
  input.total >= VIP_THRESHOLD_USD;

/**
 * Renders the notice, or nothing when not eligible or no https site address is
 * bundled. It only links out; it never asks for anything.
 */
export const vipNotice = (eligible: boolean, siteUrl: string | null = VIP_SITE_URL): string => {
  if (!eligible || siteUrl === null || !siteUrl.startsWith("https://")) return "";
  return `<div class="vip-notice" data-vip-notice>
      <p class="hero-stale">${icon("star")}<span>${th("portfolio.vip.eligible")}</span></p>
      <div class="vip-notice-actions">
        <a class="vip-link" href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener noreferrer">${th("portfolio.vip.see")}${icon("externalLink")}</a>
        <button class="ghost" id="vip-notice-hide" type="button">${th("portfolio.vip.hide")}</button>
      </div>
    </div>`;
};
