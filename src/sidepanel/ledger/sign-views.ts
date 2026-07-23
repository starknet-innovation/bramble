/**
 * Pure device-prompt templates for the side-panel Ledger signing runtime. A
 * logic-free string builder rendered as a takeover while a keyless-Ledger
 * signature is pending: it shows which account/index is signing and the current
 * device phase (connect / confirm / error) with its controls. All dynamic text
 * is escaped; the controller in ./sign-session.ts owns the state and bindings.
 */
import type { LedgerSignRequestSummary, WalletStatus } from "../../popup/responses";
import { escapeHtml } from "../../shared/html";
import { ledgerAccountIndexOfPath } from "../../starknet/ledger-path";
import { icon } from "../icons";
import { accountLabel } from "../parts";
import type { LedgerSignView } from "./sign-session";

const addressOfAccountId = (accountId: string): string => accountId.split(":")[1] ?? accountId;

// The account/index line so the user can see exactly which key the device is
// being asked to sign with (the index is recovered from the stored path).
const signerLine = (request: LedgerSignRequestSummary): string => {
  const index = ledgerAccountIndexOfPath(request.path);
  const suffix = index === null ? "" : ` · Account ${index}`;
  return `<p class="takeover-copy"><code>${escapeHtml(accountLabel(addressOfAccountId(request.accountId)))}</code>${escapeHtml(suffix)}</p>`;
};

const phaseBody = (view: LedgerSignView): string => {
  const phase = view.phase;
  if (phase.kind === "connect") {
    return `<p class="hint">Connect your Ledger and open the Starknet app to sign this request.</p>
      <div class="row">
        <button class="primary" data-ledger-connect type="button">${icon("shield")}Connect your Ledger</button>
        <button class="ghost small" data-ledger-cancel type="button">Cancel</button>
      </div>`;
  }
  if (phase.kind === "confirming") {
    return `<p class="hint">Review the request on your Ledger, then approve it on the device.</p>
      <button class="ghost small" data-ledger-cancel type="button">Cancel</button>`;
  }
  if (phase.kind === "devices") {
    return `<p class="hint">More than one Ledger is connected. Choose the device for this account.</p>
      <div class="add-account-chooser" role="group" aria-label="Connected Ledger devices">
        ${phase.devices
          .map(
            (device) =>
              `<button class="menu-row" data-ledger-device="${escapeHtml(device.id)}" type="button">
                <span class="menu-icon">${icon("shield")}</span>
                <span class="menu-copy"><strong>${escapeHtml(device.label)}</strong></span>
                <span class="menu-chevron">${icon("chevronRight")}</span>
              </button>`,
          )
          .join("")}
      </div>
      <button class="ghost small" data-ledger-cancel type="button">Cancel</button>`;
  }
  return `<p class="review-flag">${escapeHtml(phase.message)}</p>
    <div class="row">
      <button class="secondary" data-ledger-retry type="button">${icon("refresh")}Try again</button>
      <button class="ghost small" data-ledger-cancel type="button">Cancel</button>
    </div>`;
};

const phaseTitle: Readonly<Record<LedgerSignView["phase"]["kind"], string>> = {
  confirming: "Confirm on your Ledger",
  connect: "Connect your Ledger",
  devices: "Choose your Ledger",
  error: "Ledger could not sign",
};

/**
 * Renders the Ledger sign takeover for one pending device sign. Returns the
 * header + screen markup the shell splices in ahead of the dashboard, so the
 * request is front and centre wherever the user lands. Callers pass the live
 * controller view; a `null` view means no prompt (the caller renders nothing).
 */
export const ledgerSignScreen = (view: LedgerSignView, status: WalletStatus): string => `
  <header class="flow-header">
    <div class="flow-title">
      <h1>${escapeHtml(phaseTitle[view.phase.kind])}</h1>
      <p>${escapeHtml(status.network)}</p>
    </div>
    <span class="pill"><span class="dot"></span>${escapeHtml(status.network)}</span>
  </header>
  <main class="screen flow" id="wallet-screen-ledger-sign" tabindex="-1">
    <div class="review-panel" role="note">
      ${signerLine(view.request)}
      ${phaseBody(view)}
    </div>
    <p id="ledger-sign-result" role="status"></p>
  </main>`;
