/** State-based action hierarchy for one frozen Argent multisig intent. */

import { escapeHtml } from "@mc-wallet/core/html";
import type { ArgentMultisigSigningIntent } from "@mc-wallet/multisig/repository";
import { button } from "@mc-wallet/ui-kit/controls";
import { selectField, textareaField } from "@mc-wallet/ui-kit/fields";
import { icon } from "../../shared/icons";
import { accountLabel } from "../../shared/parts";

type SignerOption = { readonly label: string; readonly value: string };
type IntentAction = {
  readonly canSign: boolean;
  readonly note: string;
  readonly packageIsPrimary: boolean;
  readonly primary: string;
};

const intentAction = (
  intent: ArgentMultisigSigningIntent,
  availableSigners: readonly SignerOption[],
  hasLocalSigner: boolean,
  hasFreshAuthority: boolean,
): IntentAction => {
  if (!hasFreshAuthority) {
    return {
      canSign: false,
      note: "Current signer authority differs from this frozen intent. Signing and submission remain blocked.",
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
      note: "Signature threshold reached. This transaction is ready to submit.",
      packageIsPrimary: false,
      primary: button({ attributes: { "data-ms-submit": intent.id }, label: "Submit transaction" }),
    };
  }
  if (intent.state === "stale") {
    return {
      canSign: false,
      note: "This transaction snapshot is stale. Prepare a replacement before collecting signatures.",
      packageIsPrimary: false,
      primary: button({
        attributes: { "data-view": "multisig-propose" },
        label: "Prepare replacement intent",
        variant: "secondary",
      }),
    };
  }
  if (intent.state === "collecting" && availableSigners.length > 0) {
    return {
      canSign: true,
      note: "Review the outcome and fee ceiling before adding this wallet’s signature.",
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
        label: "Copy intent package",
      }),
    };
  }
  return {
    canSign: false,
    note: "This intent has no further wallet action.",
    packageIsPrimary: false,
    primary: "",
  };
};

const collaborationTools = (
  intent: ArgentMultisigSigningIntent,
  canImport: boolean,
  packageIsPrimary: boolean,
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
                <p>Copies the transaction and every signature collected so far for another MC Wallet signer.</p>
              </div>
              ${button({
                attributes: { "data-ms-copy-package": intent.id },
                icon: "copy",
                label: "Copy full intent package",
                size: "small",
                variant: "secondary",
              })}
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
 * Shows exactly one primary next step for the current intent state. Signature
 * transport remains available under disclosure without competing with signing
 * or submission.
 */
export const multisigIntentActions = (
  intent: ArgentMultisigSigningIntent,
  availableSigners: readonly SignerOption[],
  hasLocalSigner: boolean,
  hasFreshAuthority: boolean,
): string => {
  const action = intentAction(intent, availableSigners, hasLocalSigner, hasFreshAuthority);
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
      <p class="multisig-action-note">${escapeHtml(action.note)}</p>
      ${action.primary}
    </div>
    ${collaborationTools(
      intent,
      intent.state === "collecting" && hasFreshAuthority,
      action.packageIsPrimary,
    )}`;
};

/**
 * Replaces a terminal intent review with the wallet's standard transaction
 * receipt. A submitted intent has no remaining signing controls to review.
 */
export const multisigIntentOutcome = (intent: ArgentMultisigSigningIntent): string | null => {
  if (intent.state !== "submitted" && intent.state !== "accepted") return null;
  const hash = intent.broadcastTransactionHash ?? intent.prepared.transactionHash;
  return `<section class="send-outcome send-success multisig-intent-success" data-ms-intent="${escapeHtml(intent.id)}" role="status" aria-live="polite">
    <span class="send-outcome-mark" aria-hidden="true">
      <svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg>
    </span>
    <div class="send-outcome-copy">
      <p class="send-outcome-kicker">${intent.state === "accepted" ? "Confirmed on Starknet" : "Submitted to Starknet"}</p>
      <h2>${intent.state === "accepted" ? "Transaction complete" : "Transaction submitted"}</h2>
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
      ${button({ attributes: { "data-view": "multisig-home" }, icon: "home", label: "Back to multisig" })}
    </div>
  </section>`;
};
