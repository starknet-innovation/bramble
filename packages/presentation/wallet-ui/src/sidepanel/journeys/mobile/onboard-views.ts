/**
 * Pure templates for enrolling a paired post-quantum device. One screen, because
 * with a clipboard transport the user moves between the wallet and their device
 * freely — sequencing this into steps would add clicks without adding safety.
 *
 * The challenge is rendered first and copyable, and the form below it follows
 * the order the user works in: sign the challenge, then paste what came back.
 * All dynamic text is escaped; ./onboard-session.ts owns state.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import { pill } from "@mc-wallet/ui-kit/content";
import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { selectField, textareaField, textField } from "@mc-wallet/ui-kit/fields";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { liquidDots, liquidDotsFilter } from "../../shared/progress-motion";
import type { MobilePqEnrollView } from "./onboard-session";

const CONTRACT_OPTIONS = [
  { label: "Per-user class (const)", value: "const" },
  { label: "Key in storage (storage)", value: "storage" },
  { label: "Hashed key (hashkey)", value: "hashkey" },
] as const;

const challengeBlock = (challenge: string): string => `
  <section class="ledger-hash-check">
    <div class="ledger-hash-head">
      <p class="context-label">Challenge to sign</p>
      ${iconButton({
        attributes: { "data-copy": challenge },
        icon: "copy",
        label: "Copy challenge",
        variant: "ghost",
      })}
    </div>
    <p class="ledger-hash-value"><code>${escapeHtml(challenge)}</code></p>
    <p class="ledger-hash-help">Sign exactly this value on your device, then paste the response below. It is single-use.</p>
  </section>`;

const enrollForm = (view: MobilePqEnrollView): string => `
  <form class="section" data-mobile-pq-enroll>
    ${selectField({
      attributes: { "data-mobile-pq-kind": true },
      label: "Account contract",
      name: "mlDsaKind",
      options: CONTRACT_OPTIONS.map((option) => ({
        label: option.label,
        selected: option.value === view.mlDsaKind,
        value: option.value,
      })),
    })}
    ${textField({
      attributes: { "data-mobile-pq-device": true },
      label: "Device name",
      name: "deviceId",
      placeholder: "Pixel 9 Pro",
    })}
    ${textareaField({
      attributes: { "data-mobile-pq-public-key": true },
      hint: "The 1952-byte ML-DSA-65 public key the device reported.",
      label: "Device public key",
      name: "publicKey",
      placeholder: "0x…",
      rows: 3,
      spellcheck: false,
    })}
    ${textField({
      attributes: { "data-mobile-pq-class-hash": true },
      hint: "The declared class for this key. A per-user class is generated from the key itself.",
      label: "Account class hash",
      name: "classHash",
      placeholder: "0x…",
    })}
    ${textareaField({
      attributes: { "data-mobile-pq-pop": true },
      hint: "The device's signature over the challenge above.",
      label: "Signed challenge",
      name: "signature",
      placeholder: "0x…",
      rows: 3,
      spellcheck: false,
    })}
    <div class="ledger-phase-actions">
      ${button({
        attributes: { "data-mobile-pq-enroll-submit": true },
        icon: "shield",
        label: "Add this device",
      })}
      ${button({
        attributes: { "data-mobile-pq-enroll-cancel": true },
        label: "Cancel",
        size: "small",
        variant: "ghost",
      })}
    </div>
  </form>`;

const phaseBody = (view: MobilePqEnrollView): string => {
  const phase = view.phase;
  if (phase.kind === "loading") {
    return "<p>Preparing a fresh challenge for your device.</p>";
  }
  if (phase.kind === "enrolling") {
    return "<p>Checking that the device can sign for this key, then deriving the account address.</p>";
  }
  if (phase.kind === "error") {
    return `<p class="form-error" role="alert">${escapeHtml(phase.message)}</p>
      ${enrollForm(view)}`;
  }
  return enrollForm(view);
};

const phaseTitle: Readonly<Record<MobilePqEnrollView["phase"]["kind"], string>> = {
  collect: "Add a post-quantum device",
  enrolling: "Verifying your device",
  error: "That device could not be added",
  loading: "Preparing a challenge",
};

const phaseLiveness: Readonly<Record<MobilePqEnrollView["phase"]["kind"], string>> = {
  collect: "Nothing is stored until the device proves it holds this key.",
  enrolling: "Verifying the signature against the key you pasted…",
  error: "No account was created.",
  loading: "Asking the wallet for a single-use challenge…",
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
