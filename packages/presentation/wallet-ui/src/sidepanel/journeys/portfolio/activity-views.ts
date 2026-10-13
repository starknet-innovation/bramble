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
import type { ActivityEntry, ActivityStatus } from "@bramble/transactions/activity";
import { emptyState } from "@bramble/ui-kit/content";
import { iconButton, segmentedControl } from "@bramble/ui-kit/controls";
import { inputControl, selectField } from "@bramble/ui-kit/fields";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { dockScreen, flowHeader, flowScreen, walletMenuRow } from "../../shared/parts";
import { approvalCard } from "../approvals/approval-cards";
import {
  type ActivityContact,
  type ActivityFilter,
  type ActivityFilterOptions,
  activityAmountComparator,
  activityFilterOptions,
  reconcileActivityFilter,
} from "./activity-filter";
import type { ActivityPricing } from "./activity-format";
import { activityViewState, setActivityViewState } from "./activity-view-state";
import { activityEmptyCopy, transactionGroups, transactionList } from "./home-tabs";

const HISTORY_UNAVAILABLE_NOTICE =
  "Couldn't load on-chain history. Showing transactions recorded on this device only — check your connection or RPC endpoint and refresh.";

// Status words as the filter offers them. Pre-confirmed carries its own
// spelling, matching the row.
const STATUS_TEXT: Readonly<Record<ActivityStatus, string>> = {
  accepted: "Accepted",
  pending: "Pending",
  preconfirmed: "Pre-confirmed",
  rejected: "Rejected",
  reverted: "Reverted",
};

// The filter, sort and search controls. Each select option comes from the
// options the feed currently offers, so a control never offers a value that
// would match nothing, and every value is selected from the reconciled filter.
const activityToolbar = (filter: ActivityFilter, options: ActivityFilterOptions): string => {
  return `<div class="activity-toolbar">
    <label class="activity-search"><span>Search</span>${inputControl({
      ariaLabel: "Search activity by address or saved name",
      attributes: { id: "activity-search" },
      autocomplete: "off",
      className: "mono",
      placeholder: "Address or saved name",
      spellcheck: false,
      type: "search",
      value: filter.query,
    })}</label>
    ${selectField({
      attributes: { id: "activity-type" },
      label: "Type",
      name: "activity-type",
      options: [
        { label: "All types", value: "all" },
        ...options.actions.map((action) => ({ label: action, value: action })),
      ],
      selected: filter.action,
    })}
    ${selectField({
      attributes: { id: "activity-status" },
      label: "Status",
      name: "activity-status",
      options: [
        { label: "All statuses", value: "all" },
        ...options.statuses.map((status) => ({ label: STATUS_TEXT[status], value: status })),
      ],
      selected: filter.status,
    })}
    ${selectField({
      attributes: { id: "activity-token" },
      label: "Token",
      name: "activity-token",
      options: [
        { label: "All tokens", value: "all" },
        ...options.tokens.map((token) => ({ label: token.label, value: token.key })),
      ],
      selected: filter.token,
    })}
    ${segmentedControl("Sort", [
      {
        attributes: { "data-activity-sort": "date" },
        label: "Date",
        pressed: filter.sort === "date",
      },
      {
        attributes: { "data-activity-sort": "amount" },
        label: "Amount",
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
      <h1 aria-label="Activity on ${escapeHtml(status.network)}">Activity</h1>
      <div class="header-actions">
        ${iconButton({
          attributes: { id: "activity-export" },
          disabled: transactions.length === 0,
          icon: "receive",
          label: "Export CSV",
        })}
        ${iconButton({
          attributes: { id: "activity-refresh" },
          icon: "refresh",
          label: "Refresh transactions",
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
                "Requests waiting for review",
                "activity",
                String(pending.length),
              )}
            </div>
          </section>`
    }
    <section class="section">
      ${historyUnavailable ? emptyState(HISTORY_UNAVAILABLE_NOTICE, "status") : ""}
      ${
        transactions.length === 0
          ? emptyState(activityEmptyCopy(historyUnavailable))
          : `${activityToolbar(filter, options)}
      <section class="activity-summary" id="activity-party-summary" aria-label="Counterparty summary" hidden></section>
      <div id="activity-feed" data-activity-feed>${activityFeed(transactions, pricing, todayKey, contacts, filter)}</div>
      <p class="activity-empty" id="activity-no-matches" hidden>No matching transactions.</p>`
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
): string =>
  flowHeader(
    "Wallet requests",
    status,
    pending.length === 0 ? "Nothing waiting" : `${pending.length} waiting`,
  ) +
  flowScreen(
    "requests",
    `<section class="section">
      ${
        pending.length === 0
          ? emptyState("No wallet requests are waiting.")
          : `<ul class="request-list">${pending.map((approval) => approvalCard(approval, status, preferences)).join("")}</ul>`
      }
      <p id="approval-result" role="status"></p>
    </section>`,
  );
