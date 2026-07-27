/**
 * Pure templates for the staged Send journey. The binding in transfer-ui.ts
 * owns state and toggles these regions without replacing the form, so review,
 * Ledger approval, broadcast, and success remain visible across shell repaints.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState, receipt } from "../ui/content";
import { button } from "../ui/controls";
import { selectField, textField } from "../ui/fields";
import { icon } from "./icons";
import { accountLabel, flowHeader, flowScreen, noAccountEmpty } from "./parts";

const sendProgress = (): string => `
  <ol class="send-progress" aria-label="Send progress">
    <li data-send-step="details" data-state="active" aria-current="step">
      <span class="send-step-mark">1</span><span>Details</span>
    </li>
    <li data-send-step="review" data-state="pending">
      <span class="send-step-mark">2</span><span>Review</span>
    </li>
    <li data-send-step="sign" data-state="pending">
      <span class="send-step-mark">3</span><span>Sign</span>
    </li>
    <li data-send-step="sent" data-state="pending">
      <span class="send-step-mark">4</span><span>Sent</span>
    </li>
  </ol>`;

const workingStage = (): string => `
  <section class="send-working" id="send-working" role="status" aria-live="polite" hidden>
    <span class="send-working-mark" aria-hidden="true">${icon("refresh")}</span>
    <div class="send-working-copy">
      <h2 id="send-working-title">Authorizing transaction</h2>
      <p id="send-working-copy">Keep this window open while MC Wallet completes the send.</p>
    </div>
    <ol class="send-task-list" aria-label="Transaction status">
      <li data-send-task="review" data-state="done"><span></span><span id="send-task-review-label">Review locked</span></li>
      <li data-send-task="authorize" data-state="active"><span></span><span id="send-task-authorize-label">Authorize</span></li>
      <li data-send-task="broadcast" data-state="pending"><span></span><span id="send-task-broadcast-label">Broadcast</span></li>
    </ol>
  </section>`;

const successStage = (): string => `
  <section class="send-success" id="send-success" role="status" aria-live="polite" hidden>
    <span class="send-success-mark" aria-hidden="true">
      <svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg>
    </span>
    <div class="send-success-copy">
      <h2>Transaction sent</h2>
      <p id="send-success-summary"></p>
      <code id="send-success-hash"></code>
      <p class="hint">Starknet accepted the broadcast. Confirmation is tracked under Activity.</p>
    </div>
    <div class="send-actions">
      ${button({
        attributes: { id: "send-view-activity" },
        icon: "activity",
        label: "View activity",
      })}
      ${button({
        attributes: { id: "send-another" },
        label: "Send another",
        variant: "secondary",
      })}
    </div>
  </section>`;

/**
 * Renders Send as four explicit stages: details, review, authorization, and
 * submitted. Account provenance is exposed only as a non-secret signer hint so
 * the binding can provide accurate software-versus-Ledger progress copy.
 */
export const sendFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string => {
  const tokens = preferences?.tokens.filter((token) => token.networkId === status.networkId) ?? [];
  const addresses =
    preferences?.addressBook.filter((entry) => entry.networkId === status.networkId) ?? [];
  const canSend = account !== null && tokens.length > 0;
  const signer = account?.derivation.kind === "ledger" ? "ledger" : "software";
  return (
    flowHeader("Send", status, account ? `From ${accountLabel(account.address)}` : "") +
    flowScreen(
      "send",
      `<section class="section send-flow">
        ${account ? "" : noAccountEmpty(status)}
        ${
          account && tokens.length === 0
            ? emptyState("No tokens are tracked on this network yet, so nothing can be sent.")
            : ""
        }
        <form id="transfer-form" data-signer="${signer}">
          <input name="accountId" type="hidden" value="${escapeHtml(account?.id ?? "")}" />
          ${sendProgress()}
          <div class="send-stage-frame">
            <section class="send-stage" id="send-details">
              ${selectField({
                disabled: !canSend,
                label: "Token",
                name: "tokenId",
                options: tokens.map((token) => ({
                  attributes: { "data-symbol": token.symbol },
                  label: `${token.symbol} — ${token.name}`,
                  value: token.id,
                })),
              })}
              ${textField({
                autocomplete: "off",
                className: "mono",
                disabled: !canSend,
                hint: "Paste an address or choose a saved contact.",
                label: "Recipient",
                list: "address-book",
                name: "recipient",
                placeholder: "0x…",
                required: true,
                spellcheck: false,
              })}
              ${textField({
                autocomplete: "off",
                className: "mono",
                disabled: !canSend,
                inputmode: "decimal",
                label: "Amount",
                name: "amount",
                placeholder: "0.0",
                required: true,
              })}
              ${selectField({
                disabled: !canSend,
                label: "Speed",
                name: "speed",
                options: [
                  { label: "Standard", value: "standard" },
                  { label: "Fast — up to 1.5× the estimated fee", value: "fast" },
                ],
                selected: "standard",
              })}
              ${button({
                attributes: { id: "send-review-button" },
                disabled: !canSend,
                icon: "send",
                label: "Review send",
                type: "submit",
              })}
            </section>
            <section class="send-stage" id="send-review-stage" hidden>
              <div class="send-review-head">
                <div><p class="context-label">Review ready</p><h2>Check every detail</h2></div>
                ${button({
                  attributes: { id: "send-edit" },
                  label: "Edit",
                  size: "small",
                  variant: "ghost",
                })}
              </div>
              ${receipt([], { id: "send-review-receipt" })}
              <div id="review-panel"></div>
              <div class="send-actions">
                <button id="send-confirm-button" type="submit" ${canSend ? "" : "disabled"}>${icon("check")}<span id="send-confirm-label">Confirm and send</span></button>
              </div>
            </section>
            ${workingStage()}
            ${successStage()}
            <p class="send-result" id="transfer-result" role="status" aria-live="assertive"></p>
          </div>
        </form>
        <datalist id="address-book">${addresses.map((entry) => `<option value="${escapeHtml(entry.address)}">${escapeHtml(entry.label)}</option>`).join("")}</datalist>
      </section>`,
    )
  );
};
