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
    : `${compactAmount(amount)} base units`;

// A record the wallet can only bound from below (an increase applied on top of
// a grant it never saw) is labelled as such rather than printed as if it were
// the standing allowance — the understatement is the one direction that hides a
// drainer. An unlimited lower bound is still unlimited, so that label wins, and
// a bound of zero bounds nothing at all: the pair is approved for an amount
// this wallet cannot state, which "at least 0" would read as harmless.
const amountLabel = (allowance: AllowanceView, token: TokenConfig | null): string =>
  isUnlimitedAllowance(allowance.amount)
    ? "Unlimited"
    : !allowance.lowerBound
      ? displayAmount(allowance.amount, token)
      : allowance.amount === "0"
        ? "an unknown amount"
        : `at least ${displayAmount(allowance.amount, token)}`;

// A contract the wallet cannot call a token: an ERC721 `approve(to, item_id)`
// is the same three felts as an ERC20 `approve(spender, amount)`, so the figure
// above may be an item id. The revoke control is withheld with it — sending
// `approve(spender, 0)` at a collection approves item #0 rather than revoking —
// and the background refuses that broadcast too.
const UNCONFIRMED_TOKEN_NOTE =
  "This wallet cannot confirm this contract is a token, so the value may be an NFT item id rather than an amount. Revoke it from the site that asked for it.";

// What the listing could not vouch for. Shown above the list, and above the
// "none found" line too, because an empty list from a partial reading is not a
// statement that nothing is outstanding (Sherlock 181, 183, 190).
const NOTICE_COPY: Readonly<Record<AllowanceNotice, string>> = {
  "multisig-unread":
    "A watched multisig could not be read, so approvals it granted may be missing.",
  "retention-full": `This wallet keeps ${ALLOWANCE_LIMITS.entriesPerScope} approvals per account and drops the smallest first, so some may be missing.`,
  "scan-incomplete":
    "This list may be incomplete. Some older approvals on your tokens could not be checked.",
};

const UNAVAILABLE_COPY = "Allowances could not be loaded. Refresh to try again.";

// Before the first answer, a count of zero or "none found" would be a claim
// the wallet has not checked.
const LOADING_COPY = "Loading allowances…";

const noticeLines = (notices: readonly AllowanceNotice[]): string =>
  notices
    .map((notice) => `<p class="hint allowance-notice">${escapeHtml(NOTICE_COPY[notice])}</p>`)
    .join("");

// A revoke this wallet sent that the chain has not confirmed. The row keeps
// the grant's amount and its revoke control: if the revoke reverted, the grant
// still stands (Sherlock 192).
const REVOKING_NOTE = "Revoke sent. It stays listed until the network confirms it.";

const SOURCE_LABELS: Readonly<Record<AllowanceView["source"], string>> = {
  external: "on-chain",
  multisig: "granted by a multisig you sign for",
  wallet: "this wallet",
};

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
      <span class="allowance-spender"><code title="${escapeHtml(allowance.spender)}">${escapeHtml(accountLabel(allowance.spender))}</code>${inlineCopyButton(allowance.spender, "Copy spender address")}</span>
      <p class="hint"><span class="allowance-amount" title="${escapeHtml(allowance.token)}">${escapeHtml(amountLabel(allowance, token))}</span>${token ? "" : ` of <span title="${escapeHtml(allowance.token)}">${escapeHtml(accountLabel(allowance.token))}</span>`} · ${escapeHtml(SOURCE_LABELS[allowance.source])}${inlineCopyButton(allowance.token, "Copy token contract address")}</p>
      ${allowance.unconfirmedToken ? `<p class="hint">${escapeHtml(UNCONFIRMED_TOKEN_NOTE)}</p>` : ""}
      ${allowance.revoking ? `<p class="hint">${escapeHtml(REVOKING_NOTE)}</p>` : ""}
      <p class="allowance-review" data-allowance-review-for="${escapeHtml(allowance.id)}" role="status" hidden></p>
    </div>
    ${
      allowance.source === "multisig" || allowance.unconfirmedToken
        ? ""
        : button({
            attributes: { "data-revoke-allowance": allowance.id },
            label: "Revoke",
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
      "Allowances",
      status,
      listing.loading
        ? undefined
        : listing.unavailable
          ? "Not loaded"
          : `${scoped.length} outstanding`,
    ) +
    flowScreen(
      "allowances",
      `<section class="section">
        <div class="section-head">
          <p class="lede">Revoking sets a spender's allowance to zero after you confirm its network fee.</p>
          ${iconButton({ attributes: { id: "allowance-refresh" }, icon: "refresh", label: "Refresh allowances" })}
        </div>
        ${contextHelp(
          "allowance-scan-scope",
          "What this list includes",
          "It includes approvals granted here and approvals discovered on-chain for tracked ERC-20 tokens. 'At least' means the wallet can only prove a lower bound. NFT approvals and untracked tokens are outside this scan; unconfirmed contracts keep no revoke control because an ERC-20 revoke call could grant an NFT instead.",
        )}
        ${account === null || listing.unavailable ? "" : noticeLines(listing.notices)}
        ${
          account === null
            ? emptyState("Unlock an account on this network to manage allowances.")
            : listing.loading
              ? emptyState(LOADING_COPY)
              : listing.unavailable
                ? emptyState(UNAVAILABLE_COPY, "alert")
                : scoped.length === 0
                  ? emptyState("No allowances on tokens you track.")
                  : `<ul class="allowance-list">${scoped.map((allowance) => allowanceRow(allowance, tokenFor(allowance, preferences))).join("")}</ul>`
        }
        <p id="allowance-result" role="status"></p>
      </section>`,
    )
  );
};
