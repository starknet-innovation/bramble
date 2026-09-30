/**
 * Portfolio section on the home screen. Only Tokens is shown today: the
 * Collectibles tab is parked until the NFT journey is ready, so the section
 * renders a heading rather than a tablist and no tab runtime exists. Activity
 * remains a top-level dock destination rather than appearing twice. A single
 * overflow menu progressively discloses asset management, refresh, and
 * settings actions.
 */

import { escapeHtml } from "@bramble/core/html";
import { friendlyNetworkError } from "@bramble/core/network-error";
import type {
  DisplayCurrency,
  TokenConfig,
  WalletPreferences,
} from "@bramble/settings/preferences";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { emptyState } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { menuRow } from "@bramble/ui-kit/navigation";
import { explorerTransactionUrl } from "@bramble/wallet-model/networks";
import type { TokenBalance } from "../../../popup/responses/responses";
import type { BalanceState } from "../../runtime/runtime";
import { icon } from "../../shared/icons";
import { accountLabel, inlineCopyButton } from "../../shared/parts";
import { formatUtcClock, formatUtcDate, utcDayKey } from "../../shared/timestamp";
import {
  deploymentKnownFromPrivacy,
  type PrivacyDisclosureState,
  privacyIneligibleKind,
} from "../privacy/privacy-model";
import { type ActivityPricing, activityRowModel, capitalise } from "./activity-format";
import { compareStrkFirst, isHiddenFromHome } from "./token-flows";
import {
  type PrivateBreakdown,
  starknetNetworkGlyph,
  tokenGlyph,
  unifiedBalanceRow,
} from "./token-row";

/**
 * Balances shown on the home Tokens tab: tracked balances minus user-hidden
 * and likely-spam tokens.
 */
export const visibleHomeBalances = (
  state: BalanceState,
  preferences: WalletPreferences | null,
): readonly TokenBalance[] => {
  if ("error" in state) {
    return [];
  }
  const trackedById = new Map<string, TokenConfig>(
    (preferences?.tokens ?? []).map((token) => [token.id, token]),
  );
  return state.balances.filter((balance) => {
    const token = trackedById.get(balance.id);
    return !token || !isHiddenFromHome(token, preferences);
  });
};

/**
 * Private balances shown on the home portfolio, using the same user-hidden and
 * spam filtering rules as the public token list.
 */
export const visiblePrivateHomeBalances = (
  privacy: PrivacyDisclosureState,
  preferences: WalletPreferences | null,
): readonly TokenBalance[] => {
  if (privacy.loading || privacy.error || privacy.value?.registration !== "registered") {
    return [];
  }
  const trackedById = new Map<string, TokenConfig>(
    (preferences?.tokens ?? []).map((token) => [token.id, token]),
  );
  return privacy.value.balances.flatMap((entry) => {
    const token = trackedById.get(entry.tokenId);
    return !token || isHiddenFromHome(token, preferences)
      ? []
      : [{ ...token, balance: entry.balance, formatted: entry.formatted }];
  });
};

/**
 * Home token list with public and private balances summed per asset. Rows keep
 * the public token order; tokens holding only a private balance are appended.
 * When discovery has not produced private amounts the list equals the public
 * one, so hero totals degrade to public-only instead of hiding.
 */
export const unifiedHomeBalances = (
  state: BalanceState,
  privacy: PrivacyDisclosureState,
  preferences: WalletPreferences | null,
): readonly TokenBalance[] => {
  const privateById = new Map(
    visiblePrivateHomeBalances(privacy, preferences).map((token) => [token.id, token]),
  );
  const combined = visibleHomeBalances(state, preferences).map((token) => {
    const privateEntry = privateById.get(token.id);
    privateById.delete(token.id);
    if (!privateEntry) {
      return token;
    }
    const total = BigInt(token.balance) + BigInt(privateEntry.balance);
    return {
      ...token,
      balance: `0x${total.toString(16)}`,
      formatted: formatTokenAmount(total, token.decimals),
    };
  });
  return [...combined, ...privateById.values()].sort(compareStrkFirst);
};

/**
 * User guidance for transactions Starknet has not settled yet, shared with the
 * activity screen. Pending and pre-confirmed are both provisional, but they say
 * different things: pending means the chain has not executed the transaction,
 * pre-confirmed means the proposer has executed it and consensus has not
 * committed its block yet.
 */
const PROVISIONAL_TX_HINT: Partial<Record<ActivityEntry["status"], string>> = {
  pending: "Broadcast accepted. It can't be fee-bumped, replaced, or cancelled.",
  preconfirmed:
    "Pre-confirmed by the block proposer: the result is known, the block is not final. The wallet keeps checking and will tell you if it does not settle.",
};

/**
 * Display label for a status. Pre-confirmed reads as "PRE-CONFIRMED" rather
 * than the storage spelling.
 */
const STATUS_LABEL: Partial<Record<ActivityEntry["status"], string>> = {
  preconfirmed: "pre-confirmed",
};

/**
 * Renders one recorded transaction row for the account-partitioned Activity
 * dock and its design-system specimen, in the design kit's transaction-row
 * anatomy: an inline kind glyph beside the verb, the counterparty or asset
 * pair beneath it, the signed fiat delta over the asset amount on the right,
 * and the token mark trailing. A settled
 * row says nothing more; a provisional or failed one adds its status word
 * beneath the detail in the status hue, carries an explanatory hint, and keeps
 * its glyph in that hue, so a pre-confirmed transaction never reads as
 * settled. The status and UTC time stay reachable on the row's tooltip and in
 * the summary's accessible name (the visible meta line is hidden from
 * assistive tech), so nothing is announced twice. The visible verb is a classification, so the accessible name keeps
 * the full recorded summary (prefixed by the verb when the summary does not
 * already start with it) — the row never announces less than the record says.
 * A recorded counterparty shows truncated with a quiet copy control that
 * carries the full stored address (the row itself is not a button, so the
 * control nests nowhere). Without `pricing` the fiat delta is simply absent.
 */
export const transactionRow = (entry: ActivityEntry, pricing?: ActivityPricing): string => {
  const hint = PROVISIONAL_TX_HINT[entry.status];
  const label = STATUS_LABEL[entry.status] ?? entry.status;
  const row = activityRowModel(entry, pricing);
  // Devnet has no explorer, so the outbound link is simply absent there rather
  // than pointing somewhere that cannot resolve the hash.
  const explorer = explorerTransactionUrl(entry.networkId, entry.hash);
  const statusLabel = `${row.label}, ${label}`;
  // Status leads the clock on the tooltip and in the accessible name; the time
  // is not printed on the row itself.
  const clock = formatUtcClock(entry.submittedAt);
  const timing = [capitalise(label), clock].filter((part) => part !== null).join(" · ");
  const spoken = clock === null ? label : `${label}, ${clock}`;
  const avatar = row.tokenSymbol
    ? tokenGlyph(row.tokenAddress ?? "0x0", row.tokenSymbol)
    : starknetNetworkGlyph();
  // The verb alone ("Sent") said less than the row's own asset column did, so
  // the amount joins it and the column goes. The fiat figure went with it: a
  // value computed from today's price is not what this transaction was worth.
  // Entries recorded before the amount and token fields existed carry the
  // figure only inside their summary, which `detail` has already stripped the
  // verb from. Using it keeps the amount on the collapsed row; a counterparty
  // detail is an address and belongs in the expansion, not the heading.
  const figure = row.amount ?? (row.counterparty ? null : row.detail);
  const heading = figure === null ? row.title : `${row.title} ${figure}`;
  const when = [formatUtcDate(entry.submittedAt), clock].filter((part) => part !== null).join(", ");
  return `
  <li class="tx-row" data-live-group title="${escapeHtml(timing)}">
    <details class="disclosure tx-disclosure" data-disclosure="tx:${escapeHtml(entry.hash)}">
      <summary aria-label="${escapeHtml(heading)}. ${escapeHtml(spoken)}">
        <span class="tx-kind-icon tx-kind-${escapeHtml(row.type)} ${escapeHtml(entry.status)}" aria-hidden="true" title="${escapeHtml(hint ?? statusLabel)}" data-live-key="transaction:${escapeHtml(entry.hash)}:status" data-live-value="${escapeHtml(entry.status)}">${icon(row.icon)}</span>
        <span class="tx-copy">
          <strong class="tx-title">${escapeHtml(heading)}</strong>
          ${
            explorer
              ? `<a class="tx-hash" href="${escapeHtml(explorer)}" target="_blank" rel="noopener noreferrer" data-tx-hash aria-label="View this transaction on Starkscan"><code>${escapeHtml(accountLabel(entry.hash))}</code></a>`
              : `<code class="tx-hash is-plain">${escapeHtml(accountLabel(entry.hash))}</code>`
          }
        </span>
        ${
          entry.status === "accepted"
            ? ""
            : `<span class="tx-meta ${escapeHtml(entry.status)}">${escapeHtml(capitalise(label))}</span>`
        }
        <span class="tx-avatar">${avatar}</span>
        <span class="disclosure-mark">${icon("chevronRight")}</span>
      </summary>
      <div class="disclosure-body">
        <dl class="request-detail">
          ${
            row.counterparty
              ? `<div><dt>${escapeHtml(capitalise(row.counterparty.role))}</dt><dd><code title="${escapeHtml(row.counterparty.address)}">${escapeHtml(accountLabel(row.counterparty.address))}</code>${inlineCopyButton(row.counterparty.address, `Copy ${row.counterparty.role} address`)}</dd></div>`
              : row.detail && row.detail !== figure
                ? `<div><dt>Detail</dt><dd>${escapeHtml(row.detail)}</dd></div>`
                : ""
          }
          ${when === "" ? "" : `<div><dt>Submitted</dt><dd>${escapeHtml(when)}</dd></div>`}
          ${hint ? `<div><dt>Status</dt><dd>${escapeHtml(hint)}</dd></div>` : ""}
        </dl>
      </div>
    </details>
  </li>`;
};

// The heading for one UTC day: the two most recent days read as words when
// the caller knows which day it is, every other day shows its date.
const dayLabel = (key: number, date: string, todayKey: number | null): string =>
  key === todayKey ? "Today" : key === (todayKey ?? Number.NaN) - 1 ? "Yesterday" : date;

/**
 * Groups a newest-first feed into UTC calendar days, each rendered as a small
 * heading over its own list, so a long feed reads by date rather than as one
 * undifferentiated column. Consecutive entries are grouped, which preserves the
 * feed's own order; an entry without a usable timestamp joins an "Undated"
 * group. `todayKey` (the current UTC day from `utcDayKey`) labels that day
 * "Today" and the one before it "Yesterday"; without it every day is dated.
 */
export const transactionGroups = (
  entries: readonly ActivityEntry[],
  pricing?: ActivityPricing,
  todayKey: number | null = null,
): string => {
  const groups: Array<{ readonly key: number | null; readonly label: string; rows: string[] }> = [];
  for (const entry of entries) {
    const date = formatUtcDate(entry.submittedAt);
    const key = date === null ? null : utcDayKey(entry.submittedAt);
    const current = groups.at(-1);
    if (current && current.key === key) {
      current.rows.push(transactionRow(entry, pricing));
    } else {
      const label = key === null || date === null ? "Undated" : dayLabel(key, date, todayKey);
      groups.push({ key, label, rows: [transactionRow(entry, pricing)] });
    }
  }
  return groups
    .map(
      (group) =>
        `<section class="tx-day"><h3 class="tx-day-label">${escapeHtml(group.label)}</h3><ul class="tx-list">${group.rows.join("")}</ul></section>`,
    )
    .join("");
};

// Renders the failed-load state with a friendly, actionable line and an
// in-panel retry that re-runs the balance load (wired in ./index.ts).
const tokensErrorPanel = (error: string): string => `
  <div class="panel-error">
    ${emptyState(friendlyNetworkError(error) ?? error)}
    ${button({
      attributes: { "aria-label": "Retry loading balances", "data-reload-balances": true },
      icon: "refresh",
      label: "Try again",
      size: "small",
      variant: "ghost",
    })}
  </div>`;

// Derives one asset's private-line state from the shared discovery state. An
// idle discovery (auto-load not finished) reads as loading, never as absent.
const privateBreakdownFor = (
  privacy: PrivacyDisclosureState,
  tokenId: string,
  deployment: boolean | null,
  fundedForFees: boolean | null,
): PrivateBreakdown => {
  if (privacyIneligibleKind(privacy)) return { kind: "unavailable" };
  if (deploymentKnownFromPrivacy(deployment, privacy) === false) {
    return { kind: fundedForFees === false ? "needs-funds" : "undeployed" };
  }
  if (privacy.error) {
    return { kind: "unavailable" };
  }
  if (privacy.loading || !privacy.value) {
    return { kind: "loading" };
  }
  if (privacy.value.registration === "pending") {
    return { kind: "pending" };
  }
  if (privacy.value.registration !== "registered") {
    return { kind: "unregistered" };
  }
  const entry = privacy.value.balances.find((candidate) => candidate.tokenId === tokenId);
  return {
    balance: entry?.balance ?? "0x0",
    formatted: entry?.formatted ?? "0",
    kind: "ready",
  };
};

const tokensPanel = (
  state: BalanceState,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
  privacy: PrivacyDisclosureState,
  deployment: boolean | null,
  fundedForFees: boolean | null = true,
): string => {
  const visible = visibleHomeBalances(state, preferences);
  const hiddenCount = "error" in state ? 0 : state.balances.length - visible.length;
  const publicById = new Map(visible.map((token) => [token.id, token]));
  const unified = unifiedHomeBalances(state, privacy, preferences);
  const body =
    "error" in state
      ? tokensErrorPanel(state.error)
      : unified.length === 0
        ? emptyState("No tracked balances yet. Add or scan for tokens to see them here.")
        : `<ul class="token-list">${unified
            .map((token) =>
              unifiedBalanceRow(token, prices[token.address], changes[token.address], currency, {
                private: privateBreakdownFor(privacy, token.id, deployment, fundedForFees),
                publicFormatted: publicById.get(token.id)?.formatted ?? "0",
              }),
            )
            .join("")}</ul>`;
  return `${body}
    ${
      privacy.error
        ? `<button class="private-balance-summary muted" data-privacy-retry type="button">
            <span class="private-balance-label">${icon("lock")}<span>Private balances</span></span>
            <span class="token-fiat">Try again</span>
          </button>`
        : ""
    }
    ${
      hiddenCount > 0
        ? menuRow({
            attributes: { "data-view": "tokens" },
            icon: "coins",
            label: "Manage tokens",
            value: `${hiddenCount} not shown`,
          })
        : ""
    }
    <p id="panel-result" role="status"></p>`;
};

/**
 * Empty-state copy for the account-partitioned Activity dock.
 */
export const activityEmptyCopy = (historyUnavailable: boolean): string =>
  historyUnavailable
    ? "No transactions recorded on this device yet."
    : "No activity yet. Transactions for this account appear here.";

/**
 * Renders the portfolio section. With only Tokens visible there is no tab
 * switching: the section title is a plain heading rather than a one-item
 * tablist, and the token list needs no panel wrapper.
 */
export const homeTabs = (
  state: BalanceState,
  preferences: WalletPreferences | null,
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
  privacy: PrivacyDisclosureState = {
    error: null,
    loading: false,
    value: null,
  },
  deployment: boolean | null = null,
  fundedForFees: boolean | null = true,
): string => `
  <section class="home-tabs" aria-label="Portfolio">
    <div class="tab-bar">
      <div class="tab-set">
        <h2>Tokens</h2>
      </div>
      <div class="portfolio-actions">
        ${iconButton({
          attributes: {
            "aria-controls": "portfolio-menu",
            "aria-expanded": "false",
            "aria-haspopup": "menu",
            id: "portfolio-menu-trigger",
          },
          className: "portfolio-menu-trigger",
          icon: "moreHorizontal",
          label: "Portfolio actions",
          variant: "ghost",
        })}
        <div class="portfolio-menu" id="portfolio-menu" role="menu" aria-label="Portfolio actions" hidden>
          ${button({
            attributes: { "data-view": "tokens", role: "menuitem", tabindex: "-1" },
            className: "portfolio-menu-item",
            icon: "coins",
            label: "Manage tokens",
            variant: "ghost",
          })}
          ${button({
            attributes: {
              "data-reload-balances": true,
              id: "refresh-button",
              role: "menuitem",
              tabindex: "-1",
            },
            className: "portfolio-menu-item",
            icon: "refresh",
            label: "Refresh portfolio",
            variant: "ghost",
          })}
        </div>
      </div>
    </div>
    ${tokensPanel(state, preferences, prices, changes, currency, privacy, deployment, fundedForFees)}
  </section>`;
