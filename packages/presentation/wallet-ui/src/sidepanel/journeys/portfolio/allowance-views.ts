/**
 * Allowance-manager flow screen: lists every outstanding ERC20 spending
 * allowance for the active account — the approvals this wallet granted, the
 * ones a multisig it signs for granted, and the ones discovered on-chain for
 * tracked tokens — each revokable one with a one-tap revoke. Every entry is
 * labelled with where it came from, so the origin of each is clear.
 */

import { escapeHtml } from "@bramble/core/html";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import {
  type AllowanceNotice,
  type AllowanceView,
  isUnlimitedAllowance,
} from "@bramble/transactions/allowance-discovery";
import { ALLOWANCE_LIMITS } from "@bramble/transactions/allowance-store";
import { emptyState } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { sameFelt } from "@bramble/wallet-model/networks";
import { t, th } from "../../../i18n/messages";
import type { AllowanceListing, WalletStatus } from "../../../popup/responses/responses";
import {
  accountLabel,
  contextHelp,
  flowHeader,
  flowScreen,
  inlineCopyButton,
} from "../../shared/parts";
import { compactAmount } from "./token-row";

// An allowance is stored in the token's base units — the second felt of the
// approve call, exactly as it went on chain — and carries no decimals of its
// own. The network-scoped token list is what turns it into an amount a person
// can read: 1,000 USDC is 1,000,000,000 base units, and printing the latter
// once shipped as a thousand-fold overstatement. Matched on the canonical felt,
// so a zero-padded contract address still finds its token.
const tokenFor = (
  allowance: AllowanceView,
  preferences: WalletPreferences | null,
): TokenConfig | null =>
  preferences?.tokens.find(
    (token) => token.networkId === allowance.networkId && sameFelt(token.address, allowance.token),
  ) ?? null;

// A token the wallet does not track has no known scale. Its amount is shown in
// raw base units and says so, rather than under a guessed decimal count that
// would misstate it silently in either direction.
const displayAmount = (amount: string, token: TokenConfig | null): string =>
  token && /^\d+$/.test(amount)
    ? `${compactAmount(formatTokenAmount(BigInt(amount), token.decimals))} ${token.symbol}`
    : t("portfolio.allowance.baseUnits", { amount: compactAmount(amount) });

// A record the wallet can only bound from below (an increase applied on top of
// a grant it never saw) is labelled as such rather than printed as if it were
// the standing allowance — the understatement is the one direction that hides a
// drainer. An unlimited lower bound is still unlimited, so that label wins, and
// a bound of zero bounds nothing at all: the pair is approved for an amount
// this wallet cannot state, which "at least 0" would read as harmless.
const amountLabel = (allowance: AllowanceView, token: TokenConfig | null): string =>
  isUnlimitedAllowance(allowance.amount)
    ? t("portfolio.allowance.unlimited")
    : !allowance.lowerBound
      ? displayAmount(allowance.amount, token)
      : allowance.amount === "0"
        ? t("portfolio.allowance.unknownAmount")
        : t("portfolio.allowance.atLeast", { amount: displayAmount(allowance.amount, token) });

// A contract the wallet cannot call a token: an ERC721 `approve(to, item_id)`
// is the same three felts as an ERC20 `approve(spender, amount)`, so the figure
// above may be an item id. The revoke control is withheld with it — sending
// `approve(spender, 0)` at a collection approves item #0 rather than revoking —
// and the background refuses that broadcast too.
const unconfirmedTokenNote = (): string => t("portfolio.allowance.unconfirmedToken");

// What the listing could not vouch for. Shown above the list, and above the
// "none found" line too, because an empty list from a partial reading is not a
// statement that nothing is outstanding (Sherlock 181, 183, 190).
const noticeCopy = (notice: AllowanceNotice): string =>
  notice === "multisig-unread"
    ? t("portfolio.allowance.multisigUnread")
    : notice === "retention-full"
      ? t("portfolio.allowance.retentionFull", {
          count: String(ALLOWANCE_LIMITS.entriesPerScope),
        })
      : t("portfolio.allowance.scanIncomplete");

// Before the first answer, a count of zero or "none found" would be a claim
// the wallet has not checked.

const noticeLines = (notices: readonly AllowanceNotice[]): string =>
  notices
    .map((notice) => `<p class="hint allowance-notice">${escapeHtml(noticeCopy(notice))}</p>`)
    .join("");

// A revoke this wallet sent that the chain has not confirmed. The row keeps
// the grant's amount and its revoke control: if the revoke reverted, the grant
// still stands (Sherlock 192).
const sourceLabel = (source: AllowanceView["source"]): string =>
  source === "external"
    ? t("portfolio.allowance.sourceChain")
    : source === "multisig"
      ? t("portfolio.allowance.sourceMultisig")
      : t("portfolio.allowance.sourceWallet");

// One allowance per row: the spender leads (it is who can move funds), shown
// truncated with a copy control for the full address so it can be checked
// against the site that asked, with the token, amount, and provenance as one
// quiet supporting line — never three stacked label/value pairs fighting for
// attention. A multisig's allowance is
// listed but carries no revoke control: zeroing it takes a separately reviewed
// multisig intent and threshold authorization, so offering the button here would be an
// affordance that can only fail. An unconfirmed contract is withheld the
// control for the opposite reason: the call would not fail, it would grant.
const allowanceRow = (allowance: AllowanceView, token: TokenConfig | null): string => `
  <li class="allowance-row">
    <div class="allowance-copy">
      <span class="allowance-spender"><code title="${escapeHtml(allowance.spender)}">${escapeHtml(accountLabel(allowance.spender))}</code>${inlineCopyButton(allowance.spender, t("portfolio.allowance.copySpender"))}</span>
      <p class="hint"><span class="allowance-amount" title="${escapeHtml(allowance.token)}">${escapeHtml(amountLabel(allowance, token))}</span>${token ? "" : ` ${th("portfolio.allowance.of")} <span title="${escapeHtml(allowance.token)}">${escapeHtml(accountLabel(allowance.token))}</span>`} · ${escapeHtml(sourceLabel(allowance.source))}${inlineCopyButton(allowance.token, t("portfolio.activity.copyTokenContract"))}</p>
      ${allowance.unconfirmedToken ? `<p class="hint">${escapeHtml(unconfirmedTokenNote())}</p>` : ""}
      ${allowance.revoking ? `<p class="hint">${th("portfolio.allowance.revoking")}</p>` : ""}
      <p class="allowance-review" data-allowance-review-for="${escapeHtml(allowance.id)}" role="status" hidden></p>
    </div>
    ${
      allowance.source === "multisig" || allowance.unconfirmedToken
        ? ""
        : button({
            attributes: { "data-revoke-allowance": allowance.id },
            label: t("portfolio.allowance.revoke"),
            size: "small",
            tone: "danger",
            variant: "ghost",
          })
    }
  </li>`;

/**
 * Allowance flow: review and revoke every outstanding approval for the active
 * network, whether granted through this wallet or discovered on-chain.
 */
export const allowancesFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  listing: AllowanceListing,
  preferences: WalletPreferences | null,
): string => {
  // Defence in depth behind the background's own scoping: an entry must be on
  // the displayed network and either belong to the active account or be one the
  // background authorized as a multisig this account signs for.
  const scoped = listing.entries.filter(
    (allowance) =>
      allowance.networkId === status.networkId &&
      (allowance.accountId === account?.id || allowance.source === "multisig"),
  );
  return (
    flowHeader(
      t("portfolio.allowance.title"),
      status,
      listing.loading
        ? undefined
        : listing.unavailable
          ? t("portfolio.allowance.notLoaded")
          : t("portfolio.allowance.outstanding", { count: String(scoped.length) }),
    ) +
    flowScreen(
      "allowances",
      `<section class="section">
        <div class="section-head">
          <p class="lede">${th("portfolio.allowance.lede")}</p>
          ${iconButton({ attributes: { id: "allowance-refresh" }, icon: "refresh", label: t("portfolio.allowance.refresh") })}
        </div>
        ${contextHelp(
          "allowance-scan-scope",
          t("portfolio.allowance.scopeTitle"),
          t("portfolio.allowance.scopeBody"),
        )}
        ${account === null || listing.unavailable ? "" : noticeLines(listing.notices)}
        ${
          account === null
            ? emptyState(t("portfolio.allowance.noAccount"))
            : listing.loading
              ? emptyState(t("portfolio.allowance.loading"))
              : listing.unavailable
                ? emptyState(t("portfolio.allowance.unavailable"), "alert")
                : scoped.length === 0
                  ? emptyState(t("portfolio.allowance.none"))
                  : `<ul class="allowance-list">${scoped.map((allowance) => allowanceRow(allowance, tokenFor(allowance, preferences))).join("")}</ul>`
        }
        <p id="allowance-result" role="status"></p>
      </section>`,
    )
  );
};
