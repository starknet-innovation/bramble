/**
 * Pure templates for enrolling a paired post-quantum device. One screen, because
 * the user moves between the wallet and their phone freely — sequencing this
 * into steps would add clicks without adding safety.
 *
 * The challenge comes first and is **not** copyable: it is there to be compared
 * against what the phone displays, and that is the whole of its job. What is
 * copyable is the offer, and only on the copy-and-paste path — an offer on
 * screen beside a Bluetooth button invites moving a single-use value by hand
 * for no reason.
 *
 * All dynamic text is escaped; ./onboard-session.ts owns state.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import { pill } from "@mc-wallet/ui-kit/content";
import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { textareaField } from "@mc-wallet/ui-kit/fields";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { liquidDots, liquidDotsFilter } from "../../shared/progress-motion";
import type { MobilePqEnrollView } from "./onboard-session";

const challengeBlock = (challenge: string): string => `
  <section class="ledger-hash-check">
    <div class="ledger-hash-head">
      <p class="context-label">Challenge to sign</p>
    </div>
    <p class="ledger-hash-value"><code>${escapeHtml(challenge)}</code></p>
    <p class="ledger-hash-help">Your phone shows this same challenge. Compare the two and approve on the phone only if they match. Single-use.</p>
  </section>`;

const cancelButton = (): string =>
  button({
    attributes: { "data-mobile-pq-enroll-cancel": true },
    label: "Cancel",
    size: "small",
    variant: "ghost",
  });

const enrollBluetoothBody = (): string => `
  <div class="ledger-phase-actions">
    ${button({
      attributes: { "data-mobile-pq-enroll-bluetooth": true },
      icon: "shield",
      label: "Pair with the PQ Signer app",
    })}
    ${cancelButton()}
  </div>
  ${button({
    attributes: { "data-mobile-pq-enroll-use-clipboard": true },
    label: "Or pair by copy and paste",
    size: "small",
    variant: "ghost",
  })}`;

// The offer is copyable ONLY here. It is 14 KB of base64url and single-use, so
// putting it on screen when the user is not carrying it by hand is an invitation
// to spend it by accident.
const enrollClipboardBody = (view: MobilePqEnrollView): string => `
  <form class="section" data-mobile-pq-enroll>
    <section class="ledger-hash-check">
      <div class="ledger-hash-head">
        <p class="context-label">Pairing offer</p>
        ${iconButton({
          attributes: { "data-copy": view.offer },
          icon: "copy",
          label: "Copy pairing offer",
          variant: "ghost",
        })}
      </div>
      <p class="ledger-hash-help">Copy this into the app. It carries the network and the challenge together — the app needs both.</p>
    </section>
    ${textareaField({
      attributes: { "data-mobile-pq-response": true },
      hint: "One value: the app's reply carries the name, the public key and the signature.",
      label: "Reply from the app",
      name: "response",
      placeholder: "Paste the app's reply",
      rows: 4,
      spellcheck: false,
    })}
    <div class="ledger-phase-actions">
      ${button({
        attributes: { "data-mobile-pq-enroll-submit": true },
        icon: "shield",
        label: "Add this device",
      })}
      ${cancelButton()}
    </div>
    ${
      view.bluetoothAvailable
        ? button({
            attributes: { "data-mobile-pq-enroll-use-bluetooth": true },
            label: "Pair over Bluetooth instead",
            size: "small",
            variant: "ghost",
          })
        : ""
    }
  </form>`;

const enrollBody = (view: MobilePqEnrollView): string =>
  view.transport === "bluetooth" ? enrollBluetoothBody() : enrollClipboardBody(view);

const phaseBody = (view: MobilePqEnrollView): string => {
  const phase = view.phase;
  if (phase.kind === "loading") {
    return "<p>Preparing a fresh challenge for your device.</p>";
  }
  if (phase.kind === "reaching") {
    // No form while a round trip is in flight: the offer is single-use, and a
    // second click would send the same challenge to the phone twice.
    return "<p>Your phone has the pairing offer. Name the account there and approve it — the reply comes back over Bluetooth. The phone's Bluetooth screen shows the reply going out.</p>";
  }
  if (phase.kind === "enrolling") {
    return "<p>Checking that the device can sign for this key, then deriving the account address.</p>";
  }
  if (phase.kind === "error") {
    return `<p class="review-flag" role="alert">${icon("alert")}${escapeHtml(phase.message)}</p>
      ${enrollBody(view)}`;
  }
  return enrollBody(view);
};

const phaseTitle: Readonly<Record<MobilePqEnrollView["phase"]["kind"], string>> = {
  collect: "Add a post-quantum device",
  enrolling: "Verifying your device",
  error: "That device could not be added",
  loading: "Preparing a challenge",
  reaching: "Waiting for your phone",
};

const phaseLiveness: Readonly<Record<MobilePqEnrollView["phase"]["kind"], string>> = {
  collect: "Nothing is stored until the device proves it holds this key.",
  enrolling: "Checking the proof against the key your phone sent…",
  error: "No account was created.",
  loading: "Asking the wallet for a single-use challenge…",
  reaching: "Name the account on your phone and approve it there…",
};

const livenessMark = (view: MobilePqEnrollView): string => {
  if (view.phase.kind === "error") {
    return icon("alert");
  }
  if (view.phase.kind === "collect") {
    return icon("lock");
  }
  return `${liquidDots("mobile-pq", true)}${liquidDotsFilter("mobile-pq")}`;
};

/**
 * Renders the enrollment takeover. It never claims an account exists before the
 * background has verified the proof of possession and derived its address.
 */
export const mobilePqEnrollScreen = (view: MobilePqEnrollView, status: WalletStatus): string => `
  <header class="flow-header">
    <div class="flow-title">
      <h1>Post-quantum device</h1>
      <p>Signed by your phone</p>
    </div>
    ${pill(status.network, { dot: true })}
  </header>
  <main class="screen flow ledger-sign-screen" id="wallet-screen-mobile-pq-enroll" tabindex="-1">
    <section class="ledger-progress-card" data-phase="${escapeHtml(view.phase.kind)}">
      <div class="ledger-progress-hero">
        <span class="ledger-device-mark" aria-hidden="true">${icon("shield")}</span>
        <p class="context-label">Proof of possession</p>
        <h2>${escapeHtml(phaseTitle[view.phase.kind])}</h2>
      </div>
      ${challengeBlock(view.challenge)}
      <div class="ledger-phase-body">${phaseBody(view)}</div>
      <p class="ledger-liveness" role="status">
        <span class="ledger-liveness-mark">${livenessMark(view)}</span>
        ${escapeHtml(phaseLiveness[view.phase.kind])}
      </p>
    </section>
    <p id="mobile-pq-enroll-result" role="status" aria-live="polite"></p>
  </main>`;
