/** State-based action hierarchy for one frozen Argent multisig intent. */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import { button } from "@bramble/ui-kit/controls";
import { selectField, textareaField } from "@bramble/ui-kit/fields";
import { t, th } from "../../../i18n/messages";
import { reviewStepsMultisigMessages } from "../../../i18n/messages/review-steps-multisig";
import { icon } from "../../shared/icons";
import { accountLabel } from "../../shared/parts";

/**
 * What a stale multisig card can truthfully say about whether it went out: the
 * nonce it was signed for may have been used by a co-signer, for this version or
 * their own fee-updated one, so "nothing was sent" is never claimed here.
 */
export const STALE_INTENT_MAY_HAVE_BEEN_SENT =
  reviewStepsMultisigMessages.en["review.multisig.stale.mayHaveBeenSent"];

/**
 * What a stale card says when the node refused this version's signed fee while
 * the account nonce was still its own (mc-wallet 673). It reports that refusal
 * and nothing more: it does not claim no co-signer could send the package later.
 */
/**
 * What a stale card says when the node refused this version's signed fee while
 * the account nonce was still its own (mc-wallet 673). It reports that refusal
 * and nothing more: it does not claim no co-signer could send the package later.
 */
export const STALE_INTENT_FEE_REFUSED =
  reviewStepsMultisigMessages.en["review.multisig.stale.feeRefused"];

/** A stale version whose exact hash the sequencer rejected (mc-wallet 673). */
export const STALE_INTENT_NOT_SENT =
  reviewStepsMultisigMessages.en["review.multisig.stale.notSent"];

/** Beside a rejected version while the nonce shows something else may have gone out. */
export const STALE_INTENT_OTHER_VERSION =
  reviewStepsMultisigMessages.en["review.multisig.stale.otherVersion"];

/** A stale version included and reverted: settled, its nonce and fee spent. */
export const STALE_INTENT_REVERTED =
  reviewStepsMultisigMessages.en["review.multisig.stale.reverted"];

/** The only way to send a rejected or reverted version's calls again. */
export const PROPOSE_AGAIN = reviewStepsMultisigMessages.en["review.multisig.action.proposeAgain"];

// The constants above are the English each sentence is pinned to (tests compare
// against them); what renders is the catalog in the active language.

/** Short label for a stale multisig version; it says nothing about whether it was sent. */
export const staleIntentLabel = (): string => t("review.multisig.stale.label");

/** "This may already have been sent by another signer." in the active language. */
export const staleIntentMayHaveBeenSent = (): string => t("review.multisig.stale.mayHaveBeenSent");

const approvalsText = (count: number): string =>
  t(count === 1 ? "review.multisig.approvalsOne" : "review.multisig.approvalsMany", {
    count: String(count),
  });

const freshApprovalsText = (count: number): string =>
  t(count === 1 ? "review.multisig.freshApprovalsOne" : "review.multisig.freshApprovalsMany", {
    count: String(count),
  });

type SignerOption = { readonly label: string; readonly value: string };
type IntentAction = {
  readonly canSign: boolean;
  readonly note: string;
  readonly packageIsPrimary: boolean;
  readonly primary: string;
  readonly secondary?: string;
};

const intentAction = (
  intent: ArgentMultisigSigningIntent,
  availableSigners: readonly SignerOption[],
  hasLocalSigner: boolean,
  hasFreshAuthority: boolean,
  hasReplacement: boolean,
): IntentAction => {
  if (!hasFreshAuthority) {
    return {
      canSign: false,
      note: t("review.multisig.note.signersChanged"),
      packageIsPrimary: false,
      primary: button({
        attributes: { "data-view": "multisig-signers" },
        label: t("review.multisig.action.reviewSigners"),
        variant: "secondary",
      }),
    };
  }
  if (intent.state === "ready") {
    return {
      canSign: false,
      note: "",
      packageIsPrimary: false,
      primary: button({
        attributes: { "data-ms-submit": intent.id },
        label: t("review.multisig.action.submit"),
      }),
    };
  }
  if (intent.state === "stale" && intent.staleOutcome !== undefined) {
    return settledStaleAction(intent, hasReplacement);
  }
  if (intent.state === "stale") {
    const retryable = intent.signatures.length === intent.configSnapshot.threshold;
    // Only a recorded fee refusal at an unmoved nonce reads as refused; a moved
    // nonce, a signer change, or an older record without a reason may have
    // been sent by a co-signer (Sherlock 177, audit M3).
    const lead = t(
      intent.staleReason === "fee"
        ? "review.multisig.stale.feeRefused"
        : intent.staleReason === "proof"
          ? "review.multisig.stale.proofExpired"
          : "review.multisig.stale.mayHaveBeenSent",
    );
    const threshold = intent.configSnapshot.threshold;
    const facts = {
      approvals: approvalsText(threshold),
      fresh: freshApprovalsText(threshold),
      lead,
    };
    return {
      canSign: false,
      // Neither sentence says nothing was sent (audit M3).
      note: retryable
        ? t(
            hasReplacement
              ? "review.multisig.note.continueFeeUpdated"
              : "review.multisig.note.updateFee",
            facts,
          )
        : t("review.multisig.note.outOfDate", { lead }),
      packageIsPrimary: false,
      primary: button({
        attributes: { "data-ms-refresh-intent": intent.id },
        label: t(
          hasReplacement
            ? "review.multisig.action.continueFeeUpdated"
            : retryable
              ? "review.multisig.action.updateFee"
              : "review.multisig.action.createCurrent",
        ),
      }),
      ...(retryable
        ? {
            secondary: button({
              attributes: { "data-ms-submit": intent.id },
              label: t("review.multisig.action.tryUnchangedFee"),
              variant: "secondary",
            }),
          }
        : {}),
    };
  }
  if (intent.state === "collecting" && availableSigners.length > 0) {
    return {
      canSign: true,
      note: "",
      packageIsPrimary: false,
      primary: button({
        attributes: { "data-ms-sign": intent.id },
        label: t("review.multisig.action.sign"),
      }),
    };
  }
  if (intent.state === "collecting") {
    return {
      canSign: false,
      note: t(
        hasLocalSigner ? "review.multisig.note.alreadySigned" : "review.multisig.note.noSigner",
      ),
      packageIsPrimary: true,
      primary: button({
        attributes: { "data-ms-copy-package": intent.id },
        label: t("review.multisig.action.copyPackage"),
      }),
    };
  }
  return {
    canSign: false,
    note: t("review.multisig.note.nothingLeft"),
    packageIsPrimary: false,
    primary: "",
  };
};

// A stale version whose own hash the chain answered for (mc-wallet 673): the
// sequencer rejected it, so it was never included, or it reverted, spending
// its nonce and fee. It is never retried as signed; its calls go out again only
// through a new proposal that collects fresh signatures at the current nonce.
const settledStaleAction = (
  intent: ArgentMultisigSigningIntent,
  hasReplacement: boolean,
): IntentAction => {
  const lead = t(
    intent.staleOutcome === "reverted"
      ? "review.multisig.stale.reverted"
      : intent.staleOutcome === "rejected"
        ? "review.multisig.stale.notSentOther"
        : "review.multisig.stale.notSent",
  );
  const fresh = freshApprovalsText(intent.configSnapshot.threshold);
  return {
    canSign: false,
    note: t(
      hasReplacement
        ? "review.multisig.note.continueNewProposal"
        : "review.multisig.note.proposeAgain",
      { fresh, lead },
    ),
    packageIsPrimary: false,
    primary: button({
      attributes: { "data-ms-propose-again": "true", "data-ms-refresh-intent": intent.id },
      label: t(
        hasReplacement
          ? "review.multisig.action.continueNewProposal"
          : "review.multisig.action.proposeAgain",
      ),
    }),
  };
};

const collaborationTools = (
  intent: ArgentMultisigSigningIntent,
  canImport: boolean,
  packageIsPrimary: boolean,
  canShareSecurely: boolean,
): string => {
  const signatures = intent.signatures
    .map((signature, index) =>
      button({
        attributes: {
          "data-ms-copy-signature": intent.id,
          "data-ms-signature-index": String(index),
        },
        icon: "copy",
        label: t("review.multisig.collab.signatureFrom", {
          key: accountLabel(signature.publicKey),
        }),
        size: "small",
        variant: "ghost",
      }),
    )
    .join("");
  return `<details class="disclosure multisig-collaboration">
    <summary>
      <span class="menu-copy"><strong>${th("review.multisig.collab.handoff")}</strong><small>${th("review.multisig.collab.collected", { signed: String(intent.signatures.length), threshold: String(intent.configSnapshot.threshold) })}</small></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">
      ${
        packageIsPrimary
          ? ""
          : `<section class="multisig-handoff-section">
              <div class="multisig-handoff-copy">
                <strong>${th("review.multisig.collab.shareTitle")}</strong>
                <p>${th("review.multisig.collab.shareHint")}</p>
              </div>
              <div class="multisig-collaboration-actions">
                ${
                  canShareSecurely
                    ? button({
                        attributes: { "data-ms-share": intent.id },
                        icon: "send",
                        label: t("review.multisig.action.shareSecurely"),
                        size: "small",
                        variant: "secondary",
                      })
                    : ""
                }
                ${button({
                  attributes: { "data-ms-copy-package": intent.id },
                  icon: "copy",
                  label: t("review.multisig.collab.copyFullPackage"),
                  size: "small",
                  variant: "secondary",
                })}
              </div>
            </section>`
      }
      ${
        canImport
          ? `<section class="multisig-handoff-section">
              <div class="multisig-handoff-copy">
                <strong>${th("review.multisig.collab.addTitle")}</strong>
                <p>${th("review.multisig.collab.addHint")}</p>
              </div>
              <form data-ms-signature-form="${escapeHtml(intent.id)}">
                ${textareaField({ label: t("review.multisig.collab.fragment"), name: "signature", placeholder: '{"publicKey":"0x…","r":"0x…","s":"0x…"}', required: true, rows: 3, spellcheck: false })}
                ${button({ label: t("review.multisig.collab.verifyAdd"), size: "small", type: "submit", variant: "secondary" })}
              </form>
            </section>`
          : ""
      }
      ${
        signatures
          ? `<details class="disclosure multisig-fragment-exports">
              <summary>
                <span class="menu-copy"><strong>${th("review.multisig.collab.fragmentsTitle")}</strong><small>${th("review.multisig.collab.fragmentsAvailable", { count: String(intent.signatures.length) })}</small></span>
                <span class="disclosure-mark">${icon("chevronRight")}</span>
              </summary>
              <div class="disclosure-body multisig-collaboration-actions">${signatures}</div>
            </details>`
          : ""
      }
    </div>
  </details>`;
};

/**
 * Shows one primary next step and, for failed broadcasts, one explicit fallback.
 * Signature transport remains under disclosure without competing with submission.
 */
export const multisigIntentActions = (
  intent: ArgentMultisigSigningIntent,
  availableSigners: readonly SignerOption[],
  hasLocalSigner: boolean,
  hasFreshAuthority: boolean,
  isReplacement = false,
  hasReplacement = false,
): string => {
  const action = intentAction(
    intent,
    availableSigners,
    hasLocalSigner,
    hasFreshAuthority,
    hasReplacement,
  );
  const note = isReplacement
    ? t("review.multisig.note.replacement", {
        fresh: freshApprovalsText(intent.configSnapshot.threshold),
        signed: String(intent.signatures.length),
      })
    : action.note;
  return `${
    action.canSign
      ? selectField({
          label: t("review.multisig.signerSelect"),
          name: "signerAccountId",
          options: availableSigners,
        })
      : ""
  }
    <div class="multisig-intent-action" data-live-group data-live-key="multisig-intent:${escapeHtml(intent.id)}:state" data-live-value="${escapeHtml(`${intent.state}:${intent.signatures.length}`)}">
      ${note ? `<p class="multisig-action-note">${escapeHtml(note)}</p>` : ""}
      ${action.primary}
      ${action.secondary ?? ""}
      ${
        intent.state === "collecting" && hasFreshAuthority
          ? button({
              attributes: { "data-ms-share": intent.id },
              icon: "send",
              label: t("review.multisig.action.shareSecurely"),
              variant: "secondary",
            })
          : ""
      }
      ${button({ attributes: { "data-view": "multisig-home" }, label: t("review.multisig.action.goToAccount"), variant: "ghost" })}
    </div>
    ${
      intent.state === "stale"
        ? ""
        : collaborationTools(
            intent,
            intent.state === "collecting" && hasFreshAuthority,
            action.packageIsPrimary,
            intent.state === "ready" && hasFreshAuthority,
          )
    }`;
};

/**
 * Replaces a submitted intent review with the wallet's standard transaction
 * receipt while confirmation remains pending. Accepted outcomes live in Activity.
 */
export const multisigIntentOutcome = (intent: ArgentMultisigSigningIntent): string | null => {
  if (intent.state !== "submitted") return null;
  const hash = intent.broadcastTransactionHash ?? intent.prepared.transactionHash;
  return `<section class="send-outcome send-success multisig-intent-success" data-ms-intent="${escapeHtml(intent.id)}" role="status" aria-live="polite">
    <span class="send-outcome-mark" aria-hidden="true">
      <svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg>
    </span>
    <div class="send-outcome-copy">
      <p class="send-outcome-kicker">${th("review.multisig.outcome.kicker")}</p>
      <h2>${th("review.multisig.outcome.title")}</h2>
      <p>${escapeHtml(intent.summary)}</p>
      <div class="address-line">
        <code title="${escapeHtml(hash)}">${escapeHtml(accountLabel(hash))}</code>
        ${button({
          attributes: { "data-copy": hash },
          icon: "copy",
          label: t("review.multisig.outcome.copyHash"),
          size: "small",
          variant: "ghost",
        })}
      </div>
    </div>
    <div class="send-actions">
      ${button({ attributes: { "data-view": "activity" }, icon: "activity", label: t("review.multisig.outcome.activity") })}
      ${button({ attributes: { "data-view": "multisig-home" }, label: t("review.multisig.outcome.back"), variant: "secondary" })}
    </div>
  </section>`;
};
