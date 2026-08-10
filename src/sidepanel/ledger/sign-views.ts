/**
 * Pure device-prompt templates for the side-panel Ledger signing runtime. The
 * screen is a progress takeover, not a generic alert: every transport, app,
 * account, device-approval, and handoff phase names the work currently under
 * way. All dynamic text is escaped; ./sign-session.ts owns state and bindings.
 */
import type { LedgerSignRequestSummary, WalletStatus } from "../../popup/responses";
import { escapeHtml } from "../../shared/html";
import type { LedgerSignIntent } from "../../starknet/ledger-intent";
import { ledgerAccountIndexOfPath } from "../../starknet/ledger-path";
import { paddedFelt } from "../../starknet/networks";
import { pill } from "../../ui/content";
import { button } from "../../ui/controls";
import { menuRow } from "../../ui/navigation";
import { icon } from "../icons";
import { accountLabel } from "../parts";
import { liquidDots, liquidDotsFilter } from "../progress-motion";
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

/**
 * One intent's prompt: what the signature authorizes, and where it falls in a
 * multi-signature operation.
 */
type IntentPrompt = {
  /** Why a second signature exists, shown only when `step` is set. */
  readonly because?: string;
  readonly step?: 1 | 2;
  readonly text: string;
};

// What the signature authorizes, in the user's terms. The device shows only a
// bare hash under v1 blind signing, so this is the sole statement of purpose the
// user gets before approving. Typed as a total record over the intent union, so
// adding an intent without writing its copy fails to type-check rather than
// rendering an unlabelled prompt.
//
// Every private operation takes two approvals, and they authorize different
// things: the first signs the CallSet the pool verifies against the proof, the
// second either broadcasts the transaction or hands it to the relay. Both halves
// say which of the two they are, because "sign twice for one action" is
// indistinguishable from a wallet asking twice for the same thing.
const intentCopy: Readonly<Record<LedgerSignIntent, IntentPrompt>> = {
  "dapp-message": { text: "Sign a message from this site" },
  "dapp-transaction": { text: "Sign to approve this site's transaction" },
  "declare-class": { text: "Sign to declare a contract class" },
  "deploy-account": { text: "Sign to deploy this account" },
  "multisig-confirm": { text: "Sign to confirm this multisig transaction" },
  "multisig-deploy": { text: "Sign to deploy this multisig" },
  "multisig-execute": { text: "Sign to execute this multisig transaction" },
  "multisig-propose": { text: "Sign to propose this multisig transaction" },
  "multisig-revoke": { text: "Sign to revoke your confirmation" },
  "revoke-spending": { text: "Sign to revoke a spending approval" },
  "send-collectible": { text: "Sign to send this collectible" },
  "send-token": { text: "Sign to send" },
  "strk20-authorize": {
    because: "Authorizes the private actions themselves. Nothing is submitted yet.",
    step: 1,
    text: "Sign to authorize this site's private actions",
  },
  "strk20-broadcast": {
    because: "Sends the authorized actions to Starknet.",
    step: 2,
    text: "Sign to broadcast this site's private transaction",
  },
  "strk20-register-authorize": {
    because: "Authorizes joining the pool. Nothing is submitted yet.",
    step: 1,
    text: "Sign to authorize joining the privacy pool",
  },
  "strk20-register-broadcast": {
    because: "Sends the registration to Starknet and pays the pool fee.",
    step: 2,
    text: "Sign to broadcast the registration transaction",
  },
  "strk20-shield-authorize": {
    because: "Authorizes the deposit into your private balance. Nothing moves yet.",
    step: 1,
    text: "Sign to authorize this deposit",
  },
  "strk20-shield-broadcast": {
    because: "Sends the deposit to Starknet from this account.",
    step: 2,
    text: "Sign to broadcast the deposit transaction",
  },
  "strk20-transfer-authorize": {
    because: "Authorizes the private movement. Nothing is submitted yet.",
    step: 1,
    text: "Sign to authorize this private transfer",
  },
  "strk20-transfer-relay": {
    because: "Lets the relay submit it for you, so your account never appears on chain.",
    step: 2,
    text: "Sign to hand this transfer to the private relay",
  },
  "strk20-viewing-key": {
    text: "Sign to derive your viewing key",
  },
  "swap-tokens": { text: "Sign to swap these tokens" },
};

// Named "Signature N of 2" rather than as a progress bar: the count is about how
// many times the device will ask, which is the question a user holding a Ledger
// is actually asking. Absent for a single-signature operation, where a "1 of 1"
// would invent a sequence.
const stepLine = (prompt: IntentPrompt): string =>
  prompt.step === undefined
    ? ""
    : `<p class="context-label ledger-sign-step">Signature ${prompt.step} of 2</p>`;

const becauseLine = (prompt: IntentPrompt): string =>
  prompt.because === undefined
    ? ""
    : `<p class="ledger-sign-because">${escapeHtml(prompt.because)}</p>`;

const intentLine = (request: LedgerSignRequestSummary): string => {
  const prompt = intentCopy[request.intent];
  return `${stepLine(prompt)}
  <p class="ledger-sign-intent">${escapeHtml(prompt.text)}</p>
  ${becauseLine(prompt)}`;
};

// The exact value the device is asked to sign, shown so it can be compared with
// the device screen — the only check that catches a host that computed a
// different transaction than the one reviewed. Rendered in the padded 32-byte
// form the device receives (see `paddedFelt`), so the comparison is digit for
// digit rather than against a shortest-form felt that drops leading zeros.
const hashLine = (request: LedgerSignRequestSummary): string => `
  <section class="ledger-hash">
    <p class="context-label">Hash being signed</p>
    <code>${escapeHtml(paddedFelt(request.messageHash) ?? request.messageHash)}</code>
    <p>Your Ledger shows this hash before you approve. Check that it matches, and
    reject on the device if it does not.</p>
  </section>`;

const cancelButton = (): string =>
  button({
    attributes: { "data-ledger-cancel": true },
    label: "Cancel transaction",
    size: "small",
    variant: "ghost",
  });

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
    return "<p>Signature received. MC Wallet is completing its final verification and returning it to the transaction.</p>";
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
  <main class="screen flow ledger-sign-screen" id="wallet-screen-ledger-sign" tabindex="-1">
    <section class="ledger-progress-card" data-phase="${escapeHtml(view.phase.kind)}">
      <div class="ledger-progress-hero">
        <span class="ledger-device-mark" aria-hidden="true">${icon("shield")}</span>
        <p class="context-label">Secure hardware signature</p>
        <h2>${escapeHtml(phaseTitle[view.phase.kind])}</h2>
        ${intentLine(view.request)}
        ${signerLine(view.request)}
      </div>
      ${ledgerProgress(view)}
      ${hashLine(view.request)}
      <div class="ledger-phase-body">${phaseBody(view)}</div>
      <p class="ledger-liveness" role="status">
        <span class="ledger-liveness-mark">${livenessMark(view)}</span>
        ${escapeHtml(phaseLiveness[view.phase.kind])}
      </p>
    </section>
    <p id="ledger-sign-result" role="status" aria-live="polite"></p>
  </main>`;
