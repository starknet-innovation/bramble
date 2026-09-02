/**
 * Pure prompt templates for the side-panel paired-phone signing runtime. The
 * screen is a handoff takeover, not a progress spinner: with a clipboard
 * transport the user is the transport, so the two things they must do — carry
 * the request to the phone, bring the response back — are both on screen at
 * once rather than sequenced into phases they would have to click through.
 *
 * Ordered by what the user does, top to bottom: copy the request, compare the
 * hash, paste the response. The request leads because it is the only value the
 * app can read; the hash is bigger on screen but carries no action.
 *
 * All dynamic text is escaped; ./sign-session.ts owns state and bindings.
 *
 * Every phase renders the hash the phone is being asked to sign, at the padded
 * width it is signed as. The phone blind-signs at this milestone — it cannot
 * decode what it is approving — so this screen is the only place the user can
 * see what a signature will commit to, which is exactly why it stays on screen
 * through the error and submitting phases too.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import { pill } from "@mc-wallet/ui-kit/content";
import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { textareaField } from "@mc-wallet/ui-kit/fields";
import type { MobilePqSignRequestSummary, WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { accountLabel } from "../../shared/parts";
import { liquidDots, liquidDotsFilter } from "../../shared/progress-motion";
import { feltCheckBlock } from "./felt-check";
import type { MobilePqSignView } from "./sign-session";

const addressOfAccountId = (accountId: string): string => accountId.split(":")[1] ?? accountId;

const signerLine = (request: MobilePqSignRequestSummary): string =>
  `<div class="ledger-signer-line">
    <span>Signing with</span>
    <code>${escapeHtml(accountLabel(addressOfAccountId(request.accountId)))}</code>
    <span>${escapeHtml(request.deviceId)}</span>
  </div>`;

/**
 * The one value the phone can actually read, given its own area at the top of the
 * card.
 *
 * It leads because it is the only thing on this screen with an action attached:
 * the hash below it is for comparing by eye, and a user who copies that instead
 * gets a value the app rejects.
 *
 * The hash now leads, because on the Bluetooth path there is nothing for the
 * user to carry and comparing the hash is their entire job. The request appears
 * only on the copy-and-paste path, where it is the thing being carried.
 */
const requestBlock = (view: MobilePqSignView): string =>
  `<section class="ledger-hash-check">
    <div class="ledger-hash-head">
      <p class="context-label">Request for your phone</p>
      ${iconButton({
        attributes: { "data-copy": view.envelope },
        icon: "copy",
        label: "Copy signing request",
        variant: "ghost",
      })}
    </div>
    <p class="ledger-hash-help">Copy this into the app on your phone. It carries the account, the network and the hash together — the app needs all of it, and refuses a bare hash.</p>
  </section>`;

/**
 * The hash the phone is asked to blind-sign, at the full padded width. The phone
 * cannot show the user what it means, so this is the only screen that can.
 */
const phoneHashCheck = (request: MobilePqSignRequestSummary): string =>
  feltCheckBlock({
    help: "Your phone shows this same hash. Compare the two and approve on the phone only if they match. Nothing is submitted until the wallet has verified what comes back.",
    label: "Hash your phone will sign",
    value: request.messageHash,
  });

const cancelButton = (): string =>
  button({
    attributes: { "data-mobile-pq-cancel": true },
    label: "Cancel transaction",
    size: "small",
    variant: "ghost",
  });

const bluetoothBody = (): string => `
  <div class="ledger-phase-actions">
    ${button({
      attributes: { "data-mobile-pq-bluetooth": true },
      icon: "shield",
      label: "Sign with the PQ Signer app",
    })}
    ${cancelButton()}
  </div>
  ${button({
    attributes: { "data-mobile-pq-use-clipboard": true },
    label: "Or sign by copy and paste",
    size: "small",
    variant: "ghost",
  })}`;

// The envelope is copyable ONLY here. On the Bluetooth path the wallet carries
// it, and putting kilobytes of base64url on screen next to a button that needs
// none of it is noise in front of the one thing that matters: the hash.
const clipboardBody = (view: MobilePqSignView): string => `
  ${requestBlock(view)}
  ${textareaField({
    attributes: { "data-mobile-pq-response": true },
    label: "Signed response",
    name: "mobilePqResponse",
    placeholder: "Paste the response from the app",
    rows: 3,
    spellcheck: false,
  })}
  <div class="ledger-phase-actions">
    ${button({
      attributes: { "data-mobile-pq-submit": true },
      icon: "shield",
      label: "Use this signature",
    })}
    ${cancelButton()}
  </div>
  ${
    view.bluetoothAvailable
      ? button({
          attributes: { "data-mobile-pq-use-bluetooth": true },
          label: "Sign over Bluetooth instead",
          size: "small",
          variant: "ghost",
        })
      : ""
  }`;

const handoffBody = (view: MobilePqSignView): string =>
  view.transport === "bluetooth" ? bluetoothBody() : clipboardBody(view);

const phaseBody = (view: MobilePqSignView): string => {
  const phase = view.phase;
  if (phase.kind === "reaching") {
    // No controls while a round trip is in flight. A second send would ask the
    // phone to approve the same hash twice.
    return "<p>Your phone has the request. Compare the hash above with the one it shows, approve it there, and the signature comes back over Bluetooth.</p>";
  }
  if (phase.kind === "submitting") {
    return "<p>Signature received. MC Wallet is verifying it against this account's enrolled key before it can be used.</p>";
  }
  if (phase.kind === "error") {
    return `<p class="review-flag" role="alert">${icon("alert")}${escapeHtml(phase.message)}</p>
      <div class="ledger-phase-actions">
        ${button({
          attributes: { "data-mobile-pq-retry": true },
          icon: "refresh",
          label: "Try again",
        })}
        ${cancelButton()}
      </div>`;
  }
  return handoffBody(view);
};

const phaseTitle: Readonly<Record<MobilePqSignView["phase"]["kind"], string>> = {
  error: "That response could not be used",
  handoff: "Approve on your phone",
  reaching: "Waiting for your phone",
  submitting: "Verifying the signature",
};

const phaseLiveness: Readonly<Record<MobilePqSignView["phase"]["kind"], string>> = {
  error: "The transaction has not been signed or broadcast.",
  handoff: "The transaction is safely paused until you approve it on your phone.",
  reaching: "Compare the hash on your phone, then approve it there…",
  submitting: "Checking the signature against the enrolled key…",
};

const livenessMark = (view: MobilePqSignView): string => {
  if (view.phase.kind === "error") {
    return icon("alert");
  }
  if (view.phase.kind === "handoff") {
    return icon("lock");
  }
  return `${liquidDots("mobile-pq", true)}${liquidDotsFilter("mobile-pq")}`;
};

/**
 * Renders the paired-phone sign takeover for one pending request. It supersedes
 * the wallet screen, preserves the parked transaction, and never claims the
 * signature is accepted before the background has verified it.
 */
export const mobilePqSignScreen = (view: MobilePqSignView, status: WalletStatus): string => `
  <header class="flow-header">
    <div class="flow-title">
      <h1>Phone approval</h1>
      <p>Post-quantum signer</p>
    </div>
    ${pill(status.network, { dot: true })}
  </header>
  <main class="screen flow ledger-sign-screen" id="wallet-screen-mobile-pq-sign" tabindex="-1">
    <section class="ledger-progress-card" data-phase="${escapeHtml(view.phase.kind)}">
      <div class="ledger-progress-hero">
        <span class="ledger-device-mark" aria-hidden="true">${icon("shield")}</span>
        <p class="context-label">Post-quantum signature</p>
        <h2>${escapeHtml(phaseTitle[view.phase.kind])}</h2>
        ${signerLine(view.request)}
      </div>
      ${phoneHashCheck(view.request)}
      <div class="ledger-phase-body">${phaseBody(view)}</div>
      <p class="ledger-liveness" role="status">
        <span class="ledger-liveness-mark">${livenessMark(view)}</span>
        ${escapeHtml(phaseLiveness[view.phase.kind])}
      </p>
    </section>
    <p id="mobile-pq-sign-result" role="status" aria-live="polite"></p>
  </main>`;
