/** State-based action hierarchy for one frozen Argent multisig intent. */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import { button } from "@bramble/ui-kit/controls";
import { selectField, textareaField } from "@bramble/ui-kit/fields";
import { icon } from "../../shared/icons";
import { accountLabel } from "../../shared/parts";

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
      note: "The signers changed since this transaction was frozen. Signing and submission stay blocked.",
      packageIsPrimary: false,
      primary: button({
        attributes: { "data-view": "multisig-signers" },
        label: "Review current signers",
        variant: "secondary",
      }),
    };
  }
  if (intent.state === "ready") {
    return {
      canSign: false,
      note: "",
      packageIsPrimary: false,
      primary: button({ attributes: { "data-ms-submit": intent.id }, label: "Submit transaction" }),
    };
  }
  if (intent.state === "stale") {
    const retryable = intent.signatures.length === intent.configSnapshot.threshold;
    const approvals = `${intent.configSnapshot.threshold} approval${intent.configSnapshot.threshold === 1 ? "" : "s"}`;
    const freshApprovals = `${intent.configSnapshot.threshold} fresh approval${intent.configSnapshot.threshold === 1 ? "" : "s"}`;
    return {
      canSign: false,
      note: retryable
        ? hasReplacement
          ? `Nothing was sent. Network fees rose above this signed transaction's limit. Continue the fee-updated transaction and collect ${freshApprovals}. You can retry this version with its existing ${approvals} if network fees fall.`
          : `Nothing was sent. Network fees rose above this signed transaction's limit. Update the network fee and collect ${freshApprovals}. You can retry this version with its existing ${approvals} if network fees fall.`
        : "Nothing was sent. This version is out of date — create a new transaction to continue.",
      packageIsPrimary: false,
      primary: button({
        attributes: { "data-ms-refresh-intent": intent.id },
        label: hasReplacement
          ? "Continue fee-updated transaction"
          : retryable
            ? "Update network fee"
            : "Create current transaction",
      }),
      ...(retryable
        ? {
            secondary: button({
              attributes: { "data-ms-submit": intent.id },
              label: "Try unchanged fee again",
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
        label: "Sign reviewed transaction",
      }),
    };
  }
  if (intent.state === "collecting") {
    return {
      canSign: false,
      note: hasLocalSigner
        ? "This wallet has already signed. Share the package to collect the remaining signature."
        : "No eligible signer is available in this wallet. Share the package with a signer.",
      packageIsPrimary: true,
      primary: button({
        attributes: { "data-ms-copy-package": intent.id },
        label: "Copy transaction package",
      }),
    };
  }
  return {
    canSign: false,
    note: "Nothing left to do here.",
    packageIsPrimary: false,
    primary: "",
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
        label: `Signature from ${accountLabel(signature.publicKey)}`,
        size: "small",
        variant: "ghost",
      }),
    )
    .join("");
  return `<details class="disclosure multisig-collaboration">
    <summary>
      <span class="menu-copy"><strong>Co-signer handoff</strong><small>${intent.signatures.length} of ${intent.configSnapshot.threshold} signatures collected</small></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">
      ${
        packageIsPrimary
          ? ""
          : `<section class="multisig-handoff-section">
              <div class="multisig-handoff-copy">
                <strong>Share the reviewed transaction</strong>
                <p>Copies the transaction and every signature collected so far for another Bramble signer.</p>
              </div>
              <div class="multisig-collaboration-actions">
                ${
                  canShareSecurely
                    ? button({
                        attributes: { "data-ms-share": intent.id },
                        icon: "send",
                        label: "Share securely with co-signers",
                        size: "small",
                        variant: "secondary",
                      })
                    : ""
                }
                ${button({
                  attributes: { "data-ms-copy-package": intent.id },
                  icon: "copy",
                  label: "Copy full transaction package",
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
                <strong>Add a co-signer signature</strong>
                <p>Paste one signature fragment returned by a signer. It is verified before it counts toward the threshold.</p>
              </div>
              <form data-ms-signature-form="${escapeHtml(intent.id)}">
                ${textareaField({ label: "Signature fragment", name: "signature", placeholder: '{"publicKey":"0x…","r":"0x…","s":"0x…"}', required: true, rows: 3, spellcheck: false })}
                ${button({ label: "Verify and add signature", size: "small", type: "submit", variant: "secondary" })}
              </form>
            </section>`
          : ""
      }
      ${
        signatures
          ? `<details class="disclosure multisig-fragment-exports">
              <summary>
                <span class="menu-copy"><strong>Individual signature fragments</strong><small>Advanced handoff · ${intent.signatures.length} available</small></span>
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
    ? `The network fee was updated, which created a different transaction hash. Approvals from the previous attempt cannot authorize this version. ${intent.signatures.length} of ${intent.configSnapshot.threshold} fresh ${intent.configSnapshot.threshold === 1 ? "approval" : "approvals"} collected.`
    : action.note;
  return `${
    action.canSign
      ? selectField({
          label: "Signer in this wallet",
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
              label: "Share securely with co-signers",
              variant: "secondary",
            })
          : ""
      }
      ${button({ attributes: { "data-view": "multisig-home" }, label: "Go to multisig account", variant: "ghost" })}
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
      <p class="send-outcome-kicker">Submitted to Starknet</p>
      <h2>Transaction submitted</h2>
      <p>${escapeHtml(intent.summary)}</p>
      <div class="address-line">
        <code title="${escapeHtml(hash)}">${escapeHtml(accountLabel(hash))}</code>
        ${button({
          attributes: { "data-copy": hash },
          icon: "copy",
          label: "Copy transaction hash",
          size: "small",
          variant: "ghost",
        })}
      </div>
    </div>
    <div class="send-actions">
      ${button({ attributes: { "data-view": "activity" }, icon: "activity", label: "View in Activity" })}
      ${button({ attributes: { "data-view": "multisig-home" }, label: "Back to multisig", variant: "secondary" })}
    </div>
  </section>`;
};
