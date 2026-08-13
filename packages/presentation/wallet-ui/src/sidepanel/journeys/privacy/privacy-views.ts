/**
 * Pure templates for the STRK20 activation checkpoints.
 *
 * Activation is all this surface renders. Shielding, unshielding, and private
 * sends are composed in the Send flow as a send between two balances, so no
 * amount, direction, or destination is chosen here.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { emptyState, receipt } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { flowHeader, flowScreen, formatFri } from "../../shared/parts";
import { liquidDots, liquidDotsFilter } from "../../shared/progress-motion";
import { tokenGlyph } from "../portfolio/token-row";
import type { PrivacyJourneyState } from "./privacy-model";

const shortAddress = (value: string): string =>
  value.length <= 15 ? value : `${value.slice(0, 8)}…${value.slice(-5)}`;

const preparationDetails = (
  journey: Extract<PrivacyJourneyState, { readonly stage: "activate-review" }>,
  status: WalletStatus,
): string => {
  const { preparation } = journey;
  return `<section class="privacy-review">
    <div class="privacy-review-mark">${tokenGlyph(preparation.poolAddress, "P")}</div>
    <div class="privacy-review-title">
      <h2>Activate private balances</h2>
      <p>One-time account registration</p>
    </div>
    <details class="send-review-disclosure">
      <summary><span>Transaction details</span>${icon("chevronDown")}</summary>
      <div class="send-review-disclosure-body">
    ${receipt([
      { label: "Network", value: status.network },
      {
        label: "Submission",
        value:
          preparation.route === "private-relay" ? "Private relay" : "Public account transaction",
      },
      ...(preparation.authorization
        ? [
            {
              label: "Public approval calls",
              value: String(preparation.authorization.publicCallCount),
            },
            {
              label: "Authorization window",
              value: `${shortAddress(preparation.authorization.executeAfter)} → ${shortAddress(preparation.authorization.executeBefore)}`,
              valueStyle: "code" as const,
            },
            {
              label: "Authorization caller",
              value: shortAddress(preparation.authorization.caller),
              valueStyle: "code" as const,
            },
          ]
        : []),
      ...(preparation.poolFeeFri
        ? [{ label: "Pool fee", value: `${formatFri(preparation.poolFeeFri)} from public STRK` }]
        : []),
      ...(preparation.networkFee
        ? [{ label: "Network fee", value: formatFri(preparation.networkFee.overallFee) }]
        : []),
      { label: "Privacy pool", value: shortAddress(preparation.poolAddress), valueStyle: "code" },
    ])}
    <ul class="privacy-facts">
      ${preparation.summaries.map((summary) => `<li>${escapeHtml(summary)}</li>`).join("")}
    </ul>
    <p class="privacy-warning">Registration is public. It stores the account viewing-key commitment required to discover its private notes.</p>
      </div>
    </details>
    <p id="privacy-review-result" role="status" aria-live="assertive"></p>
    ${button({
      attributes: { id: "privacy-confirm" },
      icon: "shield",
      label: "Activate private balances",
    })}
  </section>`;
};

const working = (): string => `
  <section class="privacy-working" role="status" aria-live="polite">
    ${liquidDots("privacy")}${liquidDotsFilter("privacy")}
    <h2>Activating private balances</h2>
    <p>Generating the registration proof, waiting for your authorization, then broadcasting.</p>
    <ol class="privacy-task-list">
      <li data-state="done"><span></span>Review complete</li>
      <li data-state="active"><span></span>Generate proof and authorize</li>
      <li data-state="pending"><span></span>Broadcast to Starknet</li>
      <li data-state="pending"><span></span>Discover private balance</li>
    </ol>
    <p class="hint">Keep the wallet open. Proving may take longer than a normal token transfer.</p>
  </section>`;

const success = (journey: Extract<PrivacyJourneyState, { readonly stage: "success" }>): string => `
  <section class="privacy-outcome privacy-success" role="status" aria-live="polite">
    <span class="privacy-outcome-mark" aria-hidden="true"><svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg></span>
    <h2>Registered</h2>
    <p>You can now shield ${escapeHtml(journey.symbol)} from its asset screen.</p>
    <div class="privacy-actions">
      ${button({ attributes: { id: "privacy-done" }, label: "Back to wallet", variant: "secondary" })}
      ${button({ attributes: { "data-view": "activity" }, icon: "activity", label: "View activity", variant: "secondary" })}
    </div>
  </section>`;

const failure = (journey: Extract<PrivacyJourneyState, { readonly stage: "failure" }>): string => `
  <section class="privacy-outcome privacy-failure" role="alert" aria-live="assertive">
    <span class="privacy-outcome-mark" aria-hidden="true"><svg viewBox="0 0 56 56"><circle class="send-failure-ring" cx="28" cy="28" r="25" /><path class="send-failure-mark" d="m20 20 16 16m0-16L20 36" /></svg></span>
    <h2>Private transaction not completed</h2>
    <p>${escapeHtml(journey.error)}</p>
    <p class="hint">No retry was submitted automatically. Check that your account is deployed and recent balance changes have settled, then try again.</p>
    <div class="privacy-actions">
      ${button({ attributes: { id: "privacy-retry" }, label: "Try again" })}
      ${button({ attributes: { id: "privacy-cancel" }, label: "Back to wallet", variant: "secondary" })}
    </div>
  </section>`;

/**
 * Renders the current privacy checkpoint using the selected tracked token.
 */
export const privacyFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  journey: PrivacyJourneyState,
): string => {
  const tokenId = journey.stage === "idle" ? null : journey.tokenId;
  const token =
    preferences?.tokens.find(
      (candidate) => candidate.id === tokenId && candidate.networkId === status.networkId,
    ) ?? null;
  const body =
    journey.stage === "activate-review"
      ? preparationDetails(journey, status)
      : journey.stage === "working"
        ? working()
        : journey.stage === "success"
          ? success(journey)
          : journey.stage === "failure"
            ? failure(journey)
            : emptyState("Choose an asset to begin.");
  return (
    flowHeader(
      journey.stage === "activate-review" ? "Go private" : "Private balance",
      status,
      token?.symbol ?? "STRK20",
    ) + flowScreen("privacy", `<section class="section privacy-flow">${body}</section>`)
  );
};
