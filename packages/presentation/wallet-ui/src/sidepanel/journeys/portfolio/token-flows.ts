/**
 * Token management and detail flow screens. The tokens flow adds custom
 * tokens, auto-detects held registry tokens, hides or reveals tracked ones,
 * and removes ones that are not built in; the detail flow shows price, a self-drawn 7-day sparkline, holdings,
 * and contract facts. Pure templates — bindings live in ./tokens-ui.ts.
 */

import { escapeHtml } from "@bramble/core/html";
import { isLikelySpam } from "@bramble/portfolio/token-registry";
import type {
  DisplayCurrency,
  TokenConfig,
  WalletPreferences,
} from "@bramble/settings/preferences";
import { emptyState, receipt } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import { isDefaultToken, STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import {
  PRIVACY_OTHER_WALLET,
  PRIVACY_OTHER_WALLET_NEXT,
} from "@bramble/wallet-protocol/privacy-blocker";
import { t, th } from "../../../i18n/messages";
import type { TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import { formatFiat, tokenFiatValue } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { networkDisplayName } from "../../shared/network-label";
import { accountLabel, flowHeader, flowScreen, walletMenuRow } from "../../shared/parts";
import {
  deploymentKnownFromPrivacy,
  type PrivacyDisclosureState,
  privacyIneligibleKind,
} from "../privacy/privacy-model";
import { sparklinePath, sparklineTrend } from "./sparkline";
import { compactAmount, tokenGlyph } from "./token-row";

/**
 * THE token display order: STRK first, then everything else in its existing
 * order. STRK pays every fee on Starknet, so it is the asset a user reaches for
 * most and the sensible default in any picker. Callers that also sort by another
 * key (spam last, for example) must apply that key first and fall back to this
 * one — a second STRK-first implementation would drift between screens.
 */
export const compareStrkFirst = (
  left: { readonly address: string },
  right: { readonly address: string },
): number =>
  Number(sameFelt(right.address, STRK_TOKEN_ADDRESS)) -
  Number(sameFelt(left.address, STRK_TOKEN_ADDRESS));

/**
 * Currency used by the token screens when preferences carry none.
 */
export const DEFAULT_CURRENCY: DisplayCurrency = "usd";

/**
 * Whether a token is kept off the home balances list: user-hidden tokens and
 * anything the spam heuristics flag are hidden by default.
 */
export const isHiddenFromHome = (
  token: TokenConfig,
  preferences: WalletPreferences | null,
): boolean => (preferences?.hiddenTokens ?? []).includes(token.id) || isLikelySpam(token);

const trackedRow = (
  token: TokenConfig,
  balance: TokenBalance | undefined,
  price: number | undefined,
  currency: DisplayCurrency,
  isHidden: boolean,
): string => {
  const spam = isLikelySpam(token);
  const fiat = balance ? tokenFiatValue(balance.formatted, price) : null;
  const toggle = spam
    ? `<span class="token-flag">${th("portfolio.tokens.likelySpam")}</span>`
    : button({
        attributes: {
          "data-token-hidden": String(isHidden),
          "data-token-toggle": token.id,
        },
        label: isHidden ? t("portfolio.tokens.show") : t("portfolio.tokens.hide"),
        size: "small",
        variant: "secondary",
      });
  return `<li class="token-row${isHidden ? " token-hidden" : ""}">
    ${tokenGlyph(token.address, token.symbol)}
    <div class="token-copy">
      <strong>${escapeHtml(token.symbol)}</strong>
      <p>${escapeHtml(token.name)}</p>
    </div>
    <div class="token-side">
      ${balance ? `<span class="token-amount">${escapeHtml(compactAmount(balance.formatted))}</span>` : ""}
      ${fiat === null ? "" : `<span class="token-fiat">${escapeHtml(formatFiat(fiat, currency))}</span>`}
    </div>
    ${toggle}
    ${
      isDefaultToken(token)
        ? ""
        : iconButton({
            attributes: { "data-token-remove": token.id },
            icon: "x",
            label: t("portfolio.tokens.remove", { symbol: token.symbol }),
            tone: "danger",
          })
    }
  </li>`;
};

/**
 * Tokens flow: review tracked, hidden, and likely-spam assets. Adding and
 * discovery are separate tasks reached from the compact action list.
 */
export const tokensFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  balances: readonly TokenBalance[],
  prices: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
): string => {
  const tracked = (preferences?.tokens ?? []).filter(
    (token) => token.networkId === status.networkId,
  );
  const balanceById = new Map(balances.map((balance) => [balance.id, balance]));
  return (
    flowHeader(
      t("portfolio.tabs.tokens"),
      status,
      t("portfolio.tokens.trackedCount", { count: String(tracked.length) }),
    ) +
    flowScreen(
      "tokens",
      `<section class="section">
        <div class="menu-list" role="group" aria-label="${th("portfolio.tokens.actions")}">
          ${walletMenuRow("token-catalog", t("portfolio.tokens.pickCatalog"), "coins")}
          ${walletMenuRow("token-add", t("portfolio.tokens.addByContract"), "plus")}
          ${walletMenuRow("token-discover", t("portfolio.tokens.findHeld"), "search")}
        </div>
      </section>
      <section class="section">
        <p class="eyebrow">${th("portfolio.tokens.tracked")}</p>
        ${
          tracked.length === 0
            ? emptyState(t("portfolio.tokens.noneTracked"))
            : `<ul class="token-list">${tracked
                .map((token) =>
                  trackedRow(
                    token,
                    balanceById.get(token.id),
                    prices[token.address],
                    currency,
                    isHiddenFromHome(token, preferences),
                  ),
                )
                .join("")}</ul>`
        }
        <p class="hint">${th("portfolio.tokens.hiddenHint")}</p>
      </section>`,
    )
  );
};

/**
 * Renders manual token import as a focused contract-identity task.
 */
export const tokenAddFlow = (status: WalletStatus): string =>
  flowHeader(t("portfolio.tokenAdd.title"), status, t("portfolio.tokenAdd.subtitle")) +
  flowScreen(
    "token-add",
    `<section class="section">
      <form id="token-add-form">
        ${textField({
          autocomplete: "off",
          className: "mono",
          hint: t("portfolio.tokenAdd.hint"),
          label: t("portfolio.tokenAdd.field"),
          name: "address",
          placeholder: "0x…",
          required: true,
          spellcheck: false,
        })}
        ${button({ icon: "check", label: t("portfolio.tokenAdd.submit"), type: "submit" })}
        <p id="token-add-result" role="status"></p>
      </form>
    </section>`,
  );

/**
 * Renders curated token discovery as its own scan-and-review task.
 */
export const tokenDiscoverFlow = (status: WalletStatus): string =>
  flowHeader(t("portfolio.tokens.findHeld"), status, t("portfolio.tokenDiscover.subtitle")) +
  flowScreen(
    "token-discover",
    `<section class="section">
      <p class="hint">${th("portfolio.tokenDiscover.hint")}</p>
      ${button({
        attributes: { id: "detect-tokens" },
        icon: "refresh",
        label: t("portfolio.tokenDiscover.scan"),
      })}
      <div id="detect-results"></div>
      <p id="detect-result" role="status"></p>
    </section>`,
  );

const sparkline = (points: readonly number[]): string => {
  const path = sparklinePath(points, 100, 32);
  if (path.length === 0) {
    return emptyState(t("portfolio.detail.noHistory"));
  }
  return `<svg class="sparkline sparkline-${sparklineTrend(points)}" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="${path}" /></svg>`;
};

// Send and Swap for the token on screen, above the privacy pair. Both are
// always offered: an empty balance is discovered on the amount step, exactly as
// it is when Send is opened from Home. Send seeds the asset and nothing else —
// the recipient is still chosen on the first step — while Shield and Unshield
// below carry a recipient and open on the amount.
// "Stake" follows on its own row, like the single privacy action below, and
// only where staking is on and the token is stakable (../staking/staking-entry).
const tokenActions = (tokenId: string, stakable: boolean): string =>
  `<div class="token-privacy-actions">${button({
    attributes: { "data-send-token": tokenId },
    icon: "send",
    label: t("portfolio.home.send"),
  })}${button({
    attributes: { "data-swap-token": tokenId },
    icon: "swap",
    label: t("portfolio.home.swap"),
    variant: "secondary",
  })}</div>${
    stakable
      ? button({
          attributes: { "data-stake-token": tokenId },
          icon: "trendingUp",
          label: t("portfolio.detail.stake"),
          variant: "secondary",
        })
      : ""
  }`;

// Deployment and funding are steps on the way to shielding, not alternatives
// to it, so the control keeps the verb and the privacy screen it opens names
// whichever prerequisite is in the way.
const privacyActions = (
  tokenId: string,
  privacy: PrivacyDisclosureState,
  deployment: boolean | null,
): string => {
  const seen = deploymentKnownFromPrivacy(deployment, privacy);
  if (privacyIneligibleKind(privacy)) return "";
  if (seen === false)
    return button({
      attributes: { "data-privacy-open": tokenId },
      icon: "shield",
      label: t("portfolio.token.shield"),
    });
  if (privacy.error) return "";
  if (privacy.value?.registration === "registered")
    return `<div class="token-privacy-actions">${button({ attributes: { "data-send-shield": tokenId }, icon: "shield", label: t("portfolio.token.shield") })}${button({ attributes: { "data-send-unshield": tokenId }, label: t("portfolio.detail.unshield"), variant: "secondary" })}</div>`;
  // A deployed, unregistered account's first shield registers in the same
  // transaction (mc-wallet 789), so it is offered directly: one pool fee, not two.
  if (seen === true && privacy.value?.registration === "unregistered")
    return button({
      attributes: { "data-send-shield": tokenId },
      icon: "shield",
      label: t("portfolio.token.shield"),
    });
  return button({
    attributes: { "data-privacy-open": tokenId },
    icon: "shield",
    label:
      privacy.value?.registration === "pending"
        ? t("portfolio.detail.registrationPending")
        : t("portfolio.detail.goPrivate"),
  });
};

/**
 * Token detail flow: current price, a 7-day sparkline, holdings, and the
 * contract facts. `chart` holds the recent price series; `price` is the
 * current unit price or null when offline.
 */
export const tokenDetailFlow = (
  status: WalletStatus,
  token: TokenConfig,
  balance: TokenBalance | undefined,
  chart: readonly number[],
  price: number | null,
  currency: DisplayCurrency,
  privacy: PrivacyDisclosureState = {
    error: null,
    loading: false,
    value: null,
  },
  deployment: boolean | null = null,
  stakable = false,
): string => {
  const fiat = balance ? tokenFiatValue(balance.formatted, price ?? undefined) : null;
  const privateBalance = privacy.value?.balances.find((entry) => entry.tokenId === token.id);
  const privateFiat = privateBalance
    ? tokenFiatValue(privateBalance.formatted, price ?? undefined)
    : null;
  const seen = deploymentKnownFromPrivacy(deployment, privacy);
  const registered = seen !== false && privacy.value?.registration === "registered";
  const registrationPending = seen !== false && privacy.value?.registration === "pending";
  return (
    flowHeader(token.symbol, status, token.name) +
    flowScreen(
      "token-detail",
      `<section class="section">
        <p class="eyebrow">${th("portfolio.detail.price")}</p>
        <p class="token-detail-price">${escapeHtml(price === null ? t("portfolio.token.unavailable") : formatFiat(price, currency))}</p>
        ${sparkline(chart)}
        <p class="hint">${th("portfolio.detail.priceSource")}</p>
      </section>
      <section class="section">
        <p class="eyebrow">${th("portfolio.detail.yourBalance")}</p>
        <div class="token-side">
          <span class="token-amount">${escapeHtml(balance?.formatted ? `${compactAmount(balance.formatted)} ${token.symbol}` : "—")}</span>
          ${fiat === null ? "" : `<span class="token-fiat">${escapeHtml(formatFiat(fiat, currency))}</span>`}
        </div>
        ${
          privacy.blockerKind === "other-wallet"
            ? `<div class="private-balance-summary muted">
                <span class="private-balance-label">${icon("lock")}<span>${th("portfolio.token.privateBalance")}</span></span>
                <span class="token-fiat">${escapeHtml(PRIVACY_OTHER_WALLET)} ${escapeHtml(PRIVACY_OTHER_WALLET_NEXT)}</span>
              </div>`
            : privacy.error && deployment !== false
              ? `<button class="private-balance-summary muted" data-privacy-retry type="button">
                <span class="private-balance-label">${icon("lock")}<span>${th("portfolio.token.privateBalance")}</span></span>
                <span class="token-fiat">${th("portfolio.tokens.retry")}</span>
              </button>`
              : registered
                ? `<div class="private-balance-summary">
                <span class="private-balance-label">${icon("lock")}<span>${th("portfolio.token.privateBalance")}</span></span>
                <span class="token-side">
                  <strong class="token-amount">${escapeHtml(`${compactAmount(privateBalance?.formatted ?? "0")} ${token.symbol}`)}</strong>
                  ${privateFiat === null ? "" : `<span class="token-fiat">${escapeHtml(formatFiat(privateFiat, currency))}</span>`}
                </span>
              </div>`
                : privacy.value
                  ? `<div class="private-balance-summary muted" title="${registrationPending ? th("portfolio.detail.waitingIndexer") : th("portfolio.token.register")}">
                <span class="private-balance-label">${icon("lock")}<span>${th("portfolio.token.privateBalance")}</span></span>
                <span class="token-fiat">${registrationPending ? th("portfolio.token.registrationPending") : th("portfolio.token.register")}</span>
              </div>`
                  : ""
        }
        ${tokenActions(token.id, stakable)}
        ${privacyActions(token.id, privacy, deployment)}
      </section>
      <section class="section">
        <p class="eyebrow">${th("portfolio.detail.contract")}</p>
        ${receipt([
          {
            action: {
              attributes: { "data-copy": token.address },
              icon: "copy",
              label: t("portfolio.detail.copyAddress"),
            },
            label: t("portfolio.detail.address"),
            value: accountLabel(token.address),
            valueStyle: "code",
          },
          { label: t("portfolio.detail.symbol"), value: token.symbol },
          { label: t("portfolio.detail.decimals"), value: String(token.decimals) },
          { label: t("portfolio.activity.network"), value: networkDisplayName(status.network) },
        ])}
      </section>`,
    )
  );
};
