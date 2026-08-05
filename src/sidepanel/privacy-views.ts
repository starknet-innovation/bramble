/**
 * Pure templates for STRK20 activation and shielding checkpoints.
 */

import type { TokenBalance, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { TokenConfig, WalletPreferences } from "../storage/preferences-store";
import { emptyState, receipt } from "../ui/content";
import { button } from "../ui/controls";
import { inputControl } from "../ui/fields";
import { flowHeader, flowScreen } from "./parts";
import type { PrivacyJourneyState } from "./privacy-model";
import { liquidDots, liquidDotsFilter } from "./progress-motion";
import { compactAmount, starknetNetworkGlyph, tokenGlyph } from "./token-row";

const shortAddress = (value: string): string =>
  value.length <= 15 ? value : `${value.slice(0, 8)}…${value.slice(-5)}`;

const preparationDetails = (
  journey: Extract<PrivacyJourneyState, { readonly stage: "activate-review" | "deposit-review" }>,
  status: WalletStatus,
): string => {
  const { preparation } = journey;
  const activation = preparation.kind === "register";
  return `<section class="privacy-review">
    <div class="privacy-review-mark">${activation ? tokenGlyph(preparation.poolAddress, "P") : tokenGlyph(preparation.tokenId, preparation.symbol)}</div>
    <div class="privacy-review-title">
      <h2>${activation ? "Activate private balances" : `Shield ${escapeHtml(preparation.amount ?? "0")} ${escapeHtml(preparation.symbol)}`}</h2>
      <p>${activation ? "One-time account registration" : "Move this public balance into the privacy pool"}</p>
    </div>
    ${receipt([
      ...(activation
        ? []
        : [{ label: "Amount", value: `${preparation.amount ?? "0"} ${preparation.symbol}` }]),
      {
        label: "Network",
        value: status.network,
      },
      {
        label: "Submission",
        value:
          preparation.route === "private-relay" ? "Private relay" : "Public account transaction",
      },
      ...(preparation.relayFee
        ? [
            {
              label: "Relay fee",
              value: `${shortAddress(preparation.relayFee.amount)} · token ${shortAddress(preparation.relayFee.token)}`,
              valueStyle: "code" as const,
            },
            {
              label: "Fee recipient",
              value: shortAddress(preparation.relayFee.recipient),
              valueStyle: "code" as const,
            },
          ]
        : []),
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
      { label: "Privacy pool", value: shortAddress(preparation.poolAddress), valueStyle: "code" },
    ])}
    <ul class="privacy-facts">
      ${preparation.summaries.map((summary) => `<li>${escapeHtml(summary)}</li>`).join("")}
    </ul>
    <p class="privacy-warning">${activation ? "Registration is public. It stores the account viewing-key commitment required to discover its private notes." : "Shielding is a public deposit. Future STRK20 transfers can use the resulting private balance without exposing this deposit amount to the recipient."}</p>
    ${button({
      attributes: { id: "privacy-confirm" },
      icon: activation ? "shield" : "lock",
      label: activation ? "Activate private balances" : "Confirm and shield",
    })}
  </section>`;
};

const compose = (
  token: TokenConfig | null,
  balance: TokenBalance | undefined,
  status: WalletStatus,
): string =>
  token
    ? `<form class="privacy-compose" id="privacy-deposit-form">
        <div class="privacy-token-context">
          ${tokenGlyph(token.address, token.symbol)}
          <span><small>Available to shield</small><strong>${escapeHtml(`${compactAmount(balance?.formatted ?? "0")} ${token.symbol}`)}</strong></span>
        </div>
        <label class="privacy-amount">
          <span>Amount</span>
          <span class="privacy-amount-control">
            ${inputControl({
              ariaLabel: `Amount of ${token.symbol} to shield`,
              attributes: { id: "privacy-amount" },
              autocomplete: "off",
              inputmode: "decimal",
              name: "amount",
              placeholder: "0",
            })}
            <strong>${escapeHtml(token.symbol)}</strong>
          </span>
        </label>
        <div class="privacy-shortcuts">
          <span>Balance ${escapeHtml(balance?.formatted ?? "0")}</span>
          <button data-privacy-amount="half" type="button">Half</button>
          <button data-privacy-amount="max" type="button">Max</button>
        </div>
        <div class="privacy-network">
          <span>${starknetNetworkGlyph()}</span>
          <span><small>Destination network</small><strong>${escapeHtml(status.network)}</strong></span>
        </div>
        <p class="privacy-warning">The deposit transaction is public. The shielded notes it creates become visible only when private balances are enabled in this wallet.</p>
        ${button({ icon: "shield", label: "Review shielding", type: "submit" })}
        <p id="privacy-compose-result" role="status" aria-live="assertive"></p>
      </form>`
    : emptyState("This token is no longer tracked on the selected network.");

const working = (journey: Extract<PrivacyJourneyState, { readonly stage: "working" }>): string => `
  <section class="privacy-working" role="status" aria-live="polite">
    ${liquidDots("privacy")}${liquidDotsFilter("privacy")}
    <h2>${journey.kind === "register" ? "Activating private balances" : "Shielding your asset"}</h2>
    <p>${journey.kind === "register" ? "Generating the registration proof, waiting for your authorization, then broadcasting." : "Generating the deposit proof, waiting for your authorization, then broadcasting."}</p>
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
    <h2>${journey.kind === "register" ? "Activation accepted" : `${escapeHtml(journey.symbol)} shielding accepted`}</h2>
    <p>${journey.kind === "register" ? "Starknet accepted the registration. Check its indexer status before shielding a tracked token." : "Starknet accepted the deposit. Your private balance will appear after the privacy indexer catches up."}</p>
    <code>${escapeHtml(shortAddress(journey.hash))}</code>
    <div class="privacy-actions">
      ${journey.kind === "register" ? button({ attributes: { id: "privacy-check-activation" }, icon: "refresh", label: "Check activation" }) : button({ attributes: { id: "privacy-check-balance" }, icon: "refresh", label: "Check private balance" })}
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
  balances: readonly TokenBalance[],
  journey: PrivacyJourneyState,
): string => {
  const tokenId = journey.stage === "idle" ? null : journey.tokenId;
  const token =
    preferences?.tokens.find(
      (candidate) => candidate.id === tokenId && candidate.networkId === status.networkId,
    ) ?? null;
  const balance = balances.find((candidate) => candidate.id === token?.id);
  const body =
    journey.stage === "compose"
      ? compose(token, balance, status)
      : journey.stage === "activate-review" || journey.stage === "deposit-review"
        ? preparationDetails(journey, status)
        : journey.stage === "working"
          ? working(journey)
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
