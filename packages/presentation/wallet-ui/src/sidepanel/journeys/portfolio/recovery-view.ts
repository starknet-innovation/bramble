/**
 * The read-only Home flag's recovery copy and its confirmation, for the
 * phrase-driven flows that remove a second factor (Braavos 2FA, Ready
 * guardian). These sentences are consent copy: each states only what the
 * account contract will do — what is removed, when it takes effect, who can
 * still cancel, and the maximum fee — and is edited as a reviewed group.
 * The render layer reads no clock: every instant is one the chain reported.
 */
import { escapeHtml } from "@bramble/core/html";
import { UNDEPLOYED_BRAAVOS_REFUSAL } from "@bramble/wallet-model/account-families";
import type { SignabilityVerdict } from "../../../popup/responses/responses";
import type { RecoveryReview } from "../../../popup/responses/responses-recovery";
import { icon } from "../../shared/icons";
import { formatFeeEstimate } from "../../shared/review-render";

/**
 * Formats a unix-seconds instant as "DD/MM/YY at HHhMM UTC" with pure integer
 * civil-from-epoch arithmetic (Hinnant's algorithm), so the render layer reads
 * no wall clock — it only formats the value it is given. Minutes are floored.
 */
const formatUtcInstant = (epochSeconds: number): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const days = Math.floor(epochSeconds / 86_400);
  const secondOfDay = epochSeconds - days * 86_400;
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  const hour = Math.floor(secondOfDay / 3600);
  const minute = Math.floor((secondOfDay % 3600) / 60);
  return `${pad(day)}/${pad(month)}/${pad(year % 100)} at ${pad(hour)}h${pad(minute)} UTC`;
};

const at = (epochSeconds: number): string => formatUtcInstant(epochSeconds);

// Ready: cancel_escape needs the owner AND the guardian to sign together, so
// neither the guardian nor the phrase can stop a removal alone.
const READY_CANCEL = "Cancelling needs this account's key and your guardian together, in Ready.";
// trigger_escape_owner is accepted only when the guardian signs: a live owner
// escape is a key replacement the guardian approved.
const OWNER_ESCAPE = "Your guardian has started replacing this account's key.";

const detail = (text: string): string => `<p class="read-only-detail">${escapeHtml(text)}</p>`;

/**
 * The read-only notice under the total. Always says "Read only" and keeps the
 * money actions greyed. A phrase-recoverable account (Braavos 2FA, Ready
 * guardian) adds the recovery state and the one action it allows; a Ledger
 * account is told recovery is unavailable, since the flows refuse it.
 */
export const readOnlyNotice = (
  signability: SignabilityVerdict | null,
  keyless: boolean,
): string => {
  if (signability?.readOnly !== true) return "";
  // Not read only: it signs once deployed, which is its own reviewed step.
  if (signability.reason === "undeployed") {
    return `<div class="read-only-notice" data-read-only="undeployed">
      <p class="hero-stale">${icon("rocket")}<span>Not deployed</span></p>
      <p class="read-only-detail">${escapeHtml(UNDEPLOYED_BRAAVOS_REFUSAL)}</p>
    </div>`;
  }
  const recovery = "recovery" in signability ? signability.recovery : undefined;
  const kind = signability.reason === "guardian" ? "argent" : "braavos";
  const recoverable = signability.reason === "strong-signer" || signability.reason === "guardian";
  const noun = kind === "argent" ? "the guardian" : "2FA";
  const button = (label: string): string =>
    `<button class="button button-secondary" id="recover-account" type="button" data-recover-kind="${kind}">${label}</button>`;
  const pendingUntil = recovery?.pendingUntil ?? null;
  const expiresAt = recovery?.expiresAt;
  const stage = recovery?.stage;
  let body = "";
  if (recoverable && keyless) {
    body = detail(`Removing ${noun} isn't available for Ledger accounts.`);
  } else if (kind === "argent" && stage === "ready" && expiresAt !== undefined) {
    body = `${detail(`Guardian removal is ready. Complete it before ${at(expiresAt)}.`)}${button("Complete recovery")}`;
  } else if (kind === "argent" && stage === "expired" && expiresAt !== undefined) {
    body = `${detail(`The last guardian removal expired on ${at(expiresAt)} without being completed.`)}${button("Recover account")}`;
  } else if (kind === "argent" && stage === "owner-escape") {
    body = `${detail(OWNER_ESCAPE)}${button("Recover account")}`;
  } else if (kind === "argent" && pendingUntil !== null && expiresAt !== undefined) {
    body = detail(
      `Removing the guardian — you can complete it after ${at(pendingUntil)}, until ${at(expiresAt)}. ${READY_CANCEL}`,
    );
  } else if (kind === "braavos" && pendingUntil !== null) {
    body = detail(
      `Removing 2FA — usable on ${at(pendingUntil)}. Your Braavos device can still stop this.`,
    );
  } else if (recoverable && stage === undefined) {
    body = button("Recover account");
  }
  return `<div class="read-only-notice" data-read-only="true">
      <p class="hero-stale">${icon("eye")}<span>Read only</span></p>
      <div class="read-only-body" data-recovery-body>${body}</div>
    </div>`;
};

/** The confirmation's sentences and its confirm label, per vendor and step. */
const recoveryConfirmCopy = (
  kind: "argent" | "braavos",
  review: RecoveryReview,
): {
  readonly confirm: string;
  readonly lines: readonly string[];
  readonly title: string;
  readonly warning: string | null;
} => {
  const fee = `Maximum network fee: ${formatFeeEstimate(review.fee)}`;
  if (kind === "braavos") {
    return {
      confirm: "Remove 2FA",
      lines: [
        "This permanently removes 2FA from this account, along with any multisig or withdrawal limit on it. After that, your recovery phrase alone controls the account.",
        `Takes effect after ${at(review.readyAt)}. Until then, you can cancel it from your Braavos device.`,
        fee,
      ],
      title: "Remove 2FA from this account?",
      warning: null,
    };
  }
  if (review.step === "complete") {
    return {
      confirm: "Remove guardian",
      lines: [
        "This removes the guardian from this account now. After that, your recovery phrase alone controls the account.",
        fee,
      ],
      title: "Complete guardian removal?",
      warning: null,
    };
  }
  return {
    confirm: "Start removal",
    lines: [
      "This starts removing the guardian. Once it is removed, your recovery phrase alone controls the account.",
      review.expiresAt === null
        ? `You can complete the removal after ${at(review.readyAt)}.`
        : `You can complete the removal after ${at(review.readyAt)}, until ${at(review.expiresAt)}. After that, it expires.`,
      READY_CANCEL,
      fee,
    ],
    title: "Remove the guardian from this account?",
    warning: review.replacesOwnerEscape
      ? `${OWNER_ESCAPE} Continuing cancels that change. If you asked for it, don't continue.`
      : null,
  };
};

/**
 * Builds the confirmation panel with DOM nodes and `textContent` only (no HTML
 * sink): a title, the consequence, timing and cancel sentences, the maximum
 * fee, an optional warning, and explicit Cancel and confirm buttons.
 */
export const buildRecoveryConfirm = (
  doc: Document,
  kind: "argent" | "braavos",
  review: RecoveryReview,
): {
  readonly cancel: HTMLButtonElement;
  readonly confirm: HTMLButtonElement;
  readonly panel: HTMLElement;
} => {
  const copy = recoveryConfirmCopy(kind, review);
  const panel = doc.createElement("div");
  panel.className = "recovery-confirm";
  panel.setAttribute("role", "group");
  panel.setAttribute("data-recovery-confirm", review.step);
  const title = doc.createElement("p");
  title.className = "recovery-confirm-title";
  title.id = "recovery-confirm-title";
  title.textContent = copy.title;
  panel.setAttribute("aria-labelledby", title.id);
  panel.append(title);
  if (copy.warning !== null) {
    const warning = doc.createElement("p");
    warning.className = "recovery-confirm-warning";
    warning.setAttribute("role", "alert");
    warning.textContent = copy.warning;
    panel.append(warning);
  }
  for (const line of copy.lines) {
    const paragraph = doc.createElement("p");
    paragraph.className = "read-only-detail";
    paragraph.textContent = line;
    panel.append(paragraph);
  }
  const row = doc.createElement("div");
  row.className = "button-row";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.id = "recovery-cancel";
  cancel.textContent = "Cancel";
  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "danger";
  confirm.id = "recovery-confirm";
  confirm.textContent = copy.confirm;
  row.append(cancel, confirm);
  panel.append(row);
  return { cancel, confirm, panel };
};
