/**
 * Proposal composition, decoded effects, lifecycle actions, and independent
 * review surfaces. Kept separate from the Multisig home so both remain small
 * enough to audit directly.
 */
import { escapeHtml } from "../shared/html";
import { confirmationCompletesQuorum } from "../starknet/multisig";
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
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  copyButton,
  hardwareBadge,
} from "./parts";
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

const confirmationCandidates = (
  proposal: MultisigProposalRecord,
  localSigners: readonly AccountRef[],
): readonly AccountRef[] => {
  const alreadyConfirmed =
    proposal.confirmedSignerAddresses ??
    (proposal.confirmedBySigner === true && proposal.confirmedBySignerAddress
      ? [proposal.confirmedBySignerAddress]
      : []);
  return localSigners.filter(
    (signer) => !alreadyConfirmed.some((confirmed) => sameFelt(signer.address, confirmed)),
  );
};

const proposalActions = (
  proposal: MultisigProposalRecord,
  localSigners: readonly AccountRef[],
  activeAccount: AccountRef | null,
): string => {
  if (proposal.state === "executed" || proposal.state === "not-found") return "";
  const signerAddress = activeAccount?.address ?? null;
  const signerSnapshotIsCurrent =
    signerAddress !== null &&
    proposal.confirmedBySignerAddress !== undefined &&
    sameFelt(signerAddress, proposal.confirmedBySignerAddress);
  const candidates = confirmationCandidates(proposal, localSigners);
  const confirmAllowed = candidates.length > 0 && proposal.state !== "confirmed";
  const activeCanSign =
    activeAccount !== null && localSigners.some((signer) => signer.id === activeAccount.id);
  const revokeAllowed =
    activeCanSign && signerSnapshotIsCurrent && proposal.confirmedBySigner === true;
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
      attributes: {
        "data-ms-action-allowed": String(confirmAllowed),
        "data-ms-confirm-open": proposal.id,
        ...(requiresAck ? { "data-ms-requires-ack": "true" } : {}),
      },
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

const confirmationReview = (
  record: MultisigRecord,
  proposal: MultisigProposalRecord,
  localSigners: readonly AccountRef[],
  activeAccount: AccountRef | null,
  preferences: WalletPreferences | null,
): string => {
  const candidates = confirmationCandidates(proposal, localSigners);
  if (proposal.state !== "pending" || candidates.length === 0) {
    return "";
  }
  const selected = candidates.find((signer) => signer.id === activeAccount?.id) ?? candidates[0];
  if (!selected) {
    return "";
  }
  // Candidates exclude signers who already confirmed, so `selected` has not.
  const completesQuorum = confirmationCompletesQuorum({
    confirmations: proposal.confirmations,
    quorum: record.quorum,
    signerHasConfirmed: false,
    state: proposal.state,
  });
  // Executing re-derives the proposal id from the original call, so a proposal
  // tracked by id only can be confirmed here but never executed from here.
  const canConfirmAndExecute = completesQuorum && proposal.call !== null;
  return `<section class="multisig-review-sheet" data-ms-confirm-panel="${escapeHtml(proposal.id)}" role="dialog" aria-modal="true" aria-labelledby="confirm-${escapeHtml(proposal.id)}-title" hidden>
    <div class="multisig-review-card multisig-confirm-card">
      <div class="row">
        <div><p class="eyebrow">Confirmation review</p><h2 id="confirm-${escapeHtml(proposal.id)}-title">Confirm this proposal</h2></div>
        ${button({
          attributes: { "data-ms-confirm-cancel": proposal.id },
          icon: "x",
          label: "Close",
          size: "small",
          variant: "ghost",
        })}
      </div>
      <div class="proposal-confirm-summary">
        <div><span>Proposal</span><strong>${escapeHtml(proposal.summary || "Untitled proposal")}</strong></div>
        <div><span>Current approval</span><strong>${proposal.confirmations} of ${record.quorum}</strong></div>
        <div><span>Result</span><strong>${completesQuorum ? `Reaches quorum at ${record.quorum} of ${record.quorum}` : "Add one signer confirmation"}</strong></div>
      </div>
      <fieldset class="multisig-confirm-fieldset">
        <legend>Sign with</legend>
        <p class="hint">These wallet accounts match the latest signer rules read from Starknet.</p>
        <div class="multisig-confirm-signers">
          ${candidates
            .map(
              (
                signer,
              ) => `<button class="multisig-confirm-signer" data-ms-confirm-proposal="${escapeHtml(proposal.id)}" data-ms-confirm-signer="${escapeHtml(signer.id)}" data-ms-confirm-signer-active="${signer.id === activeAccount?.id}" type="button" aria-pressed="${signer.id === selected.id}">
                <span class="option-avatar">${accountAvatar(signer.address)}</span>
                <span class="send-recipient-copy"><strong>${escapeHtml(accountDisplayName(signer, preferences))}${hardwareBadge(signer)}</strong><span>${escapeHtml(accountLabel(signer.address))}</span></span>
                <span class="multisig-signer-check">${icon("check")}</span>
              </button>`,
            )
            .join("")}
        </div>
      </fieldset>
      <div class="review-panel" role="note">
        <p>${
          canConfirmAndExecute
            ? "Your confirmation reaches quorum, so it can execute the proposal in the same transaction. If execution fails, your confirmation is not recorded either — confirm without executing to record it on its own."
            : completesQuorum
              ? "Your confirmation reaches quorum, but this proposal was tracked by id only, so executing needs the wallet that proposed it."
              : "This signs one confirmation. It does not execute the proposal; execution becomes available only after quorum."
        }</p>
      </div>
      ${
        canConfirmAndExecute
          ? button({
              attributes: {
                "data-ms-and-execute": "true",
                "data-ms-confirm-submit": proposal.id,
                "data-ms-selected-signer": selected.id,
              },
              icon: "send",
              label: "Confirm & execute",
            })
          : ""
      }
      ${button({
        attributes: {
          "data-ms-confirm-submit": proposal.id,
          "data-ms-selected-signer": selected.id,
        },
        icon: "check",
        label: canConfirmAndExecute ? "Confirm only" : "Confirm proposal",
        ...(canConfirmAndExecute ? { variant: "secondary" as const } : {}),
      })}
      <p data-ms-confirm-status role="status"></p>
    </div>
  </section>`;
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
  localSigners: readonly AccountRef[],
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
      ${proposalActions(proposal, localSigners, account)}
    </div>
    ${confirmationReview(record, proposal, localSigners, account, preferences)}
    ${independentReview(record, proposal)}
  </li>`;
};

/**
 * Renders tracked proposals with decoded effects and independent review tools.
 */
export const multisigProposalList = (
  record: MultisigRecord,
  proposals: readonly MultisigProposalRecord[],
  accounts: readonly AccountRef[],
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string => {
  const localSigners = accounts.filter(
    (stored) =>
      stored.networkId === record.networkId &&
      record.signers.some((signer) => sameFelt(signer, stored.address)),
  );
  return proposals.length === 0
    ? emptyState("No proposals yet. Create one, or track an id shared by another signer.")
    : `<ul class="allowance-list">${proposals
        .map((proposal) => proposalRow(proposal, record, localSigners, account, preferences))
        .join("")}</ul>`;
};
