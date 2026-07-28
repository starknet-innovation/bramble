/**
 * Proposal composition, decoded effects, lifecycle actions, and independent
 * review surfaces. Kept separate from the Multisig home so both remain small
 * enough to audit directly.
 */
import { escapeHtml } from "../shared/html";
import { sameFelt } from "../starknet/networks";
import type { MultisigProposalRecord, MultisigRecord } from "../storage/multisig-store";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState } from "../ui/content";
import { button } from "../ui/controls";
import { textareaField } from "../ui/fields";
import type { UiAttributes } from "../ui/html-attributes";
import { icon } from "./icons";
import {
  multisigProposalEffect,
  multisigProposalQrPayload,
  serializeMultisigReviewPackage,
} from "./multisig-model";
import { accountLabel, copyButton } from "./parts";
import { qrSvg } from "./qr";

const stateLabel: Readonly<Record<MultisigProposalRecord["state"], string>> = {
  confirmed: "Ready to execute",
  executed: "Executed",
  "not-found": "Not found",
  pending: "Collecting confirmations",
};

const actionAttributes = (
  action: "confirm" | "revoke",
  proposalId: string,
  allowed: boolean,
  requiresAck: boolean,
): UiAttributes => ({
  [`data-ms-${action}`]: proposalId,
  "data-ms-action-allowed": String(allowed),
  ...(requiresAck ? { "data-ms-requires-ack": "true" } : {}),
});

const proposalActions = (
  proposal: MultisigProposalRecord,
  canSign: boolean,
  signerAddress: string | null,
): string => {
  if (proposal.state === "executed" || proposal.state === "not-found") return "";
  const signerSnapshotIsCurrent =
    signerAddress !== null &&
    proposal.confirmedBySignerAddress !== undefined &&
    sameFelt(signerAddress, proposal.confirmedBySignerAddress);
  const confirmAllowed =
    canSign &&
    signerSnapshotIsCurrent &&
    proposal.state !== "confirmed" &&
    proposal.confirmedBySigner === false;
  const revokeAllowed = canSign && signerSnapshotIsCurrent && proposal.confirmedBySigner === true;
  const requiresAck = proposal.call === null;
  const execute =
    proposal.state === "confirmed"
      ? proposal.call
        ? button({
            attributes: { "data-ms-execute": proposal.id },
            icon: "send",
            label: "Execute",
            size: "small",
            variant: "secondary",
          })
        : '<span class="hint proposal-action-hint">Execute from the proposing wallet because pasted ids do not carry call data.</span>'
      : "";
  return `<div class="proposal-actions" aria-label="Proposal actions">
    ${button({
      attributes: actionAttributes("confirm", proposal.id, confirmAllowed, requiresAck),
      disabled: !confirmAllowed || requiresAck,
      icon: "check",
      label: "Confirm",
      size: "small",
      variant: "secondary",
    })}
    ${button({
      attributes: actionAttributes("revoke", proposal.id, revokeAllowed, requiresAck),
      disabled: !revokeAllowed || requiresAck,
      icon: "x",
      label: "Revoke",
      size: "small",
      variant: "secondary",
    })}
    ${execute}
  </div>`;
};

const technicalDetails = (proposal: MultisigProposalRecord): string => {
  if (!proposal.call) {
    return `<div class="review-panel" role="note">
      <p class="review-flag">The pasted proposal id does not include its call. Verify the exact effect independently before confirming.</p>
      <label class="hint"><input type="checkbox" data-ms-ack /> I verified what this proposal does</label>
    </div>`;
  }
  const call = proposal.call;
  return `<details class="disclosure proposal-disclosure">
    <summary>
      <span class="menu-copy"><strong>Call details</strong></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">
      <p>Target <code>${escapeHtml(accountLabel(call.contractAddress))}</code></p>
      <p>Method <code>${escapeHtml(call.entrypoint)}</code></p>
      <p>Calldata <code>${escapeHtml(call.calldata.join(" ")) || "(empty)"}</code></p>
      <p>Proposal salt <code>${escapeHtml(call.salt)}</code></p>
    </div>
  </details>`;
};

const independentReview = (record: MultisigRecord, proposal: MultisigProposalRecord): string => {
  const packageText = serializeMultisigReviewPackage(record, proposal);
  return `<section class="multisig-review-sheet" data-ms-review-panel="${escapeHtml(proposal.id)}" role="dialog" aria-modal="true" aria-label="Independent proposal review" hidden>
    <div class="multisig-review-card">
      <div class="row">
        <div><p class="eyebrow">Independent review</p><h2>Verify on another device</h2></div>
        ${button({
          attributes: { "data-ms-review-close": proposal.id },
          icon: "x",
          label: "Close",
          size: "small",
          variant: "ghost",
        })}
      </div>
      <div class="multisig-review-qr">${qrSvg(multisigProposalQrPayload(proposal), "QR code for proposal id")}</div>
      <p class="hint">Scan the on-chain proposal id, or copy the exact secret-free package into an offline decoder. Compare the id before approving.</p>
      ${button({
        attributes: { "data-copy": packageText },
        icon: "copy",
        label: "Copy review package",
        variant: "secondary",
      })}
      <details class="disclosure">
        <summary><span class="menu-copy"><strong>Decode a package locally</strong><span>No network request is made</span></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
        <div class="disclosure-body">
          ${textareaField({
            autocomplete: "off",
            className: "mono",
            label: "Paste review package",
            name: "reviewPackage",
            rows: 3,
            spellcheck: false,
          })}
          ${button({
            attributes: { "data-ms-review-decode": proposal.id },
            label: "Decode locally",
            size: "small",
            variant: "secondary",
          })}
          <div data-ms-review-output role="status"></div>
        </div>
      </details>
    </div>
  </section>`;
};

const proposalRow = (
  proposal: MultisigProposalRecord,
  record: MultisigRecord,
  canSign: boolean,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string => {
  const effect = proposal.call ? multisigProposalEffect(proposal.call, account, preferences) : null;
  return `<li class="allowance-row proposal-row">
    <div class="proposal-copy">
      <div class="proposal-head">
        <div class="proposal-title">
          <strong>${escapeHtml(proposal.summary || "Untitled proposal")}</strong>
          <span class="hint">${escapeHtml(stateLabel[proposal.state])} · ${proposal.confirmations} of ${record.quorum}</span>
        </div>
        ${copyButton(proposal.txId, "Copy proposal id")}
      </div>
      <code class="proposal-id">${escapeHtml(accountLabel(proposal.txId))}</code>
      ${
        effect
          ? `<div class="proposal-effect">
              <span class="proposal-effect-mark">${icon(effect.targetKind === "Tracked ERC-20" ? "coins" : "alert")}</span>
              <div><p class="eyebrow">This proposal will</p><strong>${escapeHtml(effect.summary)}</strong><span>${escapeHtml(effect.targetLabel)} · ${escapeHtml(effect.targetKind)}</span></div>
            </div>
            ${effect.flags.map((flag) => `<p class="review-flag">${escapeHtml(flag)}</p>`).join("")}`
          : ""
      }
      <div class="proposal-review-links">
        ${technicalDetails(proposal)}
        ${button({
          attributes: { "data-ms-review-open": proposal.id },
          icon: "qrCode",
          label: "Verify elsewhere",
          size: "small",
          variant: "ghost",
        })}
      </div>
      ${proposalActions(proposal, canSign, account?.address ?? null)}
    </div>
    ${independentReview(record, proposal)}
  </li>`;
};

/**
 * Renders tracked proposals with decoded effects and independent review tools.
 */
export const multisigProposalList = (
  record: MultisigRecord,
  proposals: readonly MultisigProposalRecord[],
  canSign: boolean,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string =>
  proposals.length === 0
    ? emptyState("No proposals yet. Create one, or track an id shared by another signer.")
    : `<ul class="allowance-list">${proposals
        .map((proposal) => proposalRow(proposal, record, canSign, account, preferences))
        .join("")}</ul>`;
