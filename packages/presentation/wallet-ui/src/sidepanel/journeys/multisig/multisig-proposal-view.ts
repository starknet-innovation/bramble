/**
 * Proposal composition, decoded effects, lifecycle actions, and independent
 * review surfaces. Kept separate from the Multisig home so both remain small
 * enough to audit directly.
 */
import { escapeHtml } from "@mc-wallet/core/html";
import { confirmationCompletesQuorum } from "@mc-wallet/multisig/chain";
import type { MultisigProposalRecord, MultisigRecord } from "@mc-wallet/multisig/repository";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { emptyState } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { textareaField } from "@mc-wallet/ui-kit/fields";
import type { UiAttributes } from "@mc-wallet/ui-kit/html-attributes";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS, sameFelt } from "@mc-wallet/wallet-model/networks";
import { icon } from "../../shared/icons";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  copyButton,
  hardwareBadge,
} from "../../shared/parts";
import { qrSvg } from "../../shared/qr";
import { starknetNetworkGlyph } from "../portfolio/token-row";
import {
  multisigDisplayName,
  multisigProposalEffect,
  multisigProposalQrPayload,
  serializeMultisigReviewPackage,
} from "./multisig-model";

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
  signerAccountId?: string,
): UiAttributes => ({
  [`data-ms-${action}`]: proposalId,
  "data-ms-action-allowed": String(allowed),
  ...(signerAccountId ? { "data-ms-signer-id": signerAccountId } : {}),
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
  const candidates = confirmationCandidates(proposal, localSigners);
  const confirmAllowed = candidates.length > 0 && proposal.state !== "confirmed";
  const preferredSigner =
    localSigners.find((signer) => signer.id === activeAccount?.id) ?? localSigners[0];
  const revokeSigner =
    proposal.confirmedBySigner === true && proposal.confirmedBySignerAddress
      ? localSigners.find((signer) =>
          sameFelt(signer.address, proposal.confirmedBySignerAddress ?? ""),
        )
      : undefined;
  const revokeAllowed = revokeSigner !== undefined;
  const requiresAck = proposal.call === null;
  const execute =
    proposal.state === "confirmed"
      ? proposal.call
        ? preferredSigner
          ? button({
              attributes: {
                "data-ms-execute": proposal.id,
                "data-ms-signer-id": preferredSigner.id,
              },
              icon: "send",
              label: "Execute",
              size: "small",
              variant: "secondary",
            })
          : '<span class="hint proposal-action-hint">This wallet does not own a current signer for execution.</span>'
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
      attributes: actionAttributes(
        "revoke",
        proposal.id,
        revokeAllowed,
        requiresAck,
        revokeSigner?.id,
      ),
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
  const initialMode = canConfirmAndExecute ? "confirm-and-execute" : "confirm-only";
  const effect = proposal.call
    ? multisigProposalEffect(proposal.call, selected, preferences)
    : null;
  const network = STARKNET_NETWORKS[record.networkId];
  return `<section class="multisig-review-sheet" data-ms-confirm-panel="${escapeHtml(proposal.id)}" data-ms-confirm-mode="${initialMode}" role="dialog" aria-modal="true" aria-labelledby="confirm-${escapeHtml(proposal.id)}-title" tabindex="-1" hidden>
    <div class="multisig-review-card multisig-confirm-card">
      <div class="row multisig-confirm-head">
        <div><p class="eyebrow">Confirmation review</p><h2 id="confirm-${escapeHtml(proposal.id)}-title">Confirm this proposal</h2></div>
        ${button({
          attributes: { "data-ms-confirm-cancel": proposal.id },
          icon: "x",
          label: "Close",
          size: "small",
          variant: "ghost",
        })}
      </div>
      <div class="multisig-confirm-scroll">
        <div class="proposal-confirm-summary">
          <div><span>Proposal</span><strong>${escapeHtml(proposal.summary || "Untitled proposal")}</strong></div>
          <div><span>Multisig</span><strong>${escapeHtml(multisigDisplayName(record))}</strong></div>
          <div><span>Network</span><strong class="network-inline-value"><span class="network-inline-mark">${starknetNetworkGlyph()}</span>${escapeHtml(network.name)}</strong></div>
          <div><span>Current approval</span><strong>${proposal.confirmations} of ${record.quorum}</strong></div>
        </div>
        ${
          effect
            ? `<div class="proposal-effect proposal-confirm-effect">
                <span class="proposal-effect-mark">${icon(effect.targetKind === "Tracked ERC-20" ? "coins" : "alert")}</span>
                <div><p class="eyebrow">This transaction will</p><strong>${escapeHtml(effect.summary)}</strong><span>${escapeHtml(effect.targetLabel)} · ${escapeHtml(effect.targetKind)}</span></div>
              </div>
              ${effect.flags.map((flag) => `<p class="review-flag">${escapeHtml(flag)}</p>`).join("")}`
            : ""
        }
        ${technicalDetails(proposal)}
        ${
          canConfirmAndExecute
            ? `<div class="multisig-confirm-modes" role="group" aria-label="Confirmation action">
                <button class="multisig-confirm-mode" data-ms-confirm-mode-option="confirm-and-execute" type="button" aria-pressed="true"><span><strong>Confirm &amp; execute</strong><small>One atomic transaction. A failed execution also drops this confirmation.</small></span>${icon("check")}</button>
                <button class="multisig-confirm-mode" data-ms-confirm-mode-option="confirm-only" type="button" aria-pressed="false"><span><strong>Confirm only</strong><small>Record this confirmation now and execute in a later transaction.</small></span>${icon("check")}</button>
              </div>`
            : ""
        }
        <fieldset class="multisig-confirm-fieldset">
          <legend>Sign with</legend>
          <p class="hint">These wallet accounts match the latest signer rules read from Starknet.</p>
          <div class="multisig-confirm-signers">
            ${candidates
              .map(
                (
                  signer,
                ) => `<button class="multisig-confirm-signer" data-ms-confirm-proposal="${escapeHtml(proposal.id)}" data-ms-confirm-signer="${escapeHtml(signer.id)}" type="button" aria-pressed="${signer.id === selected.id}">
                  <span class="option-avatar">${accountAvatar(signer.address)}</span>
                  <span class="send-recipient-copy"><strong>${escapeHtml(accountDisplayName(signer, preferences))}${hardwareBadge(signer)}</strong><span>${escapeHtml(accountLabel(signer.address))}</span></span>
                  <span class="multisig-signer-check">${icon("check")}</span>
                </button>`,
              )
              .join("")}
          </div>
        </fieldset>
        <div class="review-panel" role="note" data-ms-confirm-note>
          <p>${
            canConfirmAndExecute
              ? "The contract rechecks quorum before execution. Review the exact effect and fee above before signing."
              : completesQuorum
                ? "This proposal was tracked by id only, so this wallet cannot safely reconstruct its execution."
                : "This records one confirmation. Execution becomes available only after quorum."
          }</p>
        </div>
      </div>
      <div class="multisig-confirm-actions">
        <div class="multisig-confirm-fee" data-ms-confirm-fee><span>Network fee</span><strong>Checking estimate…</strong></div>
        ${button({
          attributes: {
            "data-ms-confirm-retry-fee": proposal.id,
            hidden: true,
          },
          className: "multisig-confirm-retry",
          icon: "refresh",
          label: "Retry fee estimate",
          size: "small",
          variant: "secondary",
        })}
        ${button({
          attributes: {
            "data-ms-confirm-submit": proposal.id,
            "data-ms-confirm-submit-mode": initialMode,
            "data-ms-selected-signer": selected.id,
          },
          disabled: true,
          icon: "check",
          label: canConfirmAndExecute ? "Confirm & execute" : "Confirm proposal",
        })}
        <p data-ms-confirm-status role="status" aria-live="polite">Reviewing signer and network fee…</p>
      </div>
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
          <span class="hint" data-live-key="proposal-state:${escapeHtml(proposal.id)}" data-live-value="${proposal.state}:${proposal.confirmations}">${escapeHtml(stateLabel[proposal.state])} · ${proposal.confirmations} of ${record.quorum}</span>
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
