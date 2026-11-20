/**
 * Full-screen approval takeover: the proactive surface for dapp requests. The
 * background opens the side panel on any approval-worthy message (see
 * ../background/approval-surface.ts); this screen makes the panel itself
 * proactive — while an unsnoozed request is pending, every dock view renders
 * the request front and centre with its decision controls, exactly where the
 * user lands, instead of parking it behind an Activity badge. This supersedes
 * both dock and in-progress flow screens so external requests cannot hide
 * behind stale wallet navigation.
 *
 * The user is never trapped: "Not now" snoozes the shown request for this
 * panel session, parking it in the Activity request list (its badge stays),
 * and the wallet becomes fully usable again. New requests re-take the screen.
 * A new request always re-takes the screen.
 */

import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { button } from "@bramble/ui-kit/controls";
import { t, th } from "../../../i18n/messages";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import type { WalletView } from "../../shared/parts";
import { liquidDots, liquidDotsFilter } from "../../shared/progress-motion";
import { walletViewLabel } from "../../shared/view-labels";
import { approvalCard } from "./approval-cards";
import type { ConnectPicker } from "./approval-connect-card";

/**
 * Pending approvals that should take the screen: everything not snoozed this
 * panel session, oldest first (queue order).
 */
export const actionableApprovals = (
  pending: readonly PendingApproval[],
  snoozedIds: readonly string[],
): readonly PendingApproval[] => pending.filter((approval) => !snoozedIds.includes(approval.id));

/**
 * Renders the takeover for the front of the request queue. Callers guarantee
 * `actionable` is non-empty. The request card carries the full request and its
 * approve/deny controls (shared with the Activity list, so one binding path
 * decides requests everywhere); this screen adds the focused chrome — a clear
 * title, the network context, queue position, and the "Not now" escape hatch.
 */
export const approvalTakeover = (
  actionable: readonly PendingApproval[],
  status: WalletStatus,
  pausedView: WalletView,
  preferences: WalletPreferences | null = null,
  picker?: ConnectPicker,
): string => {
  const first = actionable[0];
  if (!first) {
    return "";
  }
  const queue =
    actionable.length > 1
      ? `<p class="takeover-queue">${th(
          actionable.length === 2 ? "approval.screen.queueOne" : "approval.screen.queueMany",
          { count: String(actionable.length - 1) },
        )}</p>`
      : "";
  const pausedTask = walletViewLabel(pausedView);
  return `
  <header class="flow-header approval-header">
    <div class="flow-title">
      <p class="eyebrow">${th("approval.screen.eyebrow")}</p>
      <h1 id="approval-title">${th("approval.screen.title")}</h1>
    </div>
    <span class="takeover-network"><span class="dot"></span>${escapeHtml(status.network)}</span>
  </header>
  <section class="screen flow approval-takeover" id="wallet-screen-approval-takeover" aria-labelledby="approval-title" tabindex="-1">
    <section class="takeover-continuity" role="note" aria-label="Paused wallet task">
      <span class="takeover-continuity-mark">${icon("shield")}</span>
      <span><strong>${th("approval.screen.paused", { task: pausedTask })}</strong></span>
    </section>
    <ul class="request-list">${approvalCard(first, status, preferences, picker)}</ul>
    <section class="approval-live" id="approval-live" role="status" aria-live="polite" hidden>
      <span class="approval-live-mark">${liquidDots("approval", true)}${liquidDotsFilter("approval")}</span>
      <div>
        <strong id="approval-live-title">${th("approval.decision.approvedTitle")}</strong>
        <p id="approval-live-copy">${th("approval.screen.liveCopy")}</p>
      </div>
    </section>
    ${queue}
    <div class="takeover-foot">
      ${button({
        attributes: { "data-approval-later": first.id },
        label: t("approval.screen.later"),
        size: "small",
        variant: "ghost",
      })}
    </div>
    <p id="approval-result" role="status"></p>
  </section>`;
};
