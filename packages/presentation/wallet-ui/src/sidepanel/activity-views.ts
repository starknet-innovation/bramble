/**
 * Account-scoped activity and parked-request templates. Transactions remain
 * the Activity dock's primary content; snoozed dApp decisions live one level
 * deeper so monitoring and approval are never mixed into one long screen.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import type { MultisigRecord } from "@mc-wallet/multisig/repository";
import type { ActivityEntry } from "@mc-wallet/transactions/activity";
import { emptyState } from "@mc-wallet/ui-kit/content";
import { iconButton } from "@mc-wallet/ui-kit/controls";
import type { PendingApproval, WalletStatus } from "../popup/responses";
import { approvalCard } from "./approval-cards";
import { activityEmptyCopy, transactionRow } from "./home-tabs";
import { dockScreen, flowHeader, flowScreen, walletMenuRow } from "./parts";

const HISTORY_UNAVAILABLE_NOTICE =
  "Couldn't load on-chain history. Showing transactions recorded on this device only — check your connection or RPC endpoint and refresh.";

/**
 * Renders the Activity dock for the active account and network only.
 */
export const activityScreen = (
  pending: readonly PendingApproval[],
  status: WalletStatus,
  transactions: readonly ActivityEntry[],
  historyUnavailable: boolean,
  multisig: MultisigRecord | null = null,
): string =>
  dockScreen(
    "activity",
    `<div class="section-head"${multisig ? ` data-activity-account-id="${escapeHtml(multisig.id)}"` : ""}>
      <div>
        <h2>Activity</h2>
        <p class="hint">Only ${escapeHtml(status.network)} activity for ${multisig ? escapeHtml(multisig.name ?? "this multisig") : "the active account"}.</p>
      </div>
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
          : `<ul class="tx-list">${transactions.map(transactionRow).join("")}</ul>`
      }
      <p id="activity-result" role="status"></p>
    </section>`,
  );

/**
 * Renders requests the user explicitly parked from the takeover screen.
 */
export const requestsFlow = (pending: readonly PendingApproval[], status: WalletStatus): string =>
  flowHeader(
    "Wallet requests",
    status,
    pending.length === 0 ? "Nothing waiting" : `${pending.length} waiting`,
  ) +
  flowScreen(
    "requests",
    `<section class="section">
      <p class="hint">These requests were parked for later. Review the requesting site and exact effect before deciding.</p>
      ${
        pending.length === 0
          ? emptyState("No wallet requests are waiting.")
          : `<ul class="request-list">${pending.map((approval) => approvalCard(approval, status)).join("")}</ul>`
      }
      <p id="approval-result" role="status"></p>
    </section>`,
  );
