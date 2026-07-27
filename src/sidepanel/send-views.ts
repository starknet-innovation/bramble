/**
 * Pure templates for the staged Send journey. The binding in transfer-ui.ts
 * owns state and toggles these regions without replacing the form, so review,
 * Ledger approval, broadcast, and success remain visible across shell repaints.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
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
      <button id="send-view-activity" type="button">${icon("activity")}View activity</button>
      <button id="send-another" class="secondary" type="button">Send another</button>
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
            ? '<p class="empty">No tokens are tracked on this network yet, so nothing can be sent.</p>'
            : ""
        }
        <form id="transfer-form" data-signer="${signer}">
          <input name="accountId" type="hidden" value="${escapeHtml(account?.id ?? "")}" />
          ${sendProgress()}
          <div class="send-stage-frame">
            <section class="send-stage" id="send-details">
              <label><span>Token</span>
                <select name="tokenId" ${canSend ? "" : "disabled"}>
                  ${tokens.map((token) => `<option data-symbol="${escapeHtml(token.symbol)}" value="${escapeHtml(token.id)}">${escapeHtml(token.symbol)} — ${escapeHtml(token.name)}</option>`).join("")}
                </select>
              </label>
              <label><span>Recipient</span>
                <input class="mono" name="recipient" list="address-book" placeholder="0x…" required autocomplete="off" spellcheck="false" ${canSend ? "" : "disabled"} />
                <span class="hint">Paste an address or choose a saved contact.</span>
              </label>
              <label><span>Amount</span>
                <input class="mono" name="amount" inputmode="decimal" placeholder="0.0" required autocomplete="off" ${canSend ? "" : "disabled"} />
              </label>
              <label><span>Speed</span>
                <select name="speed" ${canSend ? "" : "disabled"}>
                  <option value="standard" selected>Standard</option>
                  <option value="fast">Fast — up to 1.5× the estimated fee</option>
                </select>
              </label>
              <button id="send-review-button" type="submit" ${canSend ? "" : "disabled"}>${icon("send")}Review send</button>
            </section>
            <section class="send-stage" id="send-review-stage" hidden>
              <div class="send-review-head">
                <div><p class="context-label">Review ready</p><h2>Check every detail</h2></div>
                <button id="send-edit" class="ghost small" type="button">Edit</button>
              </div>
              <dl class="receipt" id="send-review-receipt"></dl>
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
