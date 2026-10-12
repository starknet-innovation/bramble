/**
 * Pure device-prompt templates for the side-panel Ledger signing runtime. The
 * screen is a progress takeover, not a generic alert: every transport, app,
 * account, device-approval, and handoff phase names the work currently under
 * way. All dynamic text is escaped; ./sign-session.ts owns state and bindings.
 *
 * Every phase also renders the hash the device is being asked to sign, at the
 * padded width the Ledger displays it — this takeover is the one surface every
 * Ledger signature passes through (wallet sends, dapp invoke/declare, multisig,
 * account deploy, SNIP-12 typed data), so showing it here means no Ledger
 * approval can happen without the comparison being on screen.
 */

import { escapeHtml } from "@bramble/core/html";
import { pill } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { menuRow } from "@bramble/ui-kit/navigation";
import { ledgerAccountIndexOfPath } from "@bramble/wallet-model/ledger-path";
import { paddedFelt } from "@bramble/wallet-model/networks";
import type { LedgerSignRequestSummary, WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { accountIdAddress, accountLabel, inlineCopyButton } from "../../shared/parts";
import { liquidDots, liquidDotsFilter } from "../../shared/progress-motion";
import type { LedgerSignView } from "./sign-session";

const signerLine = (request: LedgerSignRequestSummary): string => {
  const index = ledgerAccountIndexOfPath(request.path);
  const suffix = index === null ? "" : `<span>Account ${index}</span>`;
  const address = accountIdAddress(request.accountId);
  return `<div class="ledger-signer-line">
    <span>Signing with</span>
    <code title="${escapeHtml(address)}">${escapeHtml(accountLabel(address))}</code>
    ${inlineCopyButton(address, "Copy signing account address")}
    ${suffix}
  </div>`;
};

const cancelButton = (): string =>
  button({
    attributes: { "data-ledger-cancel": true },
    label: "Cancel transaction",
    size: "small",
    variant: "ghost",
  });

// Hex digits per rendered group. A 64-digit hash compared character by character
// against a device screen is far easier to track in short groups than as one
// unbroken run, and the grouping is presentational only — the copy affordance
// and the value handed to the device stay unbroken.
const HASH_GROUP_SIZE = 4;

const hashGroups = (digits: string): readonly string[] => {
  const groups: string[] = [];
  for (let index = 0; index < digits.length; index += HASH_GROUP_SIZE) {
    groups.push(digits.slice(index, index + HASH_GROUP_SIZE));
  }
  return groups;
};

/**
 * The hash the device is asked to blind-sign, rendered at the same full 64-digit
 * width the Ledger receives and shows, so the two screens can be compared
 * character for character. Rendered in every phase of the takeover: the value is
 * fixed for the parked request, so it is readable before the device is even
 * connected and stays put while the user reaches the on-device prompt.
 *
 * `paddedFelt` returns null only for a non-felt, which the response validator
 * already rejects before a request reaches the panel; the raw value is shown in
 * that unreachable case rather than hiding the hash the device will display.
 */
const deviceHashCheck = (request: LedgerSignRequestSummary): string => {
  const hash = paddedFelt(request.messageHash) ?? request.messageHash;
  const digits = hash.startsWith("0x") ? hash.slice(2) : hash;
  return `<section class="ledger-hash-check">
    <div class="ledger-hash-head">
      <p class="context-label">Hash shown on your Ledger</p>
      ${iconButton({
        attributes: { "data-copy": hash },
        icon: "copy",
        label: "Copy transaction hash",
        variant: "ghost",
      })}
    </div>
    <p class="ledger-hash-value"><code>${escapeHtml("0x")}${hashGroups(digits)
      .map((group) => `<span>${escapeHtml(group)}</span>`)
      .join("")}</code></p>
    <p class="ledger-hash-help">Approve only if this matches your device, character for character.</p>
  </section>`;
};

const phaseBody = (view: LedgerSignView): string => {
  const phase = view.phase;
  if (phase.kind === "discovering") {
    return `<p>Checking for a Ledger already connected to this browser.</p>${cancelButton()}`;
  }
  if (phase.kind === "connect") {
    return `<p>Connect your Ledger, unlock it, and open the Starknet app. Your transaction stays safely paused until the device is ready.</p>
      <div class="ledger-phase-actions">
        ${button({
          attributes: { "data-ledger-connect": true },
          icon: "shield",
          label: "Connect Ledger",
        })}
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
    return "<p>Signature received. Bramble is completing its final verification and returning it to the transaction.</p>";
  }
  if (phase.kind === "devices") {
    return `<p>More than one Ledger is connected. Choose the device that holds this account.</p>
      <div class="add-account-chooser" role="group" aria-label="Connected Ledger devices">
        ${phase.devices
          .map((device) =>
            menuRow({
              attributes: { "data-ledger-device": device.id },
              icon: "shield",
              label: device.label,
            }),
          )
          .join("")}
      </div>
      ${cancelButton()}`;
  }
  return `<p class="review-flag" role="alert">${escapeHtml(phase.message)}</p>
    <div class="ledger-phase-actions">
      ${button({
        attributes: { "data-ledger-retry": true },
        icon: "refresh",
        label: "Try again",
        variant: "secondary",
      })}
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

const phaseLiveness: Readonly<Record<LedgerSignView["phase"]["kind"], string>> = {
  checking: "Talking to the Starknet app…",
  confirming: "Waiting for confirmation on the device…",
  connect: "The transaction is safely paused.",
  connecting: "Waiting for the browser device chooser…",
  devices: "No device is contacted until you choose one.",
  discovering: "Looking for an existing secure session…",
  error: "The transaction has not been signed or broadcast.",
  submitting: "Signature received; completing wallet verification…",
  verifying: "Comparing the device key with this account…",
};

const livenessMark = (view: LedgerSignView): string => {
  if (view.phase.kind === "error") {
    return icon("alert");
  }
  if (view.phase.kind === "connect") {
    return icon("lock");
  }
  return `${liquidDots("ledger", true)}${liquidDotsFilter("ledger")}`;
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
    ${pill(status.network, { dot: true })}
  </header>
  <section class="screen flow ledger-sign-screen" id="wallet-screen-ledger-sign" tabindex="-1">
    <section class="ledger-progress-card" data-phase="${escapeHtml(view.phase.kind)}">
      <div class="ledger-progress-hero">
        <span class="ledger-device-mark" aria-hidden="true">${icon("shield")}</span>
        <p class="context-label">Secure hardware signature</p>
        <h2>${escapeHtml(phaseTitle[view.phase.kind])}</h2>
        ${signerLine(view.request)}
      </div>
      ${ledgerProgress(view)}
      ${deviceHashCheck(view.request)}
      <div class="ledger-phase-body">${phaseBody(view)}</div>
      <p class="ledger-liveness" role="status">
        <span class="ledger-liveness-mark">${livenessMark(view)}</span>
        ${escapeHtml(phaseLiveness[view.phase.kind])}
      </p>
    </section>
    <p id="ledger-sign-result" role="status" aria-live="polite"></p>
  </section>`;
