/**
 * Pure multisig screen templates: the watched-multisig list with add and
 * deploy entries, a multisig detail screen with signers and tracked
 * proposals, the propose form, and the deploy form. Logic-free string
 * builders; all bindings live in multisig-ui.ts.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { sameFelt } from "../starknet/networks";
import type {
  MultisigProposalCall,
  MultisigProposalRecord,
  MultisigRecord,
} from "../storage/multisig-store";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState, pill } from "../ui/content";
import { button, iconButton } from "../ui/controls";
import { textareaField, textField } from "../ui/fields";
import type { UiAttributes } from "../ui/html-attributes";
import { menuRow } from "../ui/navigation";
import {
  accountLabel,
  copyButton,
  flowHeader,
  flowScreen,
  hardwareBadge,
  noAccountEmpty,
} from "./parts";

export { multisigDeployFlow } from "./multisig-deploy-view";

const multisigDisplayName = (record: MultisigRecord): string =>
  record.name ?? accountLabel(record.address);

const stateLabel: Readonly<Record<MultisigProposalRecord["state"], string>> = {
  confirmed: "Ready to execute",
  executed: "Executed",
  "not-found": "Not found",
  pending: "Collecting confirmations",
};

const formatCalldata = (calldata: readonly string[]): string =>
  calldata.length === 0 ? "(empty)" : calldata.map((felt) => accountLabel(felt)).join(" ");

const proposalCallDetails = (call: MultisigProposalCall): string => `
  <div class="review-panel" role="note">
    <p><strong>On-chain effect when executed</strong></p>
    <p>Contract: <code>${escapeHtml(accountLabel(call.contractAddress))}</code></p>
    <p>Entrypoint: <code>${escapeHtml(call.entrypoint)}</code></p>
    <p>Calldata: <code>${escapeHtml(formatCalldata(call.calldata))}</code></p>
    <p>Salt: <code>${escapeHtml(accountLabel(call.salt))}</code></p>
  </div>`;

const untrackedProposalWarning = (): string => `
  <div class="review-panel" role="note">
    <p class="review-flag">Notes and summaries are not verified on-chain. Confirm only after verifying this proposal id on a block explorer or with the proposer.</p>
    <label class="hint">
      <input type="checkbox" data-ms-ack />
      I verified what this proposal does
    </label>
  </div>`;

const multisigRow = (record: MultisigRecord, pendingCount: number): string => `
  <li class="allowance-row">
    ${menuRow({
      attributes: { "data-multisig-open": record.id },
      icon: "wallet",
      label: multisigDisplayName(record),
      supportingText: `${record.quorum} of ${record.signers.length} signers${pendingCount > 0 ? ` · ${pendingCount} open` : ""}`,
    })}
  </li>`;

const multisigSyncNotice = (
  loadError: boolean,
  sync: "current" | "error" | null,
  retryId: string,
): string => {
  if (loadError || sync === "error") {
    return `<div class="review-panel" role="alert">
      <p class="review-flag">Could not refresh multisig state from the background or chain. Cached data may be stale.</p>
      ${button({
        attributes: { id: retryId },
        icon: "refresh",
        label: "Retry",
        size: "small",
        variant: "secondary",
      })}
    </div>`;
  }
  return sync === "current"
    ? '<p class="hint" role="status">Synced from chain when this screen opened.</p>'
    : "";
};

/**
 * Renders the Multisigs flow: watched contracts, the watch-by-address form,
 * and the entry into the deploy flow.
 */
export const multisigsFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  multisigs: readonly MultisigRecord[],
  proposals: readonly MultisigProposalRecord[],
  loadError = false,
  sync: "current" | "error" | null = null,
): string => {
  const scoped = multisigs.filter((record) => record.networkId === status.networkId);
  const openCount = (record: MultisigRecord): number =>
    proposals.filter(
      (proposal) => proposal.multisigId === record.id && proposal.state !== "executed",
    ).length;
  return (
    flowHeader("Multisigs", status, `${scoped.length} watched`) +
    flowScreen(
      "multisigs",
      `${multisigSyncNotice(loadError, sync, "multisig-list-retry")}
      <section class="section">
        <div class="row"><h2>Watched multisigs</h2>
          ${button({
            attributes: { "data-view": "multisig-deploy" },
            disabled: account === null,
            icon: "plus",
            label: "Deploy new",
            size: "small",
            variant: "secondary",
          })}
        </div>
        ${
          account === null
            ? noAccountEmpty(status)
            : scoped.length === 0
              ? emptyState("No multisigs watched yet. Watch one below or deploy a new one.")
              : `<ul class="allowance-list">${scoped.map((record) => multisigRow(record, openCount(record))).join("")}</ul>`
        }
        <p id="multisig-list-result" role="status"></p>
      </section>
      <section class="section">
        <h2>Watch a multisig</h2>
        <form id="multisig-add-form">
          ${textField({
            autocomplete: "off",
            className: "mono",
            disabled: account === null,
            label: "Contract address",
            name: "address",
            placeholder: "0x…",
            required: true,
            spellcheck: false,
          })}
          ${textField({
            autocomplete: "off",
            disabled: account === null,
            label: "Name (optional)",
            maxlength: 48,
            name: "name",
          })}
          <span class="hint">The active account must be one of the multisig's signers.</span>
          ${button({
            disabled: account === null,
            icon: "check",
            label: "Watch multisig",
            type: "submit",
            variant: "secondary",
          })}
          <p id="multisig-add-result" role="status"></p>
        </form>
      </section>`,
    )
  );
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
  if (proposal.state === "executed" || proposal.state === "not-found") {
    return "";
  }
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
        : '<span class="hint">Execute from the wallet that proposed it (call details are not shared with a pasted id).</span>'
      : "";
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
  return `<div class="row">
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

const proposalRow = (
  proposal: MultisigProposalRecord,
  quorum: number,
  canSign: boolean,
  signerAddress: string | null,
): string => `
  <li class="allowance-row">
    <div class="allowance-copy">
      <strong>${escapeHtml(proposal.summary)}</strong>
      <span class="hint">${escapeHtml(stateLabel[proposal.state])} · ${proposal.confirmations} of ${quorum} confirmations</span>
      <code>${escapeHtml(accountLabel(proposal.txId))}</code>
      ${proposal.call ? proposalCallDetails(proposal.call) : untrackedProposalWarning()}
    </div>
    ${copyButton(proposal.txId, "Copy proposal id")}
    ${proposalActions(proposal, canSign, signerAddress)}
  </li>`;

const signerRow = (
  signer: string,
  account: AccountRef | null,
  accounts: readonly AccountRef[],
): string => {
  // Badge a signer that is a Ledger account in THIS wallet, so a co-signer can
  // see at a glance which signers are hardware-backed here.
  const local = accounts.find((stored) => sameFelt(stored.address, signer));
  return `
  <li class="address-line">
    <code>${escapeHtml(accountLabel(signer))}</code>
    ${account && sameFelt(signer, account.address) ? pill("You") : ""}
    ${local ? hardwareBadge(local) : ""}
    ${copyButton(signer, "Copy signer address")}
  </li>`;
};

/**
 * Renders one multisig's detail screen: on-chain config, tracked proposals
 * with lifecycle actions, and the track-by-id form.
 */
export const multisigDetailFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  record: MultisigRecord | null,
  proposals: readonly MultisigProposalRecord[],
  loadError = false,
  sync: "current" | "error" | null = null,
): string => {
  if (!record) {
    return (
      flowHeader("Multisig", status) +
      flowScreen(
        "multisig-detail",
        loadError
          ? multisigSyncNotice(true, "error", "multisig-list-retry")
          : emptyState("This multisig is no longer watched."),
      )
    );
  }
  const tracked = proposals.filter((proposal) => proposal.multisigId === record.id);
  const canSign =
    account !== null && record.signers.some((signer) => sameFelt(signer, account.address));
  return (
    flowHeader(
      multisigDisplayName(record),
      status,
      `${record.quorum} of ${record.signers.length} signers`,
    ) +
    flowScreen(
      "multisig-detail",
      `${multisigSyncNotice(loadError, sync, "multisig-list-retry")}
      <section class="section">
        <div class="row"><h2>Contract</h2>
          <div class="header-actions">
            ${iconButton({
              attributes: { "data-multisig-id": record.id, id: "multisig-refresh" },
              icon: "refresh",
              label: "Refresh from chain",
            })}
            ${iconButton({
              attributes: { "data-multisig-remove": record.id },
              icon: "x",
              label: "Stop watching",
              tone: "danger",
            })}
          </div>
        </div>
        <p class="address-line"><code>${escapeHtml(record.address)}</code>${copyButton(record.address, "Copy multisig address")}</p>
        <h2>Signers</h2>
        <ul class="address-book">${record.signers.map((signer) => signerRow(signer, account, status.accounts)).join("")}</ul>
        <span class="hint">Signer and quorum changes are proposals the multisig sends to itself (add_signers, remove_signers, change_quorum).</span>
        <p id="multisig-detail-result" role="status"></p>
      </section>
      <section class="section">
        <div class="row"><h2>Proposals</h2>
          ${button({
            attributes: { "data-view": "multisig-propose" },
            disabled: !canSign,
            icon: "plus",
            label: "New proposal",
            size: "small",
            variant: "secondary",
          })}
        </div>
        ${
          tracked.length === 0
            ? emptyState(
                "No proposals tracked yet. Propose one, or paste an id shared by another signer.",
              )
            : `<ul class="allowance-list">${tracked.map((proposal) => proposalRow(proposal, record.quorum, canSign, account?.address ?? null)).join("")}</ul>`
        }
        <p id="multisig-proposal-result" role="status"></p>
      </section>
      <section class="section">
        <h2>Track a shared proposal</h2>
        <form id="multisig-track-form">
          ${textField({
            autocomplete: "off",
            className: "mono",
            label: "Proposal id",
            name: "txId",
            placeholder: "0x…",
            required: true,
            spellcheck: false,
          })}
          ${textField({
            autocomplete: "off",
            label: "Note (optional)",
            maxlength: 120,
            name: "summary",
          })}
          <span class="hint">Notes are not verified on-chain. Tracked proposals can be confirmed and revoked after you verify the proposal id; executing needs the original call from the proposer's wallet.</span>
          ${button({
            icon: "check",
            label: "Track proposal",
            type: "submit",
            variant: "secondary",
          })}
          <p id="multisig-track-result" role="status"></p>
        </form>
      </section>`,
    )
  );
};

/**
 * Renders the single-call proposal form for a watched multisig.
 */
export const multisigProposeFlow = (
  status: WalletStatus,
  record: MultisigRecord | null,
): string => {
  if (!record) {
    return (
      flowHeader("New proposal", status) +
      flowScreen("multisig-propose", emptyState("This multisig is no longer watched."))
    );
  }
  return (
    flowHeader("New proposal", status, multisigDisplayName(record)) +
    flowScreen(
      "multisig-propose",
      `<section class="section">
        <form id="multisig-propose-form">
          ${textField({
            autocomplete: "off",
            className: "mono",
            label: "Contract to call",
            name: "to",
            placeholder: "0x…",
            required: true,
            spellcheck: false,
          })}
          ${textField({
            autocomplete: "off",
            className: "mono",
            label: "Entrypoint",
            name: "entrypoint",
            placeholder: "transfer",
            required: true,
            spellcheck: false,
          })}
          ${textareaField({
            autocomplete: "off",
            className: "mono",
            label: "Calldata felts (space or newline separated)",
            name: "calldata",
            rows: 3,
            spellcheck: false,
          })}
          ${textField({
            autocomplete: "off",
            className: "mono",
            label: "Salt",
            name: "salt",
            spellcheck: false,
            value: "0x0",
          })}
          ${textField({
            autocomplete: "off",
            label: "Note (optional)",
            maxlength: 120,
            name: "summary",
          })}
          <span class="hint">Submitting does not confirm: confirm your own proposal from the detail screen, then share the proposal id with the other signers. Re-proposing identical calls needs a different salt.</span>
          ${button({
            icon: "send",
            label: "Submit proposal",
            type: "submit",
            variant: "secondary",
          })}
          <p id="multisig-propose-result" role="status"></p>
        </form>
      </section>`,
    )
  );
};
