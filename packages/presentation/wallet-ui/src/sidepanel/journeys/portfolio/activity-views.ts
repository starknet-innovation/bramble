/**
 * Account-scoped activity and parked-request templates. Transactions remain
 * the Activity dock's primary content; snoozed dApp decisions live one level
 * deeper so monitoring and approval are never mixed into one long screen.
 */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { emptyState } from "@bramble/ui-kit/content";
import { iconButton } from "@bramble/ui-kit/controls";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { dockScreen, flowHeader, flowScreen, walletMenuRow } from "../../shared/parts";
import { approvalCard } from "../approvals/approval-cards";
import type { ActivityPricing } from "./activity-format";
import { activityEmptyCopy, transactionGroups } from "./home-tabs";

const HISTORY_UNAVAILABLE_NOTICE =
  "Couldn't load on-chain history. Showing transactions recorded on this device only — check your connection or RPC endpoint and refresh.";

/**
 * Renders the Activity dock for the active account and network only. `pricing`
 * (the display currency, cached prices, and tracked tokens) lets each row show
 * a signed fiat delta; without it rows show asset amounts alone. `todayKey`
 * (the current UTC day, from the composition root's clock) lets the two most
 * recent days read as Today and Yesterday; without it every day shows its date.
 */
export const activityScreen = (
  pending: readonly PendingApproval[],
  status: WalletStatus,
  transactions: readonly ActivityEntry[],
  historyUnavailable: boolean,
  multisig: ArgentMultisigRecord | null = null,
  pricing?: ActivityPricing,
  todayKey: number | null = null,
): string =>
  dockScreen(
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
          : transactionGroups(transactions, pricing, todayKey)
      }
      <p id="activity-result" role="status"></p>
    </section>`,
  );

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
