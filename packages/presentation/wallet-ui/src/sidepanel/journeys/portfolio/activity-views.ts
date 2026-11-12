/**
 * Account-scoped activity and parked-request templates. Transactions remain
 * the Activity dock's primary content; snoozed dApp decisions live one level
 * deeper so monitoring and approval are never mixed into one long screen.
 *
 * The Activity dock carries its filter, sort and search controls. They render
 * from the ephemeral view state; the binding applies the filter and the search
 * to the rendered rows, so only the sort changes the feed's shape (per-day
 * groups, or one amount-ordered list) and is applied by repainting.
 */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { ActivityEntry } from "@bramble/transactions/activity";
import type { RelaySignature } from "@bramble/transactions/relay-signatures";
import { emptyState } from "@bramble/ui-kit/content";
import { iconButton, segmentedControl } from "@bramble/ui-kit/controls";
import { inputControl, selectField } from "@bramble/ui-kit/fields";
import { t, th } from "../../../i18n/messages";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { dockScreen, flowHeader, flowScreen, walletMenuRow } from "../../shared/parts";
import { approvalCard } from "../approvals/approval-cards";
import type { ConnectPicker } from "../approvals/approval-connect-card";
import {
  type ActivityContact,
  type ActivityFilter,
  type ActivityFilterOptions,
  activityAmountComparator,
  activityFilterOptions,
  reconcileActivityFilter,
} from "./activity-filter";
import { type ActivityPricing, activityStatusTitle, activityTitleText } from "./activity-format";
import { activityViewState, setActivityViewState } from "./activity-view-state";
import { activityEmptyCopy, transactionGroups, transactionList } from "./home-tabs";
import { relaySection } from "./relay-rows";

// The filter, sort and search controls. Each select option comes from the
// options the feed currently offers, so a control never offers a value that
// would match nothing, and every value is selected from the reconciled filter.
const activityToolbar = (filter: ActivityFilter, options: ActivityFilterOptions): string => {
  return `<div class="activity-toolbar">
    <label class="activity-search"><span>${th("portfolio.activity.search")}</span>${inputControl({
      ariaLabel: t("portfolio.activity.searchLabel"),
      attributes: { id: "activity-search" },
      autocomplete: "off",
      className: "mono",
      placeholder: t("portfolio.activity.searchPlaceholder"),
      spellcheck: false,
      type: "search",
      value: filter.query,
    })}</label>
    ${selectField({
      attributes: { id: "activity-type" },
      label: t("portfolio.activity.type"),
      name: "activity-type",
      options: [
        { label: t("portfolio.activity.allTypes"), value: "all" },
        ...options.actions.map((action) => ({ label: activityTitleText(action), value: action })),
      ],
      selected: filter.action,
    })}
    ${selectField({
      attributes: { id: "activity-status" },
      label: t("portfolio.activity.status"),
      name: "activity-status",
      options: [
        { label: t("portfolio.activity.allStatuses"), value: "all" },
        ...options.statuses.map((status) => ({
          label: activityStatusTitle(status),
          value: status,
        })),
      ],
      selected: filter.status,
    })}
    ${selectField({
      attributes: { id: "activity-token" },
      label: t("portfolio.activity.token"),
      name: "activity-token",
      options: [
        { label: t("portfolio.activity.allTokens"), value: "all" },
        ...options.tokens.map((token) => ({ label: token.label, value: token.key })),
      ],
      selected: filter.token,
    })}
    ${segmentedControl(t("portfolio.activity.sort"), [
      {
        attributes: { "data-activity-sort": "date" },
        label: t("portfolio.activity.sortDate"),
        pressed: filter.sort === "date",
      },
      {
        attributes: { "data-activity-sort": "amount" },
        label: t("portfolio.activity.sortAmount"),
        pressed: filter.sort === "amount",
      },
    ])}
  </div>`;
};

// The feed itself: per-day groups for the date sort, one untitled list for the
// amount sort, which is why only the sort needs a repaint.
const activityFeed = (
  entries: readonly ActivityEntry[],
  pricing: ActivityPricing | undefined,
  todayKey: number | null,
  contacts: readonly ActivityContact[],
  filter: ActivityFilter,
): string =>
  filter.sort === "amount"
    ? transactionList([...entries].sort(activityAmountComparator(pricing)), pricing, contacts)
    : transactionGroups(entries, pricing, todayKey, contacts);

/**
 * Renders the Activity dock for the active account and network only. `pricing`
 * (the display currency, cached prices, and tracked tokens) lets each row show
 * a signed fiat delta; without it rows show asset amounts alone. `todayKey`
 * (the current UTC day, from the composition root's clock) lets the two most
 * recent days read as Today and Yesterday; without it every day shows its date.
 * `contacts` are the network's address-book and account names the search can
 * resolve. The filter, sort and search controls render from the ephemeral view
 * state, which the binding also applies, so both sides read one source.
 * `relays` are the OutsideExecution messages this device signed for relay,
 * listed above the feed and outside its filters (issue 299).
 */
export const activityScreen = (
  pending: readonly PendingApproval[],
  status: WalletStatus,
  transactions: readonly ActivityEntry[],
  historyUnavailable: boolean,
  multisig: ArgentMultisigRecord | null = null,
  pricing?: ActivityPricing,
  todayKey: number | null = null,
  contacts: readonly ActivityContact[] = [],
  relays: readonly RelaySignature[] = [],
): string => {
  const options = activityFilterOptions(transactions, pricing);
  const stored = activityViewState();
  const filter = reconcileActivityFilter(stored, options);
  // A repaint can outlive the value a filter axis was set to (a pending
  // transaction settles, a token leaves the feed). Reset the state here, before
  // the toolbar renders, so the select, the applied filter and the rows agree
  // instead of the control reading "All" while the feed stays empty.
  if (filter !== stored) setActivityViewState(filter);
  return dockScreen(
    "activity",
    `<div class="section-head activity-head"${multisig ? ` data-activity-account-id="${escapeHtml(multisig.id)}"` : ""}>
      <h1 aria-label="${th("portfolio.activity.titleOn", { network: status.network })}">${th("portfolio.activity.title")}</h1>
      <div class="header-actions">
        ${iconButton({
          attributes: { id: "activity-export" },
          disabled: transactions.length === 0,
          icon: "receive",
          label: t("portfolio.activity.export"),
        })}
        ${iconButton({
          attributes: { id: "activity-refresh" },
          icon: "refresh",
          label: t("portfolio.activity.refresh"),
        })}
      </div>
    </div>
    ${
      pending.length === 0
        ? ""
        : `<section class="section">
            <div class="menu-list">
              ${walletMenuRow(
                "requests",
                t("portfolio.activity.requestsWaiting"),
                "activity",
                String(pending.length),
              )}
            </div>
          </section>`
    }
    ${relaySection(relays)}
    <section class="section">
      ${historyUnavailable ? emptyState(t("portfolio.activity.historyUnavailable"), "status") : ""}
      ${
        transactions.length === 0
          ? emptyState(activityEmptyCopy(historyUnavailable))
          : `${activityToolbar(filter, options)}
      <section class="activity-summary" id="activity-party-summary" aria-label="${th("portfolio.activity.partySummary")}" hidden></section>
      <div id="activity-feed" data-activity-feed>${activityFeed(transactions, pricing, todayKey, contacts, filter)}</div>
      <p class="activity-empty" id="activity-no-matches" hidden>${th("portfolio.activity.noMatches")}</p>`
      }
      <p id="activity-result" role="status"></p>
    </section>`,
  );
};

/**
 * Renders requests the user explicitly parked from the takeover screen.
 */
export const requestsFlow = (
  pending: readonly PendingApproval[],
  status: WalletStatus,
  preferences: WalletPreferences | null = null,
  picker?: ConnectPicker,
): string =>
  flowHeader(
    t("portfolio.requests.title"),
    status,
    pending.length === 0
      ? t("portfolio.requests.none")
      : t("portfolio.requests.waiting", { count: String(pending.length) }),
  ) +
  flowScreen(
    "requests",
    `<section class="section">
      ${
        pending.length === 0
          ? emptyState(t("portfolio.requests.empty"))
          : `<ul class="request-list">${pending.map((approval) => approvalCard(approval, status, preferences, picker)).join("")}</ul>`
      }
      <p id="approval-result" role="status"></p>
    </section>`,
  );
