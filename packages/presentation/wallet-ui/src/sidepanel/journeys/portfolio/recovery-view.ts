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
import { t, th } from "../../../i18n/messages";
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
  return t("review.recovery.instant", {
    date: `${pad(day)}/${pad(month)}/${pad(year % 100)}`,
    time: `${pad(hour)}h${pad(minute)}`,
  });
};

const at = (epochSeconds: number): string => formatUtcInstant(epochSeconds);

// Ready: cancel_escape needs the owner AND the guardian to sign together, so
// neither the guardian nor the phrase can stop a removal alone.
const readyCancel = (): string => t("review.recovery.readyCancel");
// trigger_escape_owner is accepted only when the guardian signs: a live owner
// escape is a key replacement the guardian approved.
const ownerEscape = (): string => t("review.recovery.ownerEscape");
// trigger_escape_guardian(Some(new)) is accepted when the owner alone signs:
// a guardian escape to a new guardian was started with this account's
// key. Completing it installs that guardian, so it is never shown as a removal.
const guardianChange = (): string => t("review.recovery.guardianChange");

// trigger_escape_guardian(None) is rejected while a backup guardian is set, so
// the phrase cannot remove the guardian; a failed read is shown, not guessed.

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
      <p class="hero-stale">${icon("rocket")}<span>${th("review.recovery.notDeployed")}</span></p>
      <p class="read-only-detail">${escapeHtml(UNDEPLOYED_BRAAVOS_REFUSAL)}</p>
    </div>`;
  }
  const recovery = "recovery" in signability ? signability.recovery : undefined;
  const kind = signability.reason === "guardian" ? "argent" : "braavos";
  const recoverable = signability.reason === "strong-signer" || signability.reason === "guardian";
  const button = (label: string): string =>
    `<button class="button button-secondary" id="recover-account" type="button" data-recover-kind="${kind}">${escapeHtml(label)}</button>`;
  const recover = (): string => button(t("review.recovery.recover"));
  const pendingUntil = recovery?.pendingUntil ?? null;
  const expiresAt = recovery?.expiresAt;
  const stage = recovery?.stage;
  let body = "";
  if (recoverable && keyless) {
    body = detail(
      t(kind === "argent" ? "review.recovery.ledgerGuardian" : "review.recovery.ledgerTwoFactor"),
    );
  } else if (kind === "argent" && stage === "backup-guardian") {
    body = detail(t("review.recovery.backupPresent"));
  } else if (kind === "argent" && stage === "backup-unknown") {
    body = detail(t("review.recovery.backupUnknown"));
  } else if (kind === "argent" && stage === "ready" && expiresAt !== undefined) {
    body = `${detail(t("review.recovery.readyToComplete", { at: at(expiresAt) }))}${button(t("review.recovery.completeRecovery"))}`;
  } else if (kind === "argent" && stage === "expired" && expiresAt !== undefined) {
    body = `${detail(t("review.recovery.expired", { at: at(expiresAt) }))}${recover()}`;
  } else if (kind === "argent" && stage === "owner-escape") {
    body = `${detail(ownerEscape())}${recover()}`;
  } else if (kind === "argent" && stage === "guardian-change") {
    body = `${detail(guardianChange())}${recover()}`;
  } else if (kind === "argent" && pendingUntil !== null && expiresAt !== undefined) {
    body = detail(
      t("review.recovery.guardianPending", { from: at(pendingUntil), until: at(expiresAt) }),
    );
  } else if (kind === "braavos" && pendingUntil !== null) {
    body = detail(t("review.recovery.braavos.pending", { at: at(pendingUntil) }));
  } else if (recoverable && stage === undefined) {
    body = recover();
  }
  return `<div class="read-only-notice" data-read-only="true">
      <p class="hero-stale">${icon("eye")}<span>${th("review.recovery.readOnly")}</span></p>
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
  const fee = t("review.recovery.maxFee", { fee: formatFeeEstimate(review.fee) });
  if (kind === "braavos") {
    return {
      confirm: t("review.recovery.braavos.confirm"),
      lines: [
        t("review.recovery.braavos.consequence"),
        t("review.recovery.braavos.timing", { at: at(review.readyAt) }),
        fee,
      ],
      title: t("review.recovery.braavos.title"),
      warning: null,
    };
  }
  if (review.step === "complete") {
    return {
      confirm: t("review.recovery.complete.confirm"),
      lines: [t("review.recovery.complete.consequence"), fee],
      title: t("review.recovery.complete.title"),
      warning: null,
    };
  }
  return {
    confirm: t("review.recovery.start.confirm"),
    lines: [
      t("review.recovery.start.consequence"),
      review.expiresAt === null
        ? t("review.recovery.start.timing", { at: at(review.readyAt) })
        : t("review.recovery.start.timingWindow", {
            from: at(review.readyAt),
            until: at(review.expiresAt),
          }),
      readyCancel(),
      fee,
    ],
    title: t("review.recovery.start.title"),
    warning:
      review.replaces === null
        ? null
        : t("review.recovery.replaces", {
            change: review.replaces.kind === "owner-escape" ? ownerEscape() : guardianChange(),
          }),
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
  cancel.textContent = t("review.recovery.cancel");
  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "danger";
  confirm.id = "recovery-confirm";
  confirm.textContent = copy.confirm;
  row.append(cancel, confirm);
  panel.append(row);
  return { cancel, confirm, panel };
};
