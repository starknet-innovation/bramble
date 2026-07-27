/**
 * Pure device-prompt templates for the side-panel Ledger signing runtime. The
 * screen is a progress takeover, not a generic alert: every transport, app,
 * account, device-approval, and handoff phase names the work currently under
 * way. All dynamic text is escaped; ./sign-session.ts owns state and bindings.
 */
import type { LedgerSignRequestSummary, WalletStatus } from "../../popup/responses";
import { escapeHtml } from "../../shared/html";
import { ledgerAccountIndexOfPath } from "../../starknet/ledger-path";
import { icon } from "../icons";
import { accountLabel } from "../parts";
import type { LedgerSignView } from "./sign-session";

const addressOfAccountId = (accountId: string): string => accountId.split(":")[1] ?? accountId;

const signerLine = (request: LedgerSignRequestSummary): string => {
  const index = ledgerAccountIndexOfPath(request.path);
  const suffix = index === null ? "" : `<span>Account ${index}</span>`;
  return `<div class="ledger-signer-line">
    <span>Signing with</span>
    <code>${escapeHtml(accountLabel(addressOfAccountId(request.accountId)))}</code>
    ${suffix}
  </div>`;
};

const cancelButton = (): string =>
  '<button class="ghost small" data-ledger-cancel type="button">Cancel transaction</button>';

const phaseBody = (view: LedgerSignView): string => {
  const phase = view.phase;
  if (phase.kind === "discovering") {
    return `<p>Checking for a Ledger already connected to this browser.</p>${cancelButton()}`;
  }
  if (phase.kind === "connect") {
    return `<p>Connect your Ledger, unlock it, and open the Starknet app. Your transaction stays safely paused until the device is ready.</p>
      <div class="ledger-phase-actions">
        <button class="primary" data-ledger-connect type="button">${icon("shield")}Connect Ledger</button>
        ${cancelButton()}
      </div>`;
  }
  if (phase.kind === "connecting") {
    return `<p>Complete the secure device chooser in the Ledger tab. This transaction resumes automatically after connection.</p>${cancelButton()}`;
  }
  if (phase.kind === "checking") {
    return `<p>Reading the Starknet app version and checking that the device is ready to sign.</p>${cancelButton()}`;
  }
  if (phase.kind === "verifying") {
    return `<p>Matching the device public key to this wallet account. A different Ledger fails closed before signing.</p>${cancelButton()}`;
  }
  if (phase.kind === "confirming") {
    return `<p>Approve the request on your Ledger. The wallet verifies the returned signature before it can be used.</p>${cancelButton()}`;
  }
  if (phase.kind === "submitting") {
    return "<p>Signature received. MC Wallet is completing its final verification and returning it to the transaction.</p>";
  }
  if (phase.kind === "devices") {
    return `<p>More than one Ledger is connected. Choose the device that holds this account.</p>
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
      ${cancelButton()}`;
  }
  return `<p class="review-flag" role="alert">${escapeHtml(phase.message)}</p>
    <div class="ledger-phase-actions">
      <button class="secondary" data-ledger-retry type="button">${icon("refresh")}Try again</button>
      ${cancelButton()}
    </div>`;
};

const phaseTitle: Readonly<Record<LedgerSignView["phase"]["kind"], string>> = {
  checking: "Checking the Starknet app",
  confirming: "Approve on your Ledger",
  connect: "Ledger connection needed",
  connecting: "Connecting securely",
  devices: "Choose your Ledger",
  discovering: "Finding your Ledger",
  error: "Ledger needs attention",
  submitting: "Finishing securely",
  verifying: "Verifying the right account",
};

const phaseIndex = (view: LedgerSignView): number => {
  const kind = view.phase.kind;
  if (kind === "error") {
    return -1;
  }
  if (kind === "checking" || kind === "verifying") {
    return 1;
  }
  if (kind === "confirming") {
    return 2;
  }
  if (kind === "submitting") {
    return 3;
  }
  return 0;
};

const ledgerProgress = (view: LedgerSignView): string => {
  const activeIndex = phaseIndex(view);
  const labels = ["Connect", "Verify account", "Approve", "Finish"];
  return `<ol class="ledger-task-list" aria-label="Ledger signing progress">
    ${labels
      .map((label, index) => {
        const state =
          activeIndex < 0
            ? "pending"
            : index < activeIndex
              ? "done"
              : index === activeIndex
                ? "active"
                : "pending";
        return `<li data-state="${state}"${index === activeIndex ? ' aria-current="step"' : ""}>
          <span class="ledger-task-mark">${index < activeIndex ? icon("check") : index + 1}</span>
          <span>${label}</span>
        </li>`;
      })
      .join("")}
  </ol>`;
};

/**
 * Renders the Ledger sign takeover for one pending device sign. It supersedes
 * the wallet screen, preserves the parked transaction, and accurately exposes
 * the current device phase without claiming network confirmation.
 */
export const ledgerSignScreen = (view: LedgerSignView, status: WalletStatus): string => `
  <header class="flow-header">
    <div class="flow-title">
      <h1>Ledger approval</h1>
      <p>Hardware wallet</p>
    </div>
    <span class="pill"><span class="dot"></span>${escapeHtml(status.network)}</span>
  </header>
  <main class="screen flow ledger-sign-screen" id="wallet-screen-ledger-sign" tabindex="-1">
    <section class="ledger-progress-card" data-phase="${escapeHtml(view.phase.kind)}">
      <div class="ledger-progress-hero">
        <span class="ledger-device-mark" aria-hidden="true">${icon("shield")}</span>
        <p class="context-label">Secure hardware signature</p>
        <h2>${escapeHtml(phaseTitle[view.phase.kind])}</h2>
        ${signerLine(view.request)}
      </div>
      ${ledgerProgress(view)}
      <div class="ledger-phase-body">${phaseBody(view)}</div>
    </section>
    <p id="ledger-sign-result" role="status" aria-live="polite"></p>
  </main>`;
