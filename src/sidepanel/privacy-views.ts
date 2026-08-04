/**
 * Pure templates for STRK20 activation and shielding checkpoints.
 */

import type { TokenBalance, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { TokenConfig, WalletPreferences } from "../storage/preferences-store";
import { emptyState, receipt } from "../ui/content";
import { button, iconButton } from "../ui/controls";
import { inputControl } from "../ui/fields";
import { icon } from "./icons";
import { flowHeader, flowScreen } from "./parts";
import type { PrivacyDisclosureState, PrivacyJourneyState } from "./privacy-model";
import { liquidDots, liquidDotsFilter } from "./progress-motion";
import { compactAmount, tokenGlyph } from "./token-row";

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
    ${
      activation
        ? ""
        : `<label class="privacy-amount privacy-review-amount">
      <span>Amount</span>
      <span class="privacy-amount-control">
        ${inputControl({
          ariaLabel: `Amount of ${preparation.symbol} to shield`,
          attributes: { id: "privacy-review-amount" },
          autocomplete: "off",
          inputmode: "decimal",
          name: "reviewAmount",
          value: preparation.amount ?? "0",
        })}
        <strong>${escapeHtml(preparation.symbol)}</strong>
      </span>
    </label>`
    }
    ${receipt([
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
    <p id="privacy-review-result" role="status" aria-live="assertive"></p>
    ${button({
      attributes: { id: "privacy-confirm" },
      icon: activation ? "shield" : "lock",
      label: activation ? "Activate private balances" : "Confirm and shield",
    })}
  </section>`;
};

/**
 * The public warning shown per direction; the flip binding swaps them.
 */
export const SHIELD_WARNING =
  "The deposit transaction is public. The shielded notes it creates become visible only when private balances are enabled in this wallet.";
/**
 * Unshield-direction warning shown when private sits on top.
 */
export const UNSHIELD_WARNING =
  "Withdrawing moves shielded balance back to this public address, making the amount visible on-chain.";

const composeBox = (
  role: "destination" | "source",
  domain: "private" | "public",
  glyph: string,
  amount: string,
): string => `
        <div class="privacy-box" data-privacy-box="${role}">
          ${glyph}
          <span><small data-privacy-box-label="${role}">${domain === "public" ? "Public balance" : "Private balance"}</small><strong data-privacy-box-value="${role}">${escapeHtml(amount)}</strong></span>
        </div>`;

const compose = (
  token: TokenConfig | null,
  balance: TokenBalance | undefined,
  privateFormatted: string,
): string => {
  if (!token) {
    return emptyState("This token is no longer tracked on the selected network.");
  }
  const publicAmount = `${compactAmount(balance?.formatted ?? "0")} ${token.symbol}`;
  const privateAmount = `${compactAmount(privateFormatted)} ${token.symbol}`;
  return `<form class="privacy-compose" id="privacy-deposit-form" data-direction="shield"
        data-public-amount="${escapeHtml(publicAmount)}" data-private-amount="${escapeHtml(privateAmount)}"
        data-public-formatted="${escapeHtml(balance?.formatted ?? "0")}" data-private-formatted="${escapeHtml(privateFormatted)}">
        ${composeBox("source", "public", tokenGlyph(token.address, token.symbol), publicAmount)}
        <label class="privacy-amount">
          <span>Amount</span>
          <span class="privacy-amount-control">
            ${inputControl({
              ariaLabel: `Amount of ${token.symbol} to move`,
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
          <span>Balance <span data-privacy-source-formatted>${escapeHtml(balance?.formatted ?? "0")}</span></span>
          <button data-privacy-amount="half" type="button">Half</button>
          <button data-privacy-amount="max" type="button">Max</button>
        </div>
        <div class="privacy-flip-row">
          ${iconButton({
            attributes: { id: "privacy-flip" },
            icon: "swap",
            label: "Switch between shield and unshield",
            variant: "ghost",
          })}
        </div>
        ${composeBox("destination", "private", `<span class="privacy-box-lock">${icon("lock")}</span>`, privateAmount)}
        <p class="privacy-warning" data-privacy-warning>${SHIELD_WARNING}</p>
        ${button({ attributes: { id: "privacy-review-submit" }, label: "Review shielding", type: "submit" })}
        <p id="privacy-compose-result" role="status" aria-live="assertive"></p>
      </form>`;
};

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
  privacy: PrivacyDisclosureState = { error: null, loading: false, value: null },
): string => {
  const tokenId = journey.stage === "idle" ? null : journey.tokenId;
  const token =
    preferences?.tokens.find(
      (candidate) => candidate.id === tokenId && candidate.networkId === status.networkId,
    ) ?? null;
  const balance = balances.find((candidate) => candidate.id === token?.id);
  const privateFormatted =
    privacy.value?.balances.find((entry) => entry.tokenId === token?.id)?.formatted ?? "0";
  const body =
    journey.stage === "compose"
      ? compose(token, balance, privateFormatted)
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
      journey.stage === "activate-review"
        ? "Go private"
        : journey.stage === "compose"
          ? "Shield"
          : "Private balance",
      status,
      token?.symbol ?? "STRK20",
    ) + flowScreen("privacy", `<section class="section privacy-flow">${body}</section>`)
  );
};
